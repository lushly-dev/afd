//! `mail-draft-send` command, pre-approval check, approval summary, SMTP
//! handover, and best-effort Sent-copy append (the specification's 9.5, M18
//! amended, M29, and plugin.spec.md sections 5–8).

use std::collections::HashSet;
use std::sync::Arc;

use afd::{
    ActorKind, ApprovalPolicy, CommandContext, CommandDefinition, CommandError, CommandHandler,
    CommandInterface, CommandResult, JsonSchemaType, Warning, failure, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};

use super::{SEND, address_list, draft_not_found, invalid};
use crate::commands::{released_exposure, store_failure};
use crate::engine::Engine;
use crate::provider::ProviderError;
use crate::provider::smtp::{OutgoingMessage, SendOutcome, build_message, new_message_id};
use crate::read::{integer, parameter, required};
use crate::screening::proposer_of;
use crate::store::{DraftRow, SendRefusal, SendState, normalize_domain};

/// Checks `mail-draft-send` inputs, state, revision and recipients before the
/// approval middleware holds the call, so a missing, closed, empty or stale
/// draft never receives an approval token (plugin.spec.md, section 7).
#[must_use]
pub fn pre_approval_check(engine: &Engine, input: &Value, now: i64) -> Option<CommandError> {
    let id = match required(input, "draft") {
        Ok(id) => id,
        Err(error) => return Some(*error),
    };
    let revision = match integer(input, "revision") {
        Ok(Some(rev)) => rev,
        Ok(None) => {
            return Some(*invalid(
                "`revision` is required",
                "Pass the revision mail-draft-show gave, so that only what was previewed is sent.",
            ));
        }
        Err(error) => return Some(*error),
    };
    let mut seen_typed = 0;
    if let Err(error) = address_list(input, "typedRecipients", &mut seen_typed) {
        return Some(*error);
    }
    match engine.with_store(|store| {
        store.purge_drafts(now)?;
        let Some(row) = store.draft(id)? else {
            return Ok(Some(SendRefusal::NotFound));
        };
        if row.discarded_at.is_some() {
            return Ok(Some(SendRefusal::Discarded));
        }
        match row.send_state {
            SendState::Sending => return Ok(Some(SendRefusal::Sending)),
            SendState::Sent => return Ok(Some(SendRefusal::Sent)),
            SendState::Unknown => return Ok(Some(SendRefusal::Unknown)),
            SendState::None => {}
        }
        if row.revision != revision {
            return Ok(Some(SendRefusal::Changed {
                revision: row.revision,
            }));
        }
        if row.recipients.envelope_all().is_empty() {
            return Ok(Some(SendRefusal::NoRecipients));
        }
        let has_account = store
            .accounts()?
            .into_iter()
            .any(|account| account.id == row.account);
        if !has_account {
            return Ok(Some(SendRefusal::AccountNotFound));
        }
        Ok(None)
    }) {
        Ok(Some(why)) => Some(send_refusal(id, why)),
        Ok(None) => None,
        Err(error) => Some(store_failure(&error)),
    }
}

/// Content-free approval summary for `mail-draft-send` (the specification's
/// 3.5 and step F's 5.2).
#[must_use]
pub fn approval_summary(engine: &Engine, input: &Value) -> Option<String> {
    let id = input.get("draft")?.as_i64()?;
    let row = engine.with_store(|store| store.draft(id)).ok()??;
    if row.discarded_at.is_some() || row.send_state != SendState::None {
        return None;
    }
    let count = row.recipients.envelope_all().len();
    if count == 0 {
        return None;
    }
    let noun = if count == 1 {
        "recipient"
    } else {
        "recipients"
    };
    Some(format!(
        "Send draft {id} from account {} to {count} {noun}",
        row.account.0
    ))
}

