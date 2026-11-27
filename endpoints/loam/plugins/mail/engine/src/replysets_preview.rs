//! `mail-replyset-preview`: the confirmation preview of `mail-replyset-send`
//! (D175, #2410; plugin.spec.md section 6, "Two ceilings").
//!
//! `mail-replyset-show` is the reply set whole, with its questions, inputs,
//! units, counters and times, which is what an agent composing or checking a
//! set needs. A person asked to confirm a send needs less: who each reply goes
//! to, its subject, its text, whether that text differs from the shared text,
//! and who wrote it. This read gives only that, so that a reply set fits
//! Loam's confirmation ceiling (64 KiB of canonical JSON and 200 JSON values,
//! containers counted) without the ceiling being raised: the set's head is
//! [`HEAD_VALUES`] values, each reply the send would send [`REPLY_VALUES`]
//! and each reply already sent one, so at most [`SHELL_REPLIES`] unsent
//! replies fit, while the whole fits 64 KiB. A larger set stays readable
//! whole in `mail-replyset-show` and sendable at the terminal, and Loam fails
//! closed on it, as before.
//!
//! It shows only a set the send would send now: it refuses, with the send's
//! own error, every set `mail-replyset-send` refuses before its hold (its
//! state, a reply of unknown outcome or with no text, nothing left to send, a
//! removed account), so Loam never asks the person for a send the engine
//! refuses. Like `mail-replyset-show`, it holds no time of reading and no live
//! token lookup, so two reads of an unchanged set are equal in canonical JSON.
//! Every value written by mail or by callers sits in a part labelled
//! `"trust": "content"`.

use std::sync::Arc;

use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult, JsonSchemaType,
    failure, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};

use super::send::unsendable;
use super::{PREVIEW, SHOW_BUDGET, preview_fits, preview_too_large, replyset_not_found};
use crate::commands::store_failure;
use crate::engine::Engine;
use crate::read::{
    MOST_BUDGET, budget, content, fits, integer, parameter, read_exposure, required,
};
use crate::store::{AccountRow, ReplyRow, ReplySendState, ReplySetDetail};

/// JSON values in a preview's head, containers counted as Loam counts them:
/// the result's data, `replyset`, `id`, `revision`, `state`, `from`, the
/// labelled part, its `trust`, `sharedText` and `alreadySent`, and `replies`.
pub const HEAD_VALUES: usize = 11;
/// JSON values in each reply the send would send: the reply, `differs`,
/// `replyToDiffers`, `author`, `authorName`, the labelled part, its `trust`,
/// `to`, `toName`, `subject` and `text`. Each reply already sent is one more,
/// its recipient in `alreadySent`.
pub const REPLY_VALUES: usize = 11;
/// Loam's confirmation ceiling in JSON values (`PREVIEW_VALUES_MAX` in
/// `mounted-approvals.ts`), which this preview is shaped to fit.
pub const SHELL_VALUES_MAX: usize = 200;
/// Loam's confirmation ceiling in bytes of canonical JSON (`PREVIEW_MAX_BYTES`).
pub const SHELL_MAX_BYTES: usize = 64 * 1024;
/// The most unsent replies whose preview fits [`SHELL_VALUES_MAX`] with none
/// sent yet: 17.
pub const SHELL_REPLIES: usize = (SHELL_VALUES_MAX - HEAD_VALUES) / REPLY_VALUES;

/// Whether the send would send this reply (`ReplySendState::will_send`).
fn pending(reply: &ReplyRow) -> bool {
    reply.send_state.will_send()
}

fn reply_json(reply: &ReplyRow, shared_text: &str) -> Value {
    json!({
        "differs": reply.differs_from(shared_text),
        "replyToDiffers": reply.reply_to_differs,
        // The writer's token by its id, which no later token takes even when
        // one is given a revoked token's name; a writer with no token by its kind.
        "author": reply
            .author
            .as_ref()
            .map(|p| p.id.as_deref().unwrap_or(p.kind.as_str())),
        "authorName": reply.author_name.as_deref(),
        "content": content(json!({
            "to": reply.recipient_address,
            "toName": reply.recipient_name,
            "subject": reply.subject,
            "text": reply.text,
        })),
    })
}

