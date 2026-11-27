//! `mail-replyset-send`: sending a reviewed reply set at the terminal or
//! through an approver over MCP (step E3/F3; engine.spec.md 10.3, M18 amended,
//! M29; plugin.spec.md sections 5, 7, 8).
//!
//! Split out of `replysets.rs` so each command module stays well within the
//! file-size limit.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use afd::{
    ActorKind, ApprovalPolicy, CommandContext, CommandDefinition, CommandError, CommandHandler,
    CommandInterface, CommandResult, JsonSchemaType, Warning, failure, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};

use super::{
    SEND, invalid, preview_changed, preview_fits, preview_too_large, replyset_incomplete,
    replyset_json, replyset_not_found, send_provider_failure, send_refusal,
};
use crate::commands::{released_exposure, store_failure};
use crate::engine::Engine;
use crate::provider::Provider;
use crate::provider::smtp::{OutgoingMessage, SendOutcome, build_message, new_message_id};
use crate::read::{integer, parameter, required};
use crate::screening::proposer_of;
use crate::store::{
    AccountRow, ReplyRow, ReplySendState, ReplySetDetail, ReplySetSendRefusal, ReplySetState,
};

/// Bounded timeout for each best-effort IMAP `APPEND` of a sent reply copy.
const SENT_COPY_TIMEOUT: Duration = Duration::from_secs(10);

/// Checks `mail-replyset-send` inputs, state, revision, completeness, account
/// presence, and preview size before the approval middleware holds the call, so
/// a missing, incomplete, orphaned, oversized, or stale reply set never issues
/// an approval token (plugin.spec.md sections 6 and 7).
#[must_use]
pub fn pre_approval_check(engine: &Engine, input: &Value) -> Option<CommandError> {
    let id = match required(input, "replyset") {
        Ok(id) => id,
        Err(error) => return Some(*error),
    };
    let expected_revision = match integer(input, "revision") {
        Ok(Some(rev)) => rev,
        Ok(None) => {
            return Some(*invalid(
                "`revision` is required",
                "Pass the revision mail-replyset-preview or mail-replyset-show gave, so only what was previewed is sent.",
            ));
        }
        Err(error) => return Some(*error),
    };
    let (detail, account) = match engine.with_store(|store| {
        let Some(detail) = store.replyset(id)? else {
            return Ok(None);
        };
        let accounts = store.accounts()?;
        let account = accounts.into_iter().find(|a| a.id == detail.set.account);
        Ok(Some((detail, account)))
    }) {
        Ok(Some(loaded)) => loaded,
        Ok(None) => return Some(replyset_not_found(id)),
        Err(error) => return Some(store_failure(&error)),
    };
    unsendable(id, &detail, account.as_ref(), Some(expected_revision))
}

/// Why `mail-replyset-send` would refuse this set before any hold, or `None`
/// when it would send: its state, `revision` (when `expected` is given), a
/// reply of unknown outcome, a reply with no text, nothing left to send, a
/// removed account, or a preview too large to show. Shared with
/// `mail-replyset-preview`, so Loam never asks for a send the engine refuses.
pub(super) fn unsendable(
    id: i64,
    detail: &ReplySetDetail,
    account: Option<&AccountRow>,
    expected: Option<i64>,
) -> Option<CommandError> {
    match detail.set.state {
        ReplySetState::Sending => return Some(send_refusal(id, ReplySetSendRefusal::Sending)),
        ReplySetState::Sent => return Some(send_refusal(id, ReplySetSendRefusal::Sent)),
        ReplySetState::Unknown => return Some(send_refusal(id, ReplySetSendRefusal::Unknown)),
        ReplySetState::Open | ReplySetState::Partial => {}
    }
    if let Some(expected) = expected
        && detail.set.revision != expected
    {
        return Some(preview_changed(detail.set.revision));
    }
    if detail
        .replies
        .iter()
        .any(|r| r.send_state == ReplySendState::Unknown)
    {
        return Some(send_refusal(id, ReplySetSendRefusal::Unknown));
    }
    let missing = detail
        .replies
        .iter()
        .filter(|r| r.text.as_deref().is_none_or(|t| t.trim().is_empty()))
        .count();
    if missing > 0 {
        return Some(replyset_incomplete(id, missing));
    }
    let pending = detail
        .replies
        .iter()
        .filter(|r| r.send_state.will_send())
        .count();
    if pending == 0 {
        return Some(send_refusal(id, ReplySetSendRefusal::NothingToSend));
    }
    if account.is_none() {
        return Some(send_refusal(id, ReplySetSendRefusal::AccountNotFound));
    }
    if !preview_fits(&replyset_json(detail, account)) {
        return Some(preview_too_large());
    }
    None
}

