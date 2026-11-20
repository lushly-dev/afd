//! Drafts and snoozed threads (the specification's 9.5 and section 11):
//! `mail-draft-create`, `-update`, `-discard`, `-restore`, `-list` and
//! `-show`, and `mail-thread-snooze`. All are local: nothing here reaches
//! the provider, and every caller may run them. Sending a draft is a
//! person's command of its own.
//!
//! A draft's recipients, subject and body are content: a caller wrote them,
//! and mail may have steered that caller. Every result gives them inside a
//! part labelled `trust: "content"` (12.1), and who wrote each part beside
//! it. A draft's revision rises with every change, so that a send names the
//! draft as it was previewed, and an update names the revision it read: a
//! change made by another caller in between fails it with `DRAFT_CHANGED`.

use std::sync::Arc;

use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult, JsonSchemaType,
    failure, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::commands::store_failure;
use crate::engine::Engine;
use crate::read::{
    MOST_BUDGET, budget, content, cursor, fits, integer, limit, parameter, read_exposure, required,
    too_small,
};
use crate::screening::{proposer_json, proposer_of};
use crate::store::{
    AccountId, DISCARD_LIFETIME, DraftChange, DraftRefusal, DraftRow, NewDraft, Recipients,
    StoreError, ThreadId, TokenRow,
};

/// The most recipients a draft may have, in all.
pub const MOST_RECIPIENTS: usize = 100;
/// The longest subject, in characters: a header line's limit.
pub const MOST_SUBJECT: usize = 998;
/// The longest body, in bytes, so that a draft fits a reply over MCP.
pub const MOST_BODY: usize = 48 * 1024;
/// The furthest ahead a thread may be snoozed: a year.
pub const MOST_SNOOZE: i64 = 366 * 24 * 60 * 60 * 1000;

/// A draft whole, as `mail-draft-show` gives it by default: its largest
/// budget, since it is the preview of a send and is never cut, and a caller
/// such as Loam may ask for no budget (step F's specification).
const SHOW_BUDGET: u64 = crate::read::MOST_BUDGET;

/// The commands whose results give a draft's text, which the journal
/// leaves out of their results (13.1).
pub const RESULTS_WITH_TEXT: &[&str] = &[
    "mail-draft-create",
    "mail-draft-update",
    "mail-draft-discard",
    "mail-draft-restore",
];

fn invalid(message: impl Into<String>, suggestion: impl Into<String>) -> Box<CommandError> {
    Box::new(CommandError::new("INVALID_INPUT", message).with_suggestion(suggestion))
}

fn draft_not_found(id: i64) -> CommandError {
    CommandError::new(
        "DRAFT_NOT_FOUND",
        format!("no draft has the id {id}; a discarded draft goes after 30 days"),
    )
    .with_suggestion(
        "Run `loam-mail mail-draft-list` to see the drafts, and with `discarded` those discarded.",
    )
}

fn refusal(id: i64, why: DraftRefusal) -> CommandError {
    match why {
        DraftRefusal::NotFound => draft_not_found(id),
        DraftRefusal::Changed { revision } => CommandError::new(
            "DRAFT_CHANGED",
            format!("draft {id} changed since it was read: it is at revision {revision}"),
        )
        .with_suggestion(
            "Read it again with mail-draft-show, and make the change from its revision.",
        ),
        DraftRefusal::Discarded => {
            CommandError::new("INVALID_INPUT", format!("draft {id} is discarded"))
                .with_suggestion("Restore it with mail-draft-restore first, within its 30 days.")
        }
        DraftRefusal::NotDiscarded => {
            CommandError::new("INVALID_INPUT", format!("draft {id} is not discarded"))
                .with_suggestion("Only a discarded draft is restored.")
        }
    }
}