fn send_refusal(id: i64, why: SendRefusal) -> CommandError {
    match why {
        SendRefusal::NotFound => draft_not_found(id),
        SendRefusal::Discarded => {
            CommandError::new("INVALID_INPUT", format!("draft {id} is discarded"))
                .with_suggestion("Restore it with mail-draft-restore before sending.")
        }
        SendRefusal::Sending => CommandError::new(
            "WORK_RUNNING",
            format!("draft {id} is already being sent"),
        )
        .with_suggestion("Wait for the send to finish, then check mail-draft-show.")
        .with_retryable(true),
        SendRefusal::Sent => CommandError::new(
            "INVALID_INPUT",
            format!("draft {id} has already been sent"),
        )
        .with_suggestion("Write a new draft with mail-draft-create."),
        SendRefusal::Unknown => CommandError::new(
            "SEND_OUTCOME_UNKNOWN",
            format!(
                "a previous send of draft {id} ended with an unknown outcome and is never retried"
            ),
        )
        .with_suggestion(
            "Check your Sent mailbox and mail-status before deciding whether to write a new draft.",
        )
        .with_retryable(false),
        SendRefusal::Changed { revision } => CommandError::new(
            "PREVIEW_CHANGED",
            format!(
                "The draft changed since its preview was read (now at revision {revision}). Nothing was sent."
            ),
        )
        .with_suggestion("Read it again with mail-draft-show and ask the person again.")
        .with_retryable(false),
        SendRefusal::NoRecipients => {
            CommandError::new("INVALID_INPUT", format!("draft {id} has no recipients"))
                .with_suggestion("Add at least one recipient with mail-draft-update before sending.")
        }
        SendRefusal::RecipientNotAllowed { count } => {
            let phrase = if count == 1 {
                "1 recipient is".to_string()
            } else {
                format!("{count} recipients are")
            };
            CommandError::new(
                "RECIPIENT_NOT_ALLOWED",
                format!(
                    "{phrase} not in the thread being answered and not an address you have written to"
                ),
            )
            .with_suggestion(
                "Run mail-draft-send at a terminal to type each new address, or change the recipients with mail-draft-update.",
            )
            .with_retryable(false)
        }
        SendRefusal::AccountNotFound => {
            CommandError::new("ACCOUNT_NOT_FOUND", "the draft's account no longer exists")
                .with_suggestion("Run `loam-mail mail-account-list` to see the accounts.")
        }
    }
}

/// A provider's refusal during `mail-draft-send`, in send-specific engine words.
fn send_provider_failure(error: &ProviderError) -> CommandError {
    match error {
        ProviderError::SignIn => CommandError::new("SIGN_IN_REQUIRED", error.to_string())
            .with_suggestion("Sign in to the account again."),
        ProviderError::Keychain => CommandError::new("SIGN_IN_REQUIRED", error.to_string())
            .with_suggestion("Unlock the keychain, then try again."),
        ProviderError::NoCredential => CommandError::new("SIGN_IN_REQUIRED", error.to_string())
            .with_suggestion("Store the account's sign-in, then try again."),
        ProviderError::Limit(_) => CommandError::new("PROVIDER_LIMIT", error.to_string())
            .with_suggestion("Wait a while before trying to send again.")
            .with_retryable(true),
        ProviderError::Refused(_) => CommandError::new("PROVIDER_REFUSED", error.to_string())
            .with_suggestion(
                "The provider refused the send permanently. Check the recipients and draft before trying again.",
            )
            .with_retryable(false),
        ProviderError::TooDeep => CommandError::new("PROVIDER_UNAVAILABLE", error.to_string())
            .with_suggestion("The provider's reply could not be read.")
            .with_retryable(false),
        ProviderError::Unavailable(_) | ProviderError::Protocol(_) => {
            CommandError::new("PROVIDER_UNAVAILABLE", error.to_string())
                .with_suggestion(
                    "Nothing was sent. Check the network, then run mail-draft-send again.",
                )
                .with_retryable(true)
        }
    }
}

/// Ensures an in-flight send never stays stranded in `sending` if the future is
/// dropped by a server call deadline or Ctrl-C before SMTP finalization runs.
struct InFlightSend {
    engine: Arc<Engine>,
    outbound_id: i64,
    draft_id: i64,
    armed: bool,
}

impl InFlightSend {
    fn arm(engine: Arc<Engine>, outbound_id: i64, draft_id: i64) -> Self {
        Self {
            engine,
            outbound_id,
            draft_id,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for InFlightSend {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX));
        let _ = self.engine.with_store(|store| {
            store.finish_draft_send_unknown(
                self.outbound_id,
                self.draft_id,
                "the send was interrupted before its outcome was recorded; whether it went is not known",
                now,
            )
        });
    }
}

/// How long to wait on the best-effort IMAP `APPEND` copy after SMTP has
/// already accepted the message, so a slow IMAP server cannot eat the call's
/// deadline.
const SENT_COPY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