/// Content-free approval summary for `mail-replyset-send` (the specification's
/// 3.5, 12.1 and plugin.spec.md 5.2): never includes any recipient address,
/// display name, subject, or body text.
#[must_use]
pub fn approval_summary(engine: &Engine, input: &Value) -> Option<String> {
    let id = input.get("replyset")?.as_i64()?;
    let detail = engine.with_store(|store| store.replyset(id)).ok()??;
    if !matches!(
        detail.set.state,
        ReplySetState::Open | ReplySetState::Partial
    ) {
        return None;
    }
    let pending = detail
        .replies
        .iter()
        .filter(|r| r.send_state.will_send())
        .count();
    if pending == 0 {
        return None;
    }
    let noun = if pending == 1 { "reply" } else { "replies" };
    if detail.set.state == ReplySetState::Partial {
        Some(format!(
            "Send reply set {id} from account {}: {pending} remaining {noun}",
            detail.set.account.0
        ))
    } else {
        Some(format!(
            "Send reply set {id} from account {}: {pending} {noun}",
            detail.set.account.0
        ))
    }
}

/// Drop guard ensuring an interrupted reply-set send never leaves `replyset`,
/// `replyset_reply`, or `outbound` stranded in `'sending'`.
struct InFlightReplySet {
    engine: Arc<Engine>,
    set_id: i64,
    armed: bool,
}

impl InFlightReplySet {
    fn arm(engine: Arc<Engine>, set_id: i64) -> Self {
        Self {
            engine,
            set_id,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for InFlightReplySet {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX));
        let _ = self
            .engine
            .with_store(|store| store.settle_interrupted_replyset(self.set_id, now));
    }
}

struct SendReplySet {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for SendReplySet {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let is_terminal_human = context.interface == Some(CommandInterface::Cli)
            && context
                .actor
                .as_ref()
                .is_some_and(|actor| actor.kind == ActorKind::Human);
        let is_approver_mcp = crate::is_approver(&self.engine, &context);
        if !is_terminal_human && !is_approver_mcp {
            return failure(
                CommandError::new(
                    "PERSON_REQUIRED",
                    "`mail-replyset-send` is a person's command and must be run at a terminal or through an approver",
                )
                .with_suggestion(
                    "Run `loam-mail mail-replyset-send` at a terminal, or approve the preview in Loam.",
                ),
            );
        }
        let sender_proposer = proposer_of(&context);
        let parsed = (|| -> Result<(i64, i64), Box<CommandError>> {
            let id = required(&input, "replyset")?;
            let revision = integer(&input, "revision")?.ok_or_else(|| {
                invalid(
                    "`revision` is required",
                    "Pass the revision mail-replyset-preview or mail-replyset-show gave, so only what was previewed is sent.",
                )
            })?;
            Ok((id, revision))
        })();
        let (set_id, expected_revision) = match parsed {
            Ok(parsed) => parsed,
            Err(error) => return failure(*error),
        };

        let Some(mail_sender) = self.engine.sender().cloned() else {
            return failure(
                CommandError::new(
                    "PROVIDER_UNAVAILABLE",
                    "this build of the engine cannot send mail",
                )
                .with_suggestion("Configure an SMTP sender for the engine."),
            );
        };