/// Whether `text` is one plain address: an unquoted local part of the
/// characters RFC 5322 allows in a dot-atom, with no dot at either end or
/// two together, and a domain of two or more ASCII labels of letters,
/// digits and inner hyphens. No name, no space, no character a header would
/// read as a second address, and none that displays as something else. The
/// domain is kept in lower case. Addresses outside ASCII wait for SMTPUTF8.
fn address(text: &str) -> Option<String> {
    const ATEXT: &str = "!#$%&'*+/=?^_`{|}~-";
    let text = text.trim_matches(' ');
    if text.len() > 254 {
        return None;
    }
    let (local, domain) = text.split_once('@')?;
    let local_ok = !local.is_empty()
        && local.len() <= 64
        && local.split('.').all(|atom| {
            !atom.is_empty()
                && atom
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || ATEXT.contains(c))
        });
    let labels: Vec<&str> = domain.split('.').collect();
    let domain_ok = labels.len() >= 2
        && domain.len() <= 253
        && labels.iter().all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        });
    (local_ok && domain_ok).then(|| format!("{local}@{}", domain.to_ascii_lowercase()))
}

/// Whether `c` breaks a header line or displays as something it is not: a
/// control character other than a tab, a line or paragraph separator, or a
/// character that changes the direction or joins of text around it.
fn unsafe_in_subject(c: char) -> bool {
    (c.is_control() && c != '\t')
        || matches!(c, '\u{2028}' | '\u{2029}' | '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}' | '\u{feff}')
}

/// The list of addresses `input` holds under `name`, if it holds one.
fn address_list(
    input: &Value,
    name: &str,
    seen: &mut usize,
) -> Result<Option<Vec<String>>, Box<CommandError>> {
    let Some(value) = input.get(name).filter(|value| !value.is_null()) else {
        return Ok(None);
    };
    let Some(items) = value.as_array() else {
        return Err(invalid(
            format!("`{name}` is a list of addresses"),
            format!("Pass `{name}` as a list, such as [\"someone@example.com\"]."),
        ));
    };
    let mut addresses = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        // The address is not repeated: it may have come from mail.
        let Some(found) = item.as_str().and_then(address) else {
            return Err(invalid(
                format!("`{name}` item {index} is not a plain address"),
                "Give each recipient as a bare address, local@domain, with no name or brackets.",
            ));
        };
        if !addresses.contains(&found) {
            *seen += 1;
            if *seen > MOST_RECIPIENTS {
                return Err(invalid(
                    format!("a draft has at most {MOST_RECIPIENTS} recipients"),
                    "Send to fewer people, or to a list address.",
                ));
            }
            addresses.push(found);
        }
    }
    Ok(Some(addresses))
}

fn recipients(input: &Value, required_all: bool) -> Result<Option<Recipients>, Box<CommandError>> {
    let mut seen = 0;
    let to = address_list(input, "to", &mut seen)?;
    let cc = address_list(input, "cc", &mut seen)?;
    let bcc = address_list(input, "bcc", &mut seen)?;
    if !required_all && to.is_none() && cc.is_none() && bcc.is_none() {
        return Ok(None);
    }
    let recipients = Recipients {
        to: to.unwrap_or_default(),
        cc: cc.unwrap_or_default(),
        bcc: bcc.unwrap_or_default(),
    };
    if recipients.count() > MOST_RECIPIENTS {
        return Err(invalid(
            format!("a draft has at most {MOST_RECIPIENTS} recipients"),
            "Send to fewer people, or to a list address.",
        ));
    }
    Ok(Some(recipients))
}

fn text(
    input: &Value,
    name: &str,
    most: usize,
    chars: bool,
) -> Result<Option<String>, Box<CommandError>> {
    match input.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => {
            let size = if chars {
                text.chars().count()
            } else {
                text.len()
            };
            if size > most {
                let unit = if chars { "characters" } else { "bytes" };
                return Err(invalid(
                    format!("`{name}` is longer than {most} {unit}"),
                    format!("Shorten `{name}`."),
                ));
            }
            if name == "subject" && text.chars().any(unsafe_in_subject) {
                return Err(invalid(
                    "`subject` holds a line break or a control character",
                    "Give the subject on one line, as plain text.",
                ));
            }
            Ok(Some(text.clone()))
        }
        Some(_) => Err(invalid(
            format!("`{name}` is text"),
            format!("Pass `{name}` as a string."),
        )),
    }
}