struct SendDraft {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for SendDraft {
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
                    "`mail-draft-send` is a person's command and must be approved at a terminal or through an approver",
                )
                .with_suggestion(
                    "Run `loam-mail mail-draft-send` at a terminal, or approve it in Loam.",
                ),
            );
        }
        let now = context.clock().now();
        let sender_proposer = proposer_of(&context);
        let parsed = (|| -> Result<(i64, i64, HashSet<String>), Box<CommandError>> {
            let id = required(&input, "draft")?;
            let revision = integer(&input, "revision")?.ok_or_else(|| {
                invalid(
                    "`revision` is required",
                    "Pass the revision mail-draft-show gave, so that only what was previewed is sent.",
                )
            })?;
            let mut seen = 0;
            let typed_raw = address_list(&input, "typedRecipients", &mut seen)?;
            let typed: HashSet<String> = typed_raw
                .map(|list| {
                    list.into_iter()
                        .map(|addr| normalize_domain(&addr))
                        .collect()
                })
                .unwrap_or_default();
            Ok((id, revision, typed))
        })();
        let (id, revision, typed) = match parsed {
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

        // Pick the account's address first to build a Message-ID in its domain,
        // then atomically verify revision + recipients and record `outbound`
        // as `sending` in one transaction.
        let account_addr = match self.engine.with_store(|store| {
            store.purge_drafts(now)?;
            let Some(draft) = store.draft(id)? else {
                return Ok(None);
            };
            let accounts = store.accounts()?;
            Ok(accounts
                .into_iter()
                .find(|account| account.id == draft.account)
                .map(|account| account.address))
        }) {
            Ok(addr) => addr.unwrap_or_default(),
            Err(error) => return failure(store_failure(&error)),
        };
        let message_id = match new_message_id(&account_addr) {
            Ok(id) => id,
            Err(why) => {
                return failure(
                    CommandError::new("STORE_FAILED", why)
                        .with_suggestion("Check the operating system's random source."),
                );
            }
        };

        // Q2 (a) (plugin.spec.md section 8.2): an approver-released send over
        // MCP allows `new` recipients (marked `"basis": "new"` in preview);
        // terminal sends continue to require verbatim typing.
        let begun = self.engine.with_store(|store| {
            store.begin_draft_send(
                id,
                revision,
                &typed,
                is_approver_mcp,
                &message_id,
                &sender_proposer,
                now,
            )
        });
        let (draft, account, outbound_id) = match begun {
            Ok(Ok(begun)) => begun,
            Ok(Err(why)) => return failure(send_refusal(id, why)),
            Err(error) => return failure(store_failure(&error)),
        };
        let mut guard = InFlightSend::arm(Arc::clone(&self.engine), outbound_id, draft.id);

        // Read optional threading headers from the answered message.
        let reply_headers = match draft.answers {
            Some(answered_id) => self
                .engine
                .with_store(|store| store.reply_headers(answered_id))
                .ok()
                .flatten()
                .unwrap_or_default(),
            None => crate::store::ReplyHeaders::default(),
        };
        let (in_reply_to, references) = (reply_headers.in_reply_to, reply_headers.references);

        let envelope_to = draft.recipients.envelope_all();
        let wire_bytes = build_message(&OutgoingMessage {
            from: &account.address,
            to: &draft.recipients.to,
            cc: &draft.recipients.cc,
            bcc: &draft.recipients.bcc,
            subject: &draft.subject,
            body: &draft.body,
            date_ms: now,
            message_id: &message_id,
            in_reply_to: in_reply_to.as_deref(),
            references: &references,
            include_bcc: false,
        });

        let outcome = mail_sender
            .send(&account, &account.address, &envelope_to, &wire_bytes)
            .await;
        let finished_at = context.clock().now();

        match outcome {
            SendOutcome::Sent => {
                let saved = self.engine.with_store(|store| {
                    store.finish_draft_send_sent(outbound_id, draft.id, finished_at)
                });
                guard.disarm();
                let (new_revision, record_saved) = match saved {
                    Ok(rev) => (Some(rev), true),
                    Err(_) => (None, false),
                };
                // Append a copy (including Bcc) to the provider's sent mailbox
                // on a bounded best-effort basis: SMTP already accepted the message.
                let sent_copy = tokio::time::timeout(
                    SENT_COPY_TIMEOUT,
                    append_sent_copy(
                        &self.engine,
                        &account,
                        &draft,
                        &message_id,
                        in_reply_to.as_deref(),
                        &references,
                        now,
                    ),
                )
                .await
                .unwrap_or(false);
                if sent_copy && record_saved {
                    let _ = self
                        .engine
                        .with_store(|store| store.mark_outbound_sent_copy(outbound_id));
                }
                let mut result = success(json!({
                    "outbound": outbound_id,
                    "draft": draft.id,
                    "revision": new_revision,
                    "account": account.id.0,
                    "recipients": envelope_to.len(),
                    "state": "sent",
                    "sentCopy": sent_copy,
                    "recordSaved": record_saved,
                }));
                let mut warnings = Vec::new();
                if !record_saved {
                    warnings.push(Warning::new(
                        "OUTBOUND_RECORD_FAILED",
                        "the message was accepted by the provider, but the local send record could not be updated",
                    ));
                }
                if !sent_copy {
                    warnings.push(Warning::new(
                        "SENT_COPY_FAILED",
                        "the message was sent, but a copy could not be placed in the sent mailbox",
                    ));
                }
                if !warnings.is_empty() {
                    result.warnings = Some(warnings);
                }
                result
            }
            SendOutcome::Failed(error) => {
                let why = error.to_string();
                let saved = self.engine.with_store(|store| {
                    store.finish_draft_send_failed(outbound_id, draft.id, &why, finished_at)
                });
                guard.disarm();
                if saved.is_err() {
                    return failure(
                        CommandError::new(
                            "STORE_FAILED",
                            "the send failed before handover, and the local draft record could not be reopened",
                        )
                        .with_retryable(false)
                        .with_suggestion(
                            "Check the store and run mail-draft-show before deciding whether to write a new draft.",
                        ),
                    );
                }
                failure(send_provider_failure(&error))
            }
            SendOutcome::Unknown(why) => {
                let saved = self.engine.with_store(|store| {
                    store.finish_draft_send_unknown(outbound_id, draft.id, why, finished_at)
                });
                guard.disarm();
                let (new_revision, record_saved) = match saved {
                    Ok(rev) => (json!(rev), true),
                    Err(_) => (Value::Null, false),
                };
                failure(
                    CommandError::new("SEND_OUTCOME_UNKNOWN", why)
                        .with_retryable(false)
                        .with_details(std::collections::HashMap::from([
                            ("outbound".to_string(), json!(outbound_id)),
                            ("draft".to_string(), json!(draft.id)),
                            ("revision".to_string(), new_revision),
                            ("recordSaved".to_string(), json!(record_saved)),
                        ]))
                        .with_suggestion(
                            "Check your Sent mailbox and mail-status before deciding whether to write a new draft; this send is never retried.",
                        ),
                )
            }
        }
    }
}