        let begun = self
            .engine
            .with_store(|store| store.begin_replyset_send(set_id, expected_revision));
        let (detail, account) = match begun {
            Ok(Ok(begun)) => begun,
            Ok(Err(why)) => return failure(send_refusal(set_id, why)),
            Err(error) => return failure(store_failure(&error)),
        };
        let mut guard = InFlightReplySet::arm(Arc::clone(&self.engine), set_id);

        let already_sent = detail
            .replies
            .iter()
            .filter(|r| r.send_state == ReplySendState::Sent)
            .count();
        let pending: Vec<ReplyRow> = detail
            .replies
            .iter()
            .filter(|r| r.send_state.will_send())
            .cloned()
            .collect();
        let total_replies = detail.replies.len();

        let mut sent_this_run = 0usize;
        let mut sent_copies = 0usize;
        let mut sent_copy_failed = false;
        let mut outcomes: Vec<Value> = Vec::with_capacity(pending.len());
        let mut sent_copy_session = SentCopySession::new(&self.engine, &account);

        for reply in &pending {
            let body = reply.text.as_deref().unwrap_or_default();
            let now = context.clock().now();
            let message_id = match new_message_id(&account.address) {
                Ok(mid) => mid,
                Err(why) => {
                    sent_copy_session.close().await;
                    let any_sent = already_sent + sent_this_run > 0;
                    let next_state = if any_sent {
                        ReplySetState::Partial
                    } else {
                        ReplySetState::Open
                    };
                    if self
                        .engine
                        .with_store(|store| {
                            store.finish_replyset_send(set_id, next_state, any_sent, now)
                        })
                        .is_ok()
                    {
                        guard.disarm();
                    }
                    return failure(
                        CommandError::new("STORE_FAILED", why)
                            .with_suggestion("Check the operating system's random source."),
                    );
                }
            };

            let outbound_id = match self.engine.with_store(|store| {
                store.begin_replyset_reply_send(
                    set_id,
                    reply.id,
                    account.id,
                    expected_revision,
                    &message_id,
                    &sender_proposer,
                    now,
                )
            }) {
                Ok(id) => id,
                Err(error) => {
                    sent_copy_session.close().await;
                    let any_sent = already_sent + sent_this_run > 0;
                    let next_state = if any_sent {
                        ReplySetState::Partial
                    } else {
                        ReplySetState::Open
                    };
                    if self
                        .engine
                        .with_store(|store| {
                            store.finish_replyset_send(set_id, next_state, any_sent, now)
                        })
                        .is_ok()
                    {
                        guard.disarm();
                    }
                    return failure(store_failure(&error));
                }
            };

            let reply_headers = match reply.message {
                Some(src_id) => self
                    .engine
                    .with_store(|store| store.reply_headers(src_id))
                    .ok()
                    .flatten()
                    .unwrap_or_default(),
                None => crate::store::ReplyHeaders::default(),
            };
            let to = vec![reply.recipient_address.clone()];
            let wire_bytes = build_message(&OutgoingMessage {
                from: &account.address,
                to: &to,
                cc: &[],
                bcc: &[],
                subject: &reply.subject,
                body,
                date_ms: now,
                message_id: &message_id,
                in_reply_to: reply_headers.in_reply_to.as_deref(),
                references: &reply_headers.references,
                include_bcc: false,
            });

            let outcome = mail_sender
                .send(&account, &account.address, &to, &wire_bytes)
                .await;
            let finished_at = context.clock().now();

            match outcome {
                SendOutcome::Sent => {
                    if let Err(error) = self.engine.with_store(|store| {
                        store.finish_replyset_reply_sent(outbound_id, reply.id, finished_at)
                    }) {
                        sent_copy_session.close().await;
                        // Stop immediately: do not hand over further replies
                        // when the accepted send cannot be recorded locally.
                        // Keep `guard` armed so drop attempts settlement and
                        // marks the unrecorded reply unknown rather than
                        // leaving it stranded in `sending`.
                        let total_sent = already_sent + sent_this_run;
                        let remaining = total_replies.saturating_sub(total_sent);
                        return failure(
                            CommandError::new(
                                "OUTBOUND_RECORD_FAILED",
                                format!(
                                    "reply {} was accepted by the provider, but the local send record could not be saved: {error}",
                                    reply.id
                                ),
                            )
                            .with_retryable(false)
                            .with_details(HashMap::from([
                                ("replyset".to_string(), json!(set_id)),
                                ("reply".to_string(), json!(reply.id)),
                                ("outbound".to_string(), json!(outbound_id)),
                                ("sent".to_string(), json!(total_sent)),
                                ("remaining".to_string(), json!(remaining)),
                                ("recordSaved".to_string(), json!(false)),
                            ]))
                            .with_suggestion(
                                "Check your Sent mailbox and mail-status before deciding how to proceed; remaining replies were not sent.",
                            ),
                        );
                    }
                    sent_this_run += 1;
                    let sent_copy = sent_copy_session.append(&wire_bytes).await;
                    if sent_copy {
                        let _ = self
                            .engine
                            .with_store(|store| store.mark_outbound_sent_copy(outbound_id));
                        sent_copies += 1;
                    } else {
                        sent_copy_failed = true;
                    }
                    outcomes.push(json!({
                        "reply": reply.id,
                        "outbound": outbound_id,
                        "state": "sent",
                        "sentCopy": sent_copy,
                        "recordSaved": true,
                    }));
                }
                SendOutcome::Failed(error) => {
                    sent_copy_session.close().await;
                    let why = error.to_string();
                    if let Err(store_err) = self.engine.with_store(|store| {
                        store.finish_replyset_reply_failed(outbound_id, reply.id, &why, finished_at)
                    }) {
                        return failure(store_failure(&store_err));
                    }
                    let total_sent = already_sent + sent_this_run;
                    let next_state = if total_sent > 0 {
                        ReplySetState::Partial
                    } else {
                        ReplySetState::Open
                    };
                    // Always raise revision: this reply's `state`, `outbound`,
                    // and `updatedAt` in `mail-replyset-show` changed.
                    let new_revision = match self.engine.with_store(|store| {
                        store.finish_replyset_send(set_id, next_state, true, finished_at)
                    }) {
                        Ok(rev) => rev,
                        Err(store_err) => return failure(store_failure(&store_err)),
                    };
                    guard.disarm();
                    let remaining = total_replies.saturating_sub(total_sent);
                    let mut cmd_err = send_provider_failure(&error);
                    cmd_err = cmd_err.with_details(HashMap::from([
                        ("replyset".to_string(), json!(set_id)),
                        ("revision".to_string(), json!(new_revision)),
                        ("state".to_string(), json!(next_state.as_str())),
                        ("failedReply".to_string(), json!(reply.id)),
                        ("outbound".to_string(), json!(outbound_id)),
                        ("sent".to_string(), json!(total_sent)),
                        ("remaining".to_string(), json!(remaining)),
                    ]));
                    return failure(cmd_err);
                }
                SendOutcome::Unknown(why) => {
                    sent_copy_session.close().await;
                    let saved = self.engine.with_store(|store| {
                        store.finish_replyset_reply_unknown(
                            outbound_id,
                            reply.id,
                            set_id,
                            why,
                            finished_at,
                        )
                    });
                    if saved.is_ok() {
                        guard.disarm();
                    }
                    let (new_revision, record_saved) = match saved {
                        Ok(rev) => (json!(rev), true),
                        Err(_) => (Value::Null, false),
                    };
                    let total_sent = already_sent + sent_this_run;
                    let remaining = total_replies.saturating_sub(total_sent + 1);
                    return failure(
                        CommandError::new("SEND_OUTCOME_UNKNOWN", why)
                            .with_retryable(false)
                            .with_details(HashMap::from([
                                ("replyset".to_string(), json!(set_id)),
                                ("revision".to_string(), new_revision),
                                ("reply".to_string(), json!(reply.id)),
                                ("outbound".to_string(), json!(outbound_id)),
                                ("sent".to_string(), json!(total_sent)),
                                ("remaining".to_string(), json!(remaining)),
                                ("recordSaved".to_string(), json!(record_saved)),
                            ]))
                            .with_suggestion(
                                "Check your Sent mailbox and mail-status before deciding how to proceed; this send is never retried.",
                            ),
                    );
                }
            }
        }

