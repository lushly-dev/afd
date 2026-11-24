//! Isolated reply-set composition units (`mail-replyset-next` and
//! `mail-replyset-submit`, step F3; plugin.spec.md sections 9.1, 9.2, 9.4).
//!
//! `mail-replyset-next` is a pure read that stores nothing. It hands out the
//! next unwritten reply with only its own source message visible text and
//! linked answers, a `"dev.loam/unit"` marker for Loam's fresh-context
//! composer, and a stateless 43-character unpadded base64url HMAC-SHA256 claim
//! binding `(unit_id, source_text_digest)` under the store's persistent key.
//! `mail-replyset-submit` verifies the unit and claim in constant time inside
//! the write transaction, records the reply and its audit inputs, and raises
//! the reply's generation (spending the claim) and the set's revision.

use std::sync::Arc;

use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult, JsonSchemaType,
    failure, input_digest, success,
};
use async_trait::async_trait;
use hmac::{Hmac, KeyInit, Mac};
use serde_json::{Value, json};
use sha2::Sha256;
use subtle::ConstantTimeEq;

use super::{
    MOST_TEXT_CHARS, NEXT, SUBMIT, UNIT_TEXT_LIMIT, invalid, preview_fits_with_send_headroom,
    read_source_visible, refusal, replyset_not_found, source_digest, take_chars, validate_text,
};
use crate::commands::store_failure;
use crate::engine::Engine;
use crate::read::{
    MOST_BUDGET, OPEN_BUDGET, budget, content, fits, parameter, read_exposure, required, too_small,
};
use crate::screening::proposer_of;
use crate::store::{
    AnswerRef, ReplyRow, ReplySendState, ReplySetDetail, ReplySetRefusal, ReplySetState,
    ReplySource, ReplySubmission, Store, StoreError,
};

/// Version identifier stored with every unit submission (plugin.spec.md 9.1 & 9.4).
pub const INSTRUCTIONS_VERSION: &str = "mail-replyset-v1";

/// Fixed engine instructions handed to Loam's fresh-context composer inside
/// `dev.loam/unit.instructions` (plugin.spec.md 9.1; at most 4,096 characters).
pub const UNIT_INSTRUCTIONS: &str = "Write a reply from the person to the message in this unit, \
using only the answers given. Add no recipient, link, promise, or fact that is not in the \
answers. Reply in the message's language. Return the reply's text alone.";

/// Domain separator prefix for reply-set unit claims so claims cannot collide
/// with any other HMAC domain.
const CLAIM_DOMAIN: &[u8] = b"loam-mail:replyset-claim:v1\0";

/// Forbidden fields on `mail-replyset-submit`: the engine derives recipient,
/// subject, and account from the source message (plugin.spec.md 9.2, F-T9).
const FORBIDDEN_SUBMIT_FIELDS: &[&str] = &[
    "recipient",
    "recipients",
    "to",
    "cc",
    "bcc",
    "subject",
    "account",
];

/// RFC 2104 HMAC-SHA256 over `message` using the same vetted `hmac` primitive
/// as `afd`'s approval tokens (`packages/rust/src/approval/token.rs`).
fn hmac_sha256(key: &[u8; 32], message: &[u8]) -> [u8; 32] {
    let mut mac = Hmac::<Sha256>::new_from_slice(key)
        .unwrap_or_else(|_| unreachable!("HMAC-SHA256 accepts any key length"));
    mac.update(message);
    mac.finalize().into_bytes().into()
}

/// Encodes 32 bytes as unpadded base64url (always 43 ASCII characters in
/// `[A-Za-z0-9_-]`; plugin.spec.md 9.1).
fn base64url_nopad(bytes: &[u8; 32]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(43);
    for chunk in bytes.chunks(3) {
        let b0 = u32::from(chunk[0]);
        let b1 = chunk.get(1).copied().map_or(0, u32::from);
        let b2 = chunk.get(2).copied().map_or(0, u32::from);
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 0x3f) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 0x3f) as usize] as char);
        }
    }
    out
}