/// The confirmation preview of a sendable reply set (D175): what a send of it
/// now would do, in canonical, stable JSON.
///
/// `replies` holds every reply the send would send, in the set's order, and
/// `alreadySent` the recipient of every other, which [`unsendable`] has
/// already made sure was sent and which a send never sends again.
pub(super) fn preview_json(detail: &ReplySetDetail, account: Option<&AccountRow>) -> Value {
    let shared = &detail.set.shared_text;
    let already_sent: Vec<&str> = detail
        .replies
        .iter()
        .filter(|r| !pending(r))
        .map(|r| r.recipient_address.as_str())
        .collect();
    let replies: Vec<Value> = detail
        .replies
        .iter()
        .filter(|r| pending(r))
        .map(|r| reply_json(r, shared))
        .collect();
    json!({
        "replyset": {
            "id": detail.set.id,
            "revision": detail.set.revision,
            "state": detail.set.state.as_str(),
            "from": account.map(|a| a.address.as_str()),
            "content": content(json!({
                "sharedText": shared,
                "alreadySent": already_sent,
            })),
            "replies": replies,
        }
    })
}

/// Why the preview refuses `detail`: the send's own refusals, and a reply
/// still being handed over, which the send's checks leave to its transaction.
/// That last is defensive: a reply is `sending` only while its set is, which
/// `unsendable` refuses, and opening the store settles any left over.
fn refused(
    id: i64,
    detail: &ReplySetDetail,
    account: Option<&AccountRow>,
    expected: Option<i64>,
) -> Option<CommandError> {
    unsendable(id, detail, account, expected).or_else(|| {
        detail
            .replies
            .iter()
            .any(|r| r.send_state == ReplySendState::Sending)
            .then(|| {
                CommandError::new(
                    "WORK_RUNNING",
                    format!("a reply of reply set {id} is being sent right now"),
                )
                .with_suggestion("Wait for the send to finish, then check mail-replyset-show.")
                .with_retryable(true)
            })
    })
}

struct Preview {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Preview {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let id = match required(&input, "replyset") {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        let expected_revision = match integer(&input, "revision") {
            Ok(rev) => rev,
            Err(error) => return failure(*error),
        };
        let loaded = self.engine.with_store(|store| {
            let Some(detail) = store.replyset(id)? else {
                return Ok(None);
            };
            let accounts = store.accounts()?;
            let account = accounts.into_iter().find(|a| a.id == detail.set.account);
            Ok(Some((detail, account)))
        });
        let (detail, account) = match loaded {
            Ok(Some(loaded)) => loaded,
            Ok(None) => return failure(replyset_not_found(id)),
            Err(error) => return failure(store_failure(&error)),
        };
        if let Some(error) = refused(id, &detail, account.as_ref(), expected_revision) {
            return failure(error);
        }
        let result = preview_json(&detail, account.as_ref());
        // Never larger than `mail-replyset-show`'s, which `unsendable` has just
        // measured, so this holds for every set the send would send.
        if !fits(&result, budget(&context, SHOW_BUDGET)) || !preview_fits(&result) {
            return failure(preview_too_large());
        }
        success(result)
    }
}

/// `mail-replyset-preview`: what `mail-replyset-send` would send now, for a
/// person's confirmation — every recipient, subject and text the send would
/// send, whether each text differs from the shared text, and who wrote it —
/// or the error the send would give. It is the send's preview in Loam (D175);
/// `mail-replyset-show` gives the set whole, in any state.
#[must_use]
pub fn preview(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        PREVIEW,
        "Preview what mail-replyset-send would send now: every recipient, subject and text, each reply's difference from the shared text and its author; fails as the send would",
        vec![
            parameter(
                "replyset",
                JsonSchemaType::Integer,
                "The reply set, by id",
                true,
            ),
            parameter(
                "revision",
                JsonSchemaType::Integer,
                "Optional revision to verify against the current reply set",
                false,
            ),
        ],
        Preview { engine },
    )
    .with_output_budget(SHOW_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}