        sent_copy_session.close().await;
        let finished_at = context.clock().now();
        let saved = self.engine.with_store(|store| {
            store.finish_replyset_send(set_id, ReplySetState::Sent, true, finished_at)
        });
        let (new_revision, set_saved) = match saved {
            Ok(rev) => {
                guard.disarm();
                (Some(rev), true)
            }
            Err(_) => (None, false),
        };

        let mut result = success(json!({
            "replyset": set_id,
            "revision": new_revision,
            "account": account.id.0,
            "state": "sent",
            "sent": sent_this_run,
            "total": total_replies,
            "sentCopies": sent_copies,
            "recordSaved": set_saved,
            "replies": outcomes,
        }));
        let mut warnings = Vec::new();
        if !set_saved {
            warnings.push(Warning::new(
                "OUTBOUND_RECORD_FAILED",
                "all replies were accepted by the provider, but the local send record could not be fully updated",
            ));
        }
        if sent_copy_failed {
            warnings.push(Warning::new(
                "SENT_COPY_FAILED",
                "one or more replies were sent, but their copies could not be placed in the sent mailbox",
            ));
        }
        if !warnings.is_empty() {
            result.warnings = Some(warnings);
        }
        result
    }
}

/// Reuses a single best-effort IMAP connection across a reply-set batch to
/// append `\Seen` Sent copies without reconnecting per reply.
struct SentCopySession<'a> {
    engine: &'a Engine,
    account: &'a AccountRow,
    sent_mailbox_key: Option<String>,
    provider: Option<Box<dyn Provider>>,
}

