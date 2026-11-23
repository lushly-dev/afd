//! `mail-selection-create` (the specification's 9.1): a query resolved once
//! and frozen, which a change then acts on, stating its count
//! ([`crate::changes`]).
//!
//! A selection is the caller's own data and changes no mail, so an agent
//! makes one over MCP. Its query is journaled as the caller's input (13.1);
//! the sample in its result is mail, labelled as content (12.1), and left
//! out of the journal, which keeps nothing that was read.

use std::sync::Arc;

use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandParameter,
    CommandResult, JsonSchemaType, failure, success,
};
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::commands::store_failure;
use crate::engine::Engine;
use crate::read::{LIST_BUDGET, MOST_BUDGET, budget, fit, integer, parameter, read_exposure};
use crate::screening::{proposer_of, sender_not_found};
use crate::store::{
    AccountId, Class, MailboxId, Readiness, Selected, SelectionQuery, SelectionRow, Store,
    StoreError,
};

/// The name of the command that makes a selection.
pub const CREATE: &str = "mail-selection-create";

/// How many of a selection's newest messages its result shows.
const SAMPLE: u32 = 5;

/// The longest search text a query may hold.
const MOST_TEXT: usize = 512;

/// The fields a query may name, as its input writes them.
const FIELDS: &[&str] = &[
    "account", "mailbox", "sender", "story", "class", "after", "before", "unread", "text",
];

fn invalid(message: &str, suggestion: &str) -> Box<CommandError> {
    Box::new(CommandError::new("INVALID_INPUT", message).with_suggestion(suggestion))
}

/// The query a command's input names, checked for its form alone; whether
/// what it names exists is checked against the store.
fn query_input(input: &Value) -> Result<(SelectionQuery, Option<i64>), Box<CommandError>> {
    let class = match input.get("class") {
        None | Some(Value::Null) => None,
        Some(value) => Some(value.as_str().and_then(Class::parse).ok_or_else(|| {
            invalid(
                "`class` is not a screening class",
                "Use known, unknown, bulk or blocked.",
            )
        })?),
    };
    let unread = match input.get("unread") {
        None | Some(Value::Null) => None,
        Some(value) => Some(value.as_bool().ok_or_else(|| {
            invalid(
                "`unread` is true or false",
                "Pass true for unread mail, false for read mail.",
            )
        })?),
    };
    let text = match input.get("text") {
        None | Some(Value::Null) => None,
        Some(value) => {
            let text = value.as_str().map(str::trim).unwrap_or_default();
            if text.is_empty() || text.chars().count() > MOST_TEXT {
                return Err(invalid(
                    "`text` is a search of 1 to 512 characters",
                    "Pass the words to look for, as mail-search takes them.",
                ));
            }
            Some(text.to_string())
        }
    };
    let safe_int = |name: &str| -> Result<Option<i64>, Box<CommandError>> {
        const MAX_SAFE: i64 = (1i64 << 53) - 1;
        let value = integer(input, name)?;
        if let Some(n) = value
            && !(-MAX_SAFE..=MAX_SAFE).contains(&n)
        {
            return Err(invalid(
                &format!("`{name}` is outside the exact JSON integer range (±{MAX_SAFE})"),
                &format!("Pass `{name}` within ±{MAX_SAFE}."),
            ));
        }
        Ok(value)
    };
    let query = SelectionQuery {
        account: safe_int("account")?.map(AccountId),
        mailbox: safe_int("mailbox")?.map(MailboxId),
        // The sender's address is read from the store by its id.
        sender: None,
        story: safe_int("story")?,
        class,
        after: safe_int("after")?,
        before: safe_int("before")?,
        unread,
        text,
    };
    let sender = safe_int("sender")?;
    if query.is_empty() && sender.is_none() {
        return Err(invalid(
            "a selection names at least one of its fields",
            "Name a mailbox, an account, a sender, a story, a class, dates, read or unread, or text.",
        ));
    }
    if let (Some(after), Some(before)) = (query.after, query.before)
        && after >= before
    {
        return Err(invalid(
            "`after` is not before `before`",
            "Give dates in milliseconds, `after` the earlier.",
        ));
    }
    Ok((query, sender))
}

/// The query as it is kept and journaled: the fields the caller gave.
fn written(input: &Value) -> String {
    let kept: serde_json::Map<String, Value> = FIELDS
        .iter()
        .filter_map(|field| {
            input
                .get(*field)
                .filter(|value| !value.is_null())
                .map(|value| ((*field).to_string(), value.clone()))
        })
        .collect();
    Value::Object(kept).to_string()
}

/// The failure of a selection while what it reads could be wrong.
fn not_ready(readiness: Readiness) -> CommandError {
    let message = if readiness.rebuilding {
        "a rebuild is under way, and a selection waits for it to finish".to_string()
    } else {
        format!(
            "{} messages wait to be derived again, and a selection waits for them: until then a query could count only some of the mail it names",
            readiness.stale
        )
    };
    CommandError::new("SCREENING_NOT_READY", message)
        .with_suggestion(
            "Try again once `loam-mail mail-status` shows `screening.ready`: a running server derives them in the background.",
        )
        .with_retryable(true)
}