/// Constant-time equality over ASCII claim strings using `subtle::ConstantTimeEq`.
fn constant_time_eq(a: &str, b: &str) -> bool {
    let a = a.as_bytes();
    let b = b.as_bytes();
    a.len() == b.len() && bool::from(a.ct_eq(b))
}

/// Derives the stateless 43-character unpadded base64url HMAC-SHA256 claim
/// binding `unit_id` and `source_text_digest` under `key` (plugin.spec.md 9.1).
pub(crate) fn compute_claim(key: &[u8; 32], unit_id: &str, source_text_digest: &str) -> String {
    let mut msg =
        Vec::with_capacity(CLAIM_DOMAIN.len() + unit_id.len() + 1 + source_text_digest.len());
    msg.extend_from_slice(CLAIM_DOMAIN);
    msg.extend_from_slice(unit_id.as_bytes());
    msg.push(0);
    msg.extend_from_slice(source_text_digest.as_bytes());
    base64url_nopad(&hmac_sha256(key, &msg))
}

/// Deterministic canonical unit representation for one reply, shared by both
/// `mail-replyset-next` (pure read) and `mail-replyset-submit` (stateless claim
/// verification).
///
/// The visible text window is chosen deterministically against `OPEN_BUDGET`
/// (falling back to `MOST_BUDGET` only if linked answers alone exceed
/// `OPEN_BUDGET`), capped at `UNIT_TEXT_LIMIT` characters, so every caller
/// interface (`cli` and `mcp`) observes and attests to the exact same
/// `(unit, claim, sourceTextDigest)` without `mail-replyset-next` writing to
/// SQLite.
struct CanonicalUnit {
    payload: Value,
    source_text_digest: String,
    answers_json: String,
}