impl<'a> SentCopySession<'a> {
    fn new(engine: &'a Engine, account: &'a AccountRow) -> Self {
        let sent_mailbox_key = engine
            .with_store(|store| store.sent_mailbox(account.id))
            .ok()
            .flatten()
            .map(|m| m.provider_key);
        Self {
            engine,
            account,
            sent_mailbox_key,
            provider: None,
        }
    }

    async fn append(&mut self, message_bytes: &[u8]) -> bool {
        let (Some(connector), Some(mailbox_key)) = (
            self.engine.connector().cloned(),
            self.sent_mailbox_key.as_deref(),
        ) else {
            return false;
        };
        let work = async {
            if self.provider.is_none() {
                match connector.connect(self.account).await {
                    Ok(provider) => self.provider = Some(provider),
                    Err(_) => return false,
                }
            }
            if let Some(provider) = self.provider.as_mut()
                && provider
                    .append(mailbox_key, &["\\Seen"], message_bytes)
                    .await
                    .is_ok()
            {
                return true;
            }
            // Drop a broken session so the next reply can reconnect cleanly.
            if let Some(mut provider) = self.provider.take() {
                provider.close().await;
            }
            false
        };
        match tokio::time::timeout(SENT_COPY_TIMEOUT, work).await {
            Ok(ok) => ok,
            Err(_) => {
                self.provider = None;
                false
            }
        }
    }

    async fn close(&mut self) {
        if let Some(mut provider) = self.provider.take() {
            let _ = tokio::time::timeout(SENT_COPY_TIMEOUT, provider.close()).await;
        }
    }
}

/// `mail-replyset-send`: sends every unsent reply in a reviewed reply set at
/// the terminal or through an approver over MCP after preview and approval
/// (section 10.3, M18 amended, M29; plugin.spec.md sections 5, 7, 18).
#[must_use]
pub fn send(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        SEND,
        "Send a reviewed reply set; requires person approval at a terminal or through an approver after previewing the revision named",
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
                "The revision previewed with mail-replyset-preview or mail-replyset-show",
                true,
            ),
        ],
        SendReplySet { engine },
    )
    .as_mutation()
    .with_destructive(true)
    .with_confirm_prompt("Send this reply set")
    .with_approval(ApprovalPolicy::Required)
    .with_expose(released_exposure())
}