/// Checks that what `query` names exists, and fills in the sender's
/// address from its id.
fn named(
    store: &Store,
    query: &mut SelectionQuery,
    sender: Option<i64>,
) -> Result<Result<(), CommandError>, StoreError> {
    if let Some(account) = query.account
        && !store.accounts()?.iter().any(|row| row.id == account)
    {
        return Ok(Err(CommandError::new(
            "ACCOUNT_NOT_FOUND",
            "no account has that id",
        )
        .with_suggestion(
            "Run `loam-mail mail-status` to see the accounts' ids.",
        )));
    }
    if let Some(mailbox) = query.mailbox
        && !store.mailbox_exists(mailbox)?
    {
        return Ok(Err(CommandError::new(
            "MAILBOX_NOT_FOUND",
            "no mailbox has that id",
        )
        .with_suggestion(
            "Run `loam-mail mail-status` to see the mailboxes' ids.",
        )));
    }
    // A mailbox and an account that does not hold it name nothing: refused,
    // so that a mistaken id is not taken for an empty selection.
    if let (Some(mailbox), Some(account)) = (query.mailbox, query.account)
        && !store
            .mailboxes(account)?
            .iter()
            .any(|row| row.id == mailbox)
    {
        return Ok(Err(CommandError::new(
            "MAILBOX_NOT_FOUND",
            "the account named has no mailbox with that id",
        )
        .with_suggestion(
            "Run `loam-mail mail-status` to see each account's mailboxes.",
        )));
    }
    if let Some(story) = query.story
        && store.story(story)?.is_none()
    {
        return Ok(Err(CommandError::new(
            "STORY_NOT_FOUND",
            "no story has that id",
        )
        .with_suggestion(
            "Run `loam-mail mail-story-list` to see the stories.",
        )));
    }
    if let Some(id) = sender {
        let Some(row) = store.sender(id)? else {
            return Ok(Err(sender_not_found()));
        };
        query.sender = Some(row.address);
    }
    Ok(Ok(()))
}

/// A selection as a result gives it, without its sample.
#[must_use]
pub fn selection_json(row: &SelectionRow) -> Value {
    json!({
        "selection": row.id,
        "count": row.count(),
        "messages": row.messages,
        "threads": row.threads,
        "unreturned": row.unreturned,
        "createdAt": row.created_at,
        "expiresAt": row.expires_at,
    })
}

struct Create {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Create {
    async fn execute(&self, input: Value, context: CommandContext) -> CommandResult<Value> {
        let (mut query, sender) = match query_input(&input) {
            Ok(query) => query,
            Err(error) => return failure(*error),
        };
        let written = written(&input);
        let creator = proposer_of(&context);
        let now = context.clock().now();
        let made = self.engine.with_store(|store| {
            let readiness = store.screening_readiness()?;
            if !readiness.ready() {
                return Ok(Err(not_ready(readiness)));
            }
            if let Err(error) = named(store, &mut query, sender)? {
                return Ok(Err(error));
            }
            let row = match store.select(&query, &written, &creator, now)? {
                Selected::Made(row) => row,
                Selected::Unreadable => {
                    return Ok(Err(CommandError::new(
                        "INVALID_INPUT",
                        "`text` cannot be read as a search in full, and a selection never searches for less than it is given",
                    )
                    .with_suggestion(
                        "Give plain words, each of which must match; leave out quotes, colons and brackets.",
                    )));
                }
                Selected::TooMany(most) => {
                    return Ok(Err(CommandError::new(
                        "POLICY_LIMIT",
                        format!("this caller holds {most} selections already, the most it may"),
                    )
                    .with_suggestion(
                        "Act on one you hold, or wait: a selection expires an hour after it was made.",
                    )));
                }
            };
            let sample = store.selection_sample(row.id, SAMPLE)?;
            Ok(Ok((row, sample)))
        });
        let (row, sample) = match made {
            Ok(Ok(made)) => made,
            Ok(Err(error)) => return failure(error),
            Err(error) => return failure(store_failure(&error)),
        };
        let mut items = Vec::with_capacity(sample.len());
        for listed in &sample {
            match crate::read::message_item(&self.engine, listed) {
                Ok(item) => items.push(item),
                Err(error) => return failure(store_failure(&error)),
            }
        }
        let (sample, _) = fit(items, budget(&context, LIST_BUDGET));
        let mut result = selection_json(&row);
        result["sample"] = json!(sample);
        success(result)
    }
}

/// `mail-selection-create`: resolves a query once and freezes the mail it
/// finds, for a change to act on within the hour.
#[must_use]
pub fn create(engine: Arc<Engine>) -> CommandDefinition {
    let field = |name: &str, kind: JsonSchemaType, description: &str| -> CommandParameter {
        parameter(name, kind, description, false)
    };
    CommandDefinition::new(
        CREATE,
        "Select mail by a query and freeze it, for a change to act on within the hour",
        vec![
            field("account", JsonSchemaType::Integer, "One account's mail"),
            field(
                "mailbox",
                JsonSchemaType::Integer,
                "One mailbox's mail. Without it, mail only junk or trash shows is left out",
            ),
            field(
                "sender",
                JsonSchemaType::Integer,
                "One sender's mail, by id",
            ),
            field("story", JsonSchemaType::Integer, "One story's mail, by id"),
            CommandParameter {
                enum_values: Some(vec![
                    json!("known"),
                    json!("unknown"),
                    json!("bulk"),
                    json!("blocked"),
                ]),
                ..field(
                    "class",
                    JsonSchemaType::String,
                    "One screening class's mail",
                )
            },
            field(
                "after",
                JsonSchemaType::Integer,
                "Mail dated this time or later, in milliseconds",
            ),
            field(
                "before",
                JsonSchemaType::Integer,
                "Mail dated before this time, in milliseconds",
            ),
            field(
                "unread",
                JsonSchemaType::Boolean,
                "true for unread mail only, false for read mail only",
            ),
            field(
                "text",
                JsonSchemaType::String,
                "Mail whose subject or held text holds every one of these words, every match",
            ),
        ],
        Create { engine },
    )
    .as_mutation()
    .with_output_budget(LIST_BUDGET, MOST_BUDGET)
    .with_expose(read_exposure())
}