/// A draft as a result gives it. With `body`, its whole body; else the
/// first 200 characters of it.
fn draft_json(row: &DraftRow, account: Option<&str>, tokens: &[TokenRow], whole: bool) -> Value {
    let body: String = if whole {
        row.body.clone()
    } else {
        row.body.chars().take(200).collect()
    };
    json!({
        "draft": row.id,
        "revision": row.revision,
        "account": row.account.0,
        // The address the account signs in with: the person's own, typed
        // when they added it.
        "from": account,
        "answers": row.answers,
        "recipients": row.recipients.count(),
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
        "discardedAt": row.discarded_at,
        "goesAt": row.discarded_at.map(|at| at + DISCARD_LIFETIME),
        "creator": proposer_json(&row.creator, tokens),
        "authors": {
            "recipients": proposer_json(&row.authors.recipients, tokens),
            "subject": proposer_json(&row.authors.subject, tokens),
            "body": proposer_json(&row.authors.body, tokens),
        },
        "content": content(json!({
            "to": row.recipients.to,
            "cc": row.recipients.cc,
            "bcc": row.recipients.bcc,
            "subject": row.subject,
            (if whole { "body" } else { "snippet" }): body,
            "bodyComplete": whole || row.body.chars().count() <= 200,
        })),
    })
}

/// A draft's result, read again with the account's address and the token
/// names.
fn result_of(engine: &Engine, row: &DraftRow) -> Result<Value, StoreError> {
    engine.with_store(|store| {
        let accounts = store.accounts()?;
        let tokens = store.tokens()?;
        let address = accounts
            .iter()
            .find(|account| account.id == row.account)
            .map(|account| account.address.clone());
        Ok(draft_json(row, address.as_deref(), &tokens, true))
    })
}