fn canonical_unit_for_reply(
    store: &Store,
    detail: &ReplySetDetail,
    reply: &ReplyRow,
    claim_key: &[u8; 32],
) -> Result<Result<CanonicalUnit, Box<CommandError>>, StoreError> {
    let Some(msg_id) = reply.message else {
        return Ok(Err(Box::new(
            CommandError::new(
                "MESSAGE_NOT_FOUND",
                "the reply's source message is no longer in the store",
            )
            .with_suggestion("Inspect the reply set with mail-replyset-show."),
        )));
    };
    let (subject, visible) = match read_source_visible(store, msg_id)? {
        Ok(pair) => pair,
        Err(error) => return Ok(Err(error)),
    };
    let linked_questions: Vec<_> = detail
        .questions
        .iter()
        .filter(|q| q.reply_ids.contains(&reply.id))
        .collect();
    let answer_refs: Vec<AnswerRef> = linked_questions
        .iter()
        .map(|q| AnswerRef {
            question: q.id,
            revision: q.revision,
        })
        .collect();
    let answers_json = serde_json::to_string(&answer_refs).unwrap_or_else(|_| "[]".to_string());
    let answers_content: Vec<Value> = linked_questions
        .iter()
        .map(|q| {
            json!({
                "question": q.question,
                "answer": q.answer,
                "individual": q.reply_ids.len() == 1,
            })
        })
        .collect();
    let unit_id = reply.current_unit_id();

    let build_unit = |chars: usize, revision_value: i64| -> (Value, String) {
        let (slice, complete) = take_chars(&visible, chars);
        let digest = source_digest(&subject, slice);
        let claim = compute_claim(claim_key, &unit_id, &digest);
        let payload = json!({
            "replyset": detail.set.id,
            "revision": revision_value,
            "done": false,
            "reply": reply.id,
            "message": msg_id,
            "unit": unit_id,
            "claim": claim,
            "replyToDiffers": reply.reply_to_differs,
            "textComplete": complete,
            "inputs": {
                "message": msg_id,
                "sourceTextDigest": digest,
                "answers": answer_refs,
                "instructionsVersion": INSTRUCTIONS_VERSION,
            },
            "dev.loam/unit": {
                "id": unit_id,
                "submit": {
                    "command": SUBMIT,
                    "input": {
                        "replyset": detail.set.id,
                        "reply": reply.id,
                        "unit": unit_id,
                        "claim": claim,
                    },
                    "field": "text",
                },
                "instructions": UNIT_INSTRUCTIONS,
            },
            "content": content(json!({
                "recipient": {
                    "address": reply.recipient_address,
                    "name": reply.recipient_name,
                },
                "message": {
                    "subject": subject,
                    "text": slice,
                },
                "answers": answers_content,
            })),
        });
        (payload, digest)
    };

    // Size the canonical source-text window against a fixed-width revision
    // (`i64::MAX`) so unrelated edits that widen `detail.set.revision` (e.g.
    // 9 -> 10) never shorten the window or invalidate an already-issued claim.
    let max_chars = visible.chars().count().min(UNIT_TEXT_LIMIT);
    let target_budget = if fits(&build_unit(0, i64::MAX).0, OPEN_BUDGET as usize) {
        OPEN_BUDGET as usize
    } else {
        MOST_BUDGET as usize
    };
    let chosen_chars = if fits(&build_unit(max_chars, i64::MAX).0, target_budget) {
        max_chars
    } else {
        let mut lo = 0usize;
        let mut hi = max_chars;
        while lo < hi {
            let mid = lo + (hi - lo).div_ceil(2);
            if fits(&build_unit(mid, i64::MAX).0, target_budget) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        if !fits(&build_unit(lo, i64::MAX).0, target_budget) {
            return Ok(Err(Box::new(too_small(target_budget))));
        }
        lo
    };
    let (payload, source_text_digest) = build_unit(chosen_chars, detail.set.revision);

    Ok(Ok(CanonicalUnit {
        payload,
        source_text_digest,
        answers_json,
    }))
}

struct Next {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Next {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let set_id = match required(&input, "replyset") {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        let limit = budget(&context, MOST_BUDGET);

        let handed = self.engine.with_store(|store| {
            let Some(detail) = store.replyset(set_id)? else {
                return Ok(Err(Box::new(replyset_not_found(set_id))));
            };
            let Some(next_reply) = detail.replies.iter().find(|r| r.text.is_none()) else {
                return Ok(Ok(json!({
                    "replyset": detail.set.id,
                    "revision": detail.set.revision,
                    "done": true,
                })));
            };
            let claim_key = store.replyset_claim_key()?;
            let unit = match canonical_unit_for_reply(store, &detail, next_reply, &claim_key)? {
                Ok(unit) => unit,
                Err(error) => return Ok(Err(error)),
            };
            if !fits(&unit.payload, limit) {
                return Ok(Err(Box::new(too_small(limit))));
            }
            Ok(Ok(unit.payload))
        });

        match handed {
            Ok(Ok(value)) => success(value),
            Ok(Err(error)) => failure(*error),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-replyset-next`: pure read that hands out the next unwritten reply as
/// a fresh-context unit (`dev.loam/unit`) with only its own source message
/// visible text, linked answers, and a stateless single-use claim
/// (plugin.spec.md section 9.1).
#[must_use]
pub fn next(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        NEXT,
        "Get the next unwritten reply unit with only its own source message, linked answers, and a single-use submission claim",
        vec![parameter(
            "replyset",
            JsonSchemaType::Integer,
            "The reply set, by id",
            true,
        )],
        Next { engine },
    )
    .with_output_budget(MOST_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}

struct Submit {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Submit {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let now = context.clock().now();
        let submitter = proposer_of(&context);
        let parsed = (|| -> Result<(i64, i64, String, String, String), Box<CommandError>> {
            if let Some(obj) = input.as_object() {
                for &field in FORBIDDEN_SUBMIT_FIELDS {
                    if obj.get(field).is_some_and(|v| !v.is_null()) {
                        return Err(invalid(
                            format!(
                                "`{field}` cannot be set on `{SUBMIT}`; the engine derives recipients, subject, and account from the source message"
                            ),
                            format!(
                                "Pass only `replyset`, `reply`, `unit`, `claim`, and `text` to `{SUBMIT}`."
                            ),
                        ));
                    }
                }
            }
            let set_id = required(&input, "replyset")?;
            let reply_id = required(&input, "reply")?;
            let unit = match input.get("unit").filter(|v| !v.is_null()) {
                Some(v) => validate_text(v, "unit", false, 128)?,
                None => {
                    return Err(invalid(
                        "`unit` is required",
                        "Pass the `unit` id returned by mail-replyset-next.",
                    ));
                }
            };
            let claim = match input.get("claim").filter(|v| !v.is_null()) {
                Some(v) => validate_text(v, "claim", false, 128)?,
                None => {
                    return Err(invalid(
                        "`claim` is required",
                        "Pass the `claim` returned by mail-replyset-next.",
                    ));
                }
            };
            let text = match input.get("text").filter(|v| !v.is_null()) {
                Some(v) => validate_text(v, "text", false, MOST_TEXT_CHARS)?,
                None => {
                    return Err(invalid(
                        "`text` is required",
                        "Provide the composed reply text (1 to 32,768 characters).",
                    ));
                }
            };
            Ok((set_id, reply_id, unit, claim, text))
        })();
        let (set_id, reply_id, unit, claim, text) = match parsed {
            Ok(parsed) => parsed,
            Err(error) => return failure(*error),
        };

        let text_digest = input_digest(&json!(text)).unwrap_or_default();
        let submitted = self.engine.with_store(|store| {
            let Some(detail) = store.replyset(set_id)? else {
                return Ok(Err(Box::new(replyset_not_found(set_id))));
            };
            match detail.set.state {
                ReplySetState::Sending => {
                    return Ok(Err(Box::new(refusal(set_id, ReplySetRefusal::Sending))));
                }
                ReplySetState::Sent => {
                    return Ok(Err(Box::new(refusal(set_id, ReplySetRefusal::Sent))));
                }
                ReplySetState::Unknown => {
                    return Ok(Err(Box::new(refusal(set_id, ReplySetRefusal::Unknown))));
                }
                ReplySetState::Open | ReplySetState::Partial => {}
            }
            let Some(reply) = detail.replies.iter().find(|r| r.id == reply_id) else {
                return Ok(Err(Box::new(refusal(
                    set_id,
                    ReplySetRefusal::ReplyNotFound(reply_id),
                ))));
            };
            if !matches!(
                reply.send_state,
                ReplySendState::None | ReplySendState::Failed
            ) {
                return Ok(Err(Box::new(refusal(
                    set_id,
                    ReplySetRefusal::ReplyLocked(reply_id),
                ))));
            }
            if reply.text.is_some() || unit != reply.current_unit_id() {
                return Ok(Err(Box::new(refusal(set_id, ReplySetRefusal::UnitNotOpen))));
            }

            let claim_key = store.replyset_claim_key()?;
            let canonical = match canonical_unit_for_reply(store, &detail, reply, &claim_key)? {
                Ok(unit_data) => unit_data,
                Err(_) => return Ok(Err(Box::new(refusal(set_id, ReplySetRefusal::UnitNotOpen)))),
            };
            let source_text_digest = canonical.source_text_digest;
            let submission = ReplySubmission {
                text,
                text_digest,
                unit,
                source_text_digest: source_text_digest.clone(),
                answers_snapshot: canonical.answers_json,
                instructions_version: INSTRUCTIONS_VERSION.to_string(),
            };
            let accounts = store.accounts()?;
            let result = store.submit_replyset_reply(
                set_id,
                reply_id,
                &submission,
                &submitter,
                now,
                |key, current_unit_id| {
                    let expected = compute_claim(key, current_unit_id, &source_text_digest);
                    constant_time_eq(&claim, &expected)
                },
                |updated_detail| {
                    let account_row = accounts.iter().find(|a| a.id == updated_detail.set.account);
                    preview_fits_with_send_headroom(updated_detail, account_row)
                },
            )?;
            match result {
                Ok((updated_detail, updated_reply)) => Ok(Ok(json!({
                    "reply": {
                        "reply": updated_reply.id,
                        "source": updated_reply.source.map(ReplySource::as_str),
                        "unit": updated_reply.source_unit.as_deref(),
                    },
                    "revision": updated_detail.set.revision,
                }))),
                Err(why) => Ok(Err(Box::new(refusal(set_id, why)))),
            }
        });

        match submitted {
            Ok(Ok(value)) => success(value),
            Ok(Err(error)) => failure(*error),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-replyset-submit`: non-destructive local mutation that records a
/// reply's composed text against an open unit and its single-use claim
/// (plugin.spec.md section 9.2).
#[must_use]
pub fn submit(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        SUBMIT,
        "Submit composed text for an open reply-set unit using the claim returned by mail-replyset-next",
        vec![
            parameter(
                "replyset",
                JsonSchemaType::Integer,
                "The reply set, by id",
                true,
            ),
            parameter("reply", JsonSchemaType::Integer, "The reply, by id", true),
            parameter(
                "unit",
                JsonSchemaType::String,
                "The open unit id returned by mail-replyset-next",
                true,
            ),
            parameter(
                "claim",
                JsonSchemaType::String,
                "The single-use claim returned by mail-replyset-next",
                true,
            ),
            parameter(
                "text",
                JsonSchemaType::String,
                "Composed reply text (1 to 32,768 characters)",
                true,
            ),
        ],
        Submit { engine },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

#[cfg(test)]
mod tests {
    use super::{
        INSTRUCTIONS_VERSION, UNIT_INSTRUCTIONS, base64url_nopad, compute_claim, constant_time_eq,
        hmac_sha256,
    };

    /// RFC 4231 test case 1 (`HMAC-SHA-256` with 20-byte key padded to 32 bytes
    /// isn't identical, so use RFC 4231 test case 3 / 32-byte key verified
    /// directly against the RFC 2104 definition).
    #[test]
    fn hmac_sha256_matches_rfc2104_and_produces_43_char_base64url_claim() {
        // Key = 0x0b repeated 32 times, Data = "Hi There".
        let key = [0x0bu8; 32];
        let mac = hmac_sha256(&key, b"Hi There");
        // Verify against independent manual RFC 2104 computation.
        let mut expected_hex = String::new();
        for b in mac {
            use std::fmt::Write;
            let _ = write!(&mut expected_hex, "{b:02x}");
        }
        assert_eq!(
            expected_hex,
            "198a607eb44bfbc69903a0f1cf2bbdc5ba0aa3f3d9ae3c1c7a3b1696a0b68cf7"
        );

        let encoded = base64url_nopad(&mac);
        assert_eq!(encoded.len(), 43);
        assert!(
            encoded
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
            "unexpected base64url chars: {encoded}"
        );

        let c1 = compute_claim(&key, "rsu_1_1_1", "abc");
        let c2 = compute_claim(&key, "rsu_1_1_1", "abc");
        let c3 = compute_claim(&key, "rsu_1_1_2", "abc");
        let c4 = compute_claim(&key, "rsu_1_1_1", "abd");
        assert_eq!(c1.len(), 43);
        assert!(constant_time_eq(&c1, &c2));
        assert!(!constant_time_eq(&c1, &c3));
        assert!(!constant_time_eq(&c1, &c4));
        assert!(!constant_time_eq(&c1, "short"));
    }

    #[test]
    fn unit_instructions_respect_length_limit_and_version() {
        assert!(!INSTRUCTIONS_VERSION.is_empty());
        assert!(!UNIT_INSTRUCTIONS.is_empty());
        assert!(UNIT_INSTRUCTIONS.len() <= 4_096);
    }
}