/// Best-effort append of the sent message copy (with `Bcc:` when present) to
/// the account's sent mailbox.
async fn append_sent_copy(
    engine: &Engine,
    account: &crate::store::AccountRow,
    draft: &DraftRow,
    message_id: &str,
    in_reply_to: Option<&str>,
    references: &[String],
    date_ms: i64,
) -> bool {
    let Some(connector) = engine.connector().cloned() else {
        return false;
    };
    let sent_mailbox = engine
        .with_store(|store| store.sent_mailbox(account.id))
        .ok()
        .flatten();
    let Some(sent_mailbox) = sent_mailbox else {
        return false;
    };
    let copy_bytes = build_message(&OutgoingMessage {
        from: &account.address,
        to: &draft.recipients.to,
        cc: &draft.recipients.cc,
        bcc: &draft.recipients.bcc,
        subject: &draft.subject,
        body: &draft.body,
        date_ms,
        message_id,
        in_reply_to,
        references,
        include_bcc: true,
    });
    let Ok(mut provider) = connector.connect(account).await else {
        return false;
    };
    let appended = provider
        .append(&sent_mailbox.provider_key, &["\\Seen"], &copy_bytes)
        .await
        .is_ok();
    provider.close().await;
    appended
}

/// `mail-draft-send`: sends a draft at the terminal or through an approver
/// after preview and approval (the specification's 9.5, M18 amended and M29).
#[must_use]
pub fn send(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        SEND,
        "Send a draft; only a person can run it, after previewing the revision named",
        vec![
            parameter("draft", JsonSchemaType::Integer, "The draft, by id", true),
            parameter(
                "revision",
                JsonSchemaType::Integer,
                "The revision previewed with mail-draft-show",
                true,
            ),
            parameter(
                "typedRecipients",
                JsonSchemaType::Array,
                "New recipient addresses typed at the terminal for this send",
                false,
            ),
        ],
        SendDraft { engine },
    )
    .as_mutation()
    .with_destructive(true)
    .with_confirm_prompt("Send this draft")
    .with_approval(ApprovalPolicy::Required)
    .with_expose(released_exposure())
}