struct Create {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Create {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let now = context.clock().now();
        let creator = proposer_of(&context);
        let made = (|| -> Result<NewDraft, Box<CommandError>> {
            let recipients = recipients(&input, true)?.unwrap_or_default();
            let subject = text(&input, "subject", MOST_SUBJECT, true)?.unwrap_or_default();
            let body = text(&input, "body", MOST_BODY, false)?.unwrap_or_default();
            let account = integer(&input, "account")?;
            let answers = integer(&input, "answers")?;
            let account = self
                .engine
                .with_store(|store| {
                    let accounts = store.accounts()?;
                    let showing = match answers {
                        Some(message) => Some(store.accounts_showing(message)?),
                        None => None,
                    };
                    Ok((accounts, showing))
                })
                .map_err(|error| Box::new(store_failure(&error)))
                .and_then(|(accounts, showing)| {
                    pick_account(&accounts, account.map(AccountId), showing.as_deref())
                })?;
            Ok(NewDraft {
                account,
                answers,
                recipients,
                subject,
                body,
            })
        })();
        let draft = match made {
            Ok(draft) => draft,
            Err(error) => return failure(*error),
        };
        let row = match self.engine.with_store(|store| {
            store.purge_drafts(now)?;
            store.create_draft(&draft, &creator, now)
        }) {
            Ok(row) => row,
            Err(error) => return failure(store_failure(&error)),
        };
        match result_of(&self.engine, &row) {
            Ok(result) => success(result),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// The account a new draft is sent from: the one named, which must show the
/// message it answers if it answers one; else the one account that shows
/// that message, or the one account there is.
fn pick_account(
    accounts: &[crate::store::AccountRow],
    named: Option<AccountId>,
    showing: Option<&[AccountId]>,
) -> Result<AccountId, Box<CommandError>> {
    let not_found = || {
        Box::new(
            CommandError::new("ACCOUNT_NOT_FOUND", "no account has that id")
                .with_suggestion("Run `loam-mail mail-account-list` to see the accounts."),
        )
    };
    if let Some(showing) = showing
        && showing.is_empty()
    {
        return Err(Box::new(
            CommandError::new(
                "MESSAGE_NOT_FOUND",
                "no account's mailbox shows the message `answers` names",
            )
            .with_suggestion("Pass `answers` as a message id a list or a thread gave."),
        ));
    }
    match (named, showing) {
        (Some(named), _) if !accounts.iter().any(|account| account.id == named) => Err(not_found()),
        (Some(named), Some(showing)) if !showing.contains(&named) => Err(invalid(
            "the account named does not show the message `answers` names",
            "Leave `account` out, or name an account whose mailboxes show that message.",
        )),
        (Some(named), _) => Ok(named),
        (None, Some([one])) => Ok(*one),
        (None, Some(_)) => Err(invalid(
            "more than one account shows the message `answers` names",
            "Name the account to send from with `account`.",
        )),
        (None, None) => match accounts {
            [one] => Ok(one.id),
            [] => Err(not_found()),
            _ => Err(invalid(
                "there is more than one account",
                "Name the account to send from with `account`.",
            )),
        },
    }
}

fn recipient_parameters() -> Vec<afd::CommandParameter> {
    vec![
        parameter(
            "to",
            JsonSchemaType::Array,
            "Recipients, as bare addresses",
            false,
        ),
        parameter("cc", JsonSchemaType::Array, "Copied recipients", false),
        parameter(
            "bcc",
            JsonSchemaType::Array,
            "Recipients the others do not see",
            false,
        ),
        parameter(
            "subject",
            JsonSchemaType::String,
            "The subject, on one line (at most 998 characters)",
            false,
        ),
        parameter(
            "body",
            JsonSchemaType::String,
            "The body, as plain text (at most 48 KiB)",
            false,
        ),
    ]
}

/// `mail-draft-create`: makes a draft. Nothing is sent: a person sends it.
#[must_use]
pub fn create(engine: Arc<Engine>) -> CommandDefinition {
    let mut parameters = vec![
        parameter(
            "account",
            JsonSchemaType::Integer,
            "The account to send from; left out, the one that shows the message answered, or the only account",
            false,
        ),
        parameter(
            "answers",
            JsonSchemaType::Integer,
            "The message it answers, by id",
            false,
        ),
    ];
    parameters.extend(recipient_parameters());
    CommandDefinition::new(
        "mail-draft-create",
        "Write a draft; a person sends it",
        parameters,
        Create { engine },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

struct Update {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Update {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let now = context.clock().now();
        let author = proposer_of(&context);
        let asked = (|| -> Result<(i64, i64, DraftChange), Box<CommandError>> {
            let id = required(&input, "draft")?;
            let revision = integer(&input, "revision")?.ok_or_else(|| {
                invalid(
                    "`revision` is required",
                    "Pass the revision mail-draft-show gave, so that a change made since is not overwritten.",
                )
            })?;
            let change = DraftChange {
                recipients: recipients(&input, false)?,
                subject: text(&input, "subject", MOST_SUBJECT, true)?,
                body: text(&input, "body", MOST_BODY, false)?,
            };
            if change == DraftChange::default() {
                return Err(invalid(
                    "nothing to change is named",
                    "Name one or more of: to, cc, bcc, subject, body.",
                ));
            }
            Ok((id, revision, change))
        })();
        let (id, revision, change) = match asked {
            Ok(asked) => asked,
            Err(error) => return failure(*error),
        };
        let changed = self.engine.with_store(|store| {
            store.purge_drafts(now)?;
            store.update_draft(id, revision, &change, &author, now)
        });
        finish(&self.engine, id, changed)
    }
}

fn finish(
    engine: &Engine,
    id: i64,
    changed: Result<Result<DraftRow, DraftRefusal>, StoreError>,
) -> CommandResult<Value> {
    match changed {
        Ok(Ok(row)) => match result_of(engine, &row) {
            Ok(result) => success(result),
            Err(error) => failure(store_failure(&error)),
        },
        Ok(Err(why)) => failure(refusal(id, why)),
        Err(error) => failure(store_failure(&error)),
    }
}

/// `mail-draft-update`: changes a draft's recipients, subject or body, from
/// the revision the caller read.
#[must_use]
pub fn update(engine: Arc<Engine>) -> CommandDefinition {
    let mut parameters = vec![
        parameter("draft", JsonSchemaType::Integer, "The draft, by id", true),
        parameter(
            "revision",
            JsonSchemaType::Integer,
            "The revision the change is made from, as mail-draft-show gave it",
            true,
        ),
    ];
    parameters.extend(recipient_parameters());
    CommandDefinition::new(
        "mail-draft-update",
        "Change a draft's recipients, subject or body; the recipients are replaced together",
        parameters,
        Update { engine },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

struct Discard {
    engine: Arc<Engine>,
    discard: bool,
}

#[async_trait]
impl CommandHandler for Discard {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let now = context.clock().now();
        let id = match required(&input, "draft") {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        let changed = self.engine.with_store(|store| {
            store.purge_drafts(now)?;
            store.set_draft_discarded(id, self.discard, now)
        });
        finish(&self.engine, id, changed)
    }
}

/// `mail-draft-discard`: puts a draft aside for 30 days, when it goes;
/// `mail-draft-restore` brings it back until then (M29).
#[must_use]
pub fn discard(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-draft-discard",
        "Discard a draft: it is held for 30 days, and mail-draft-restore brings it back",
        vec![parameter(
            "draft",
            JsonSchemaType::Integer,
            "The draft, by id",
            true,
        )],
        Discard {
            engine,
            discard: true,
        },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

/// `mail-draft-restore`: brings back a draft discarded in the last 30 days.
#[must_use]
pub fn restore(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-draft-restore",
        "Bring back a draft discarded in the last 30 days",
        vec![parameter(
            "draft",
            JsonSchemaType::Integer,
            "The draft, by id",
            true,
        )],
        Discard {
            engine,
            discard: false,
        },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

struct List {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for List {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let now = context.clock().now();
        let read = || -> Result<Value, Box<CommandError>> {
            let discarded = match input.get("discarded") {
                None | Some(Value::Null) => false,
                Some(Value::Bool(value)) => *value,
                Some(_) => {
                    return Err(invalid(
                        "`discarded` is true or false",
                        "Pass `discarded: true` to list the discarded drafts.",
                    ));
                }
            };
            let limit = limit(&input, 50, 200)?;
            let before = cursor(&input)?;
            let (rows, accounts, tokens) = self
                .engine
                .with_store(|store| {
                    store.purge_drafts(now)?;
                    Ok((
                        store.drafts(discarded, before, limit + 1)?,
                        store.accounts()?,
                        store.tokens()?,
                    ))
                })
                .map_err(|error| Box::new(store_failure(&error)))?;
            let more = rows.len() > limit as usize;
            let items: Vec<Value> = rows
                .iter()
                .take(limit as usize)
                .map(|row| {
                    let address = accounts
                        .iter()
                        .find(|account| account.id == row.account)
                        .map(|account| account.address.as_str());
                    draft_json(row, address, &tokens, false)
                })
                .collect();
            let (kept, cut) = crate::read::fit(items, budget(&context, crate::read::LIST_BUDGET));
            let next = (more || cut)
                .then(|| kept.last())
                .flatten()
                .map(|last| format!("{}.{}", last["updatedAt"], last["draft"]));
            Ok(json!({ "drafts": kept, "nextCursor": next }))
        };
        match read() {
            Ok(result) => success(result),
            Err(error) => failure(*error),
        }
    }
}

/// `mail-draft-list`: the drafts, the most recently changed first, paged by
/// cursor; with `discarded`, those discarded and when each goes.
#[must_use]
pub fn list(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-draft-list",
        "List the drafts, the most recently changed first",
        vec![
            parameter(
                "discarded",
                JsonSchemaType::Boolean,
                "List the discarded drafts instead, with when each goes",
                false,
            ),
            parameter(
                "cursor",
                JsonSchemaType::String,
                "Where the page before ended",
                false,
            ),
            parameter(
                "limit",
                JsonSchemaType::Integer,
                "At most this many drafts (1 to 200)",
                false,
            ),
        ],
        List { engine },
    )
    .with_expose(read_exposure())
}

struct Show {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Show {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let now = context.clock().now();
        let id = match required(&input, "draft") {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        let row = match self.engine.with_store(|store| {
            store.purge_drafts(now)?;
            store.draft(id)
        }) {
            Ok(Some(row)) => row,
            Ok(None) => return failure(draft_not_found(id)),
            Err(error) => return failure(store_failure(&error)),
        };
        match result_of(&self.engine, &row) {
            Ok(result) if fits(&result, budget(&context, SHOW_BUDGET)) => success(result),
            Ok(_) => failure(too_small(budget(&context, SHOW_BUDGET))),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-draft-show`: one draft whole, with who wrote each part. It is the
/// preview of a send: what a person reads before approving one.
#[must_use]
pub fn show(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-draft-show",
        "Show a draft whole: its account, recipients, subject, body and who wrote each",
        vec![parameter(
            "draft",
            JsonSchemaType::Integer,
            "The draft, by id",
            true,
        )],
        Show { engine },
    )
    .with_output_budget(SHOW_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}

struct Snooze {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Snooze {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let now = context.clock().now();
        let creator = proposer_of(&context);
        let asked = (|| -> Result<(i64, Option<i64>), Box<CommandError>> {
            let thread = required(&input, "thread")?;
            let until = integer(&input, "until")?;
            if let Some(until) = until
                && (until <= now || until > now + MOST_SNOOZE)
            {
                return Err(invalid(
                    "`until` is not within the next year",
                    "Give a time in milliseconds after now and within a year, or leave it out to end the snooze.",
                ));
            }
            Ok((thread, until))
        })();
        let (thread, until) = match asked {
            Ok(asked) => asked,
            Err(error) => return failure(*error),
        };
        let done = self.engine.with_store(|store| {
            if !store.thread_exists(ThreadId(thread))? {
                return Ok(None);
            }
            store.snooze_thread(thread, until, &creator, now).map(Some)
        });
        match done {
            Ok(Some(before)) => success(json!({
                "thread": thread,
                "until": until,
                // Snoozing again until this, or ending the snooze when it
                // is null, undoes the change.
                "previous": before,
            })),
            Ok(None) => failure(
                CommandError::new("THREAD_NOT_FOUND", "no thread has that id").with_suggestion(
                    "Run `loam-mail mail-thread-list` to see a mailbox's threads.",
                ),
            ),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-thread-snooze`: hides a thread from its mailboxes' lists until a
/// time, or until mail arrives in it; without `until`, ends its snooze.
#[must_use]
pub fn snooze(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-thread-snooze",
        "Hide a thread from mailbox lists until a time or until mail arrives in it; leave `until` out to end the snooze",
        vec![
            parameter("thread", JsonSchemaType::Integer, "The thread, by id", true),
            parameter(
                "until",
                JsonSchemaType::Integer,
                "When it comes back, in milliseconds since 1970, within a year",
                false,
            ),
        ],
        Snooze { engine },
    )
    .as_mutation()
    .with_expose(read_exposure())
}

#[cfg(test)]
mod tests {
    use super::address;

    #[test]
    fn an_address_is_plain_or_refused() {
        assert_eq!(
            address(" Someone@Example.COM "),
            Some("Someone@example.com".to_string())
        );
        for refused in [
            "",
            "someone",
            "someone@localhost",
            "Some One <someone@example.com>",
            "a@example.com, b@example.com",
            "a@@example.com",
            "a@example..com",
            "a@.example.com",
            "a\r\nBcc: b@example.com",
            "\"quoted\"@example.com",
        ] {
            assert_eq!(address(refused), None, "{refused:?}");
        }
    }
}
