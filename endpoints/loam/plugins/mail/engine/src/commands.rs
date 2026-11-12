//! The engine's commands (the specification's section 11), a step at a time.

use std::sync::Arc;

use afd::{
    ApprovalDecision, ApprovalPolicy, CommandContext, CommandDefinition, CommandError,
    CommandHandler, CommandInterface, CommandParameter, CommandResult, ExposeOptions,
    JsonSchemaType, failure, success,
};
use async_trait::async_trait;
use serde_json::json;

use crate::engine::Engine;
use crate::provider::ProviderError;
use crate::secrets::account_key;
use crate::store::{AccountRow, MailboxRow, MailboxStatus, StoreError};
use crate::sync::{AccountReport, SyncError, WHOLE_LIMIT, sync_account};

/// A store's refusal as a command's failure, in the engine's own words.
#[must_use]
pub fn store_failure(error: &StoreError) -> CommandError {
    match error {
        StoreError::InUse => CommandError::new("STORE_IN_USE", error.to_string())
            .with_suggestion("Stop the other loam-mail process, or send the command to it."),
        StoreError::Newer { .. } => CommandError::new("STORE_NEWER", error.to_string())
            .with_suggestion("Use the newer loam-mail that wrote this store."),
        StoreError::IndexStale => CommandError::new("INDEX_STALE", error.to_string())
            .with_suggestion("Run `loam-mail mail-rebuild`."),
        other => CommandError::new("STORE_FAILED", other.to_string())
            .with_suggestion("Check the data directory and its disk, then try again."),
    }
}

/// Exposed to the command line alone: not to MCP, the in-app agent or the
/// palette (the specification's section 11).
fn command_line_only() -> ExposeOptions {
    ExposeOptions::new()
        .with_cli(true)
        .with_agent(false)
        .with_palette(false)
}

struct Rebuild {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Rebuild {
    async fn execute(
        &self,
        _input: serde_json::Value,
        context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        let now = context.clock().now();
        let engine = &self.engine;
        let rebuilt = engine.with_store(|store| {
            let resumed = store.rebuilding()?;
            let mut reported = 0;
            let done = store.rebuild(now, |progress| {
                // A line for each ten thousand messages, and one at the end.
                if progress.finished || progress.done >= reported + 10_000 {
                    reported = progress.done;
                    engine.report(&format!(
                        "rebuilt {} of {} messages",
                        progress.done, progress.total
                    ));
                }
            })?;
            Ok((resumed, done.total, store.thread_count()?))
        });
        match rebuilt {
            Ok((resumed, messages, threads)) => success(json!({
                "messages": messages,
                "threads": threads,
                "resumed": resumed,
            })),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-rebuild`: recomputes every derived table and the search index from
/// the log (the specification's section 4.3).
#[must_use]
pub fn rebuild(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-rebuild",
        "Recompute threads, parts and the search index from the stored mail",
        vec![],
        Rebuild { engine },
    )
    .as_mutation()
    .with_expose(command_line_only())
}

/// How long `mail-sync` with `follow` waits between passes. IDLE, which
/// would wake it at once for the inbox, arrives with `serve` (step B5).
const FOLLOW_EVERY: std::time::Duration = std::time::Duration::from_secs(5 * 60);

/// An optional integer parameter.
fn optional(name: &str, kind: JsonSchemaType, description: &str) -> CommandParameter {
    CommandParameter {
        name: name.to_string(),
        param_type: kind,
        description: description.to_string(),
        required: false,
        default: None,
        enum_values: None,
        schema: None,
    }
}

/// The account a command's input names, if it names one.
fn account_input(input: &serde_json::Value) -> Result<Option<i64>, Box<CommandError>> {
    match input.get("account") {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(value) => value.as_i64().map(Some).ok_or_else(|| {
            Box::new(
                CommandError::new("INVALID_INPUT", "`account` is an account's id, a number")
                    .with_suggestion("Run `loam-mail mail-status` to see the accounts' ids."),
            )
        }),
    }
}

/// The accounts a command acts on: the one named, or every one.
fn accounts_for(engine: &Engine, named: Option<i64>) -> Result<Vec<AccountRow>, Box<CommandError>> {
    let accounts = engine
        .with_store(|store| store.accounts())
        .map_err(|error| Box::new(store_failure(&error)))?;
    let accounts: Vec<AccountRow> = accounts
        .into_iter()
        .filter(|account| named.is_none_or(|id| account.id.0 == id))
        .collect();
    if accounts.is_empty() {
        let error = match named {
            Some(_) => CommandError::new("ACCOUNT_NOT_FOUND", "no account has that id")
                .with_suggestion("Run `loam-mail mail-status` to see the accounts' ids."),
            None => CommandError::new("ACCOUNT_NOT_FOUND", "no account has been added")
                .with_suggestion("Add an account first."),
        };
        return Err(Box::new(error));
    }
    Ok(accounts)
}

/// Why a pass stopped, as a command's failure.
fn sync_failure(error: &SyncError) -> CommandError {
    match error {
        SyncError::Store(error) => store_failure(error),
        SyncError::Provider(ProviderError::SignIn) => {
            CommandError::new("SIGN_IN_REQUIRED", error.to_string())
                .with_suggestion("Sign in to the account again.")
        }
        SyncError::Provider(ProviderError::Keychain) => {
            CommandError::new("SIGN_IN_REQUIRED", error.to_string())
                .with_suggestion("Unlock the keychain, then try again.")
        }
        SyncError::Provider(ProviderError::NoCredential) => {
            CommandError::new("SIGN_IN_REQUIRED", error.to_string())
                .with_suggestion("Store the account's sign-in, then sync again.")
        }
        SyncError::Provider(_) => CommandError::new("PROVIDER_UNAVAILABLE", error.to_string())
            .with_suggestion(
                "Check the network, then run `loam-mail mail-sync` again; it carries on where it stopped.",
            )
            .with_retryable(true),
    }
}

/// A pass's report as a result: ids and counts.
fn report_json(report: &AccountReport) -> serde_json::Value {
    json!({
        "account": report.account,
        "mailboxes": report.mailboxes.iter().map(|mailbox| json!({
            "mailbox": mailbox.mailbox,
            "role": mailbox.role,
            "listedInFull": mailbox.listed_in_full,
            "added": mailbox.added,
            "changed": mailbox.changed,
            "removed": mailbox.removed,
            "notReturned": mailbox.not_returned,
            "bodies": mailbox.bodies,
            "repaired": mailbox.repaired,
            "setAside": mailbox.set_aside,
            "error": mailbox.error,
        })).collect::<Vec<_>>(),
    })
}

struct Sync {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Sync {
    async fn execute(
        &self,
        input: serde_json::Value,
        context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        let named = match account_input(&input) {
            Ok(named) => named,
            Err(error) => return failure(*error),
        };
        let follow = input
            .get("follow")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        if follow && context.interface != Some(CommandInterface::Cli) {
            return failure(
                CommandError::new("INVALID_INPUT", "`follow` runs only at the command line")
                    .with_suggestion("Call mail-sync without `follow`; each call runs one pass."),
            );
        }
        let engine = &self.engine;
        let Some(connector) = engine.connector().cloned() else {
            return failure(CommandError::new(
                "PROVIDER_UNAVAILABLE",
                "this build of the engine cannot reach a provider",
            ));
        };
        let accounts = match accounts_for(engine, named) {
            Ok(accounts) => accounts,
            Err(error) => return failure(*error),
        };
        let clock = context.clock();
        loop {
            let mut reports = Vec::new();
            for account in &accounts {
                let progress = |line: &str| {
                    engine.report(&format!("account {}: {line}", account.id.0));
                };
                match sync_account(
                    engine,
                    connector.as_ref(),
                    account,
                    engine.sync_options(),
                    clock,
                    &progress,
                )
                .await
                {
                    Ok(report) => reports.push(report_json(&report)),
                    // One account is the whole answer; with several, the
                    // others still sync and the failure is reported beside them.
                    Err(error) if accounts.len() == 1 => return failure(sync_failure(&error)),
                    Err(error) => {
                        let error = sync_failure(&error);
                        reports.push(json!({
                            "account": account.id.0,
                            "error": { "code": error.code, "message": error.message },
                        }));
                    }
                }
            }
            if !follow {
                return success(json!({ "accounts": reports }));
            }
            engine.report("waiting five minutes before the next pass");
            tokio::time::sleep(FOLLOW_EVERY).await;
        }
    }
}

/// `mail-sync`: runs a pass of sync over every account, or the one named
/// (the specification's section 5.7). With `follow`, at the command line, it
/// keeps syncing until stopped.
#[must_use]
pub fn sync(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-sync",
        "Bring mail from the accounts' providers into the store",
        vec![
            optional(
                "account",
                JsonSchemaType::Integer,
                "The account to sync; every account when left out",
            ),
            optional(
                "follow",
                JsonSchemaType::Boolean,
                "At the command line: keep syncing until stopped",
            ),
        ],
        Sync { engine },
    )
    .as_mutation()
    .with_expose(ExposeOptions::new().with_cli(true).with_mcp(true))
}

/// A mailbox's state (the specification's section 5.7).
fn mailbox_state(row: &MailboxRow, status: &MailboxStatus) -> &'static str {
    if row.cursor.is_none() || status.counts.awaited > 0 {
        "listing"
    } else if row.header_only || status.bodies_wanted == 0 {
        "synced"
    } else {
        "listed"
    }
}

struct Status {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Status {
    async fn execute(
        &self,
        input: serde_json::Value,
        _context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        let named = match account_input(&input) {
            Ok(named) => named,
            Err(error) => return failure(*error),
        };
        let accounts = match accounts_for(&self.engine, named) {
            Ok(accounts) => accounts,
            Err(error) => return failure(*error),
        };
        let read = self.engine.with_store(|store| {
            let mut result = Vec::new();
            for account in &accounts {
                let mut mailboxes = Vec::new();
                let mut synced = true;
                for row in store.mailboxes(account.id)? {
                    if row.gone {
                        continue;
                    }
                    let status = store.mailbox_status(row.id, WHOLE_LIMIT)?;
                    let state = mailbox_state(&row, &status);
                    synced &= state == "synced";
                    mailboxes.push(json!({
                        "mailbox": row.id.0,
                        // The name is the provider's text: labelled as
                        // content (the specification's section 12.1).
                        "name": { "trust": "content", "text": row.name },
                        "role": row.role.as_str(),
                        "state": state,
                        "listed": row.listed,
                        "headers": status.counts.headers_held,
                        "bodies": status.counts.bodies_held,
                        "bodiesWanted": if row.header_only { 0 } else { status.bodies_wanted },
                        "bodiesUnreturned": status.bodies_unreturned,
                        "awaited": status.counts.awaited,
                        "unreturned": status.counts.unreturned,
                        "lastPassAt": row.last_pass_at,
                        "lastError": row.last_error,
                    }));
                }
                result.push(json!({
                    "account": account.id.0,
                    "provider": account.provider,
                    "synced": synced && !mailboxes.is_empty(),
                    "mailboxes": mailboxes,
                }));
            }
            Ok(result)
        });
        match read {
            Ok(accounts) => success(json!({ "accounts": accounts })),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-status`: each account's sync state, mailbox by mailbox (the
/// specification's section 5.7).
#[must_use]
pub fn status(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-status",
        "Show how far each account's mail has synced",
        vec![optional(
            "account",
            JsonSchemaType::Integer,
            "The account to show; every account when left out",
        )],
        Status { engine },
    )
    .with_expose(ExposeOptions::new().with_cli(true).with_mcp(true))
}

/// The providers an account can be added for in this build.
const PROVIDERS: &[&str] = &["icloud"];

/// The longest address an account may have (RFC 5321's path limit).
const MOST_ADDRESS: usize = 254;

/// A secret the command line asks the person for, without echo, and keeps in
/// the keychain before it runs a command: never in the command's input
/// (the specification's section 3.5).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CredentialAsk {
    /// Where the secret is kept.
    pub key: String,
    /// What the command line asks.
    pub prompt: String,
}

/// The secret the command line must ask for before running `command` with
/// `input`, if any.
#[must_use]
pub fn credential_for(command: &str, input: &serde_json::Value) -> Option<CredentialAsk> {
    if command != "mail-account-add" {
        return None;
    }
    let (provider, address) = account_fields(input).ok()?;
    Some(CredentialAsk {
        key: account_key(provider, &address),
        prompt: format!("App-specific password for {address} (not shown): "),
    })
}

/// What the person is asked to approve for a person's command, in the
/// engine's words: `None` for the command's own prompt. The account's
/// address is the person's own, typed at the terminal, not text from mail.
#[must_use]
pub fn approval_summary(command: &str, input: &serde_json::Value) -> Option<String> {
    if command != "mail-account-add" {
        return None;
    }
    let (provider, address) = account_fields(input).ok()?;
    Some(format!(
        "Add the {provider} account {address}, and sign in to check that the sign-in works"
    ))
}

/// `mail-account-add`'s provider and address, checked, with the address's
/// domain in lower case, so that one account is not added twice by a
/// difference of case.
fn account_fields(input: &serde_json::Value) -> Result<(&str, String), Box<CommandError>> {
    let provider = input
        .get("provider")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if !PROVIDERS.contains(&provider) {
        return Err(Box::new(
            CommandError::new("INVALID_INPUT", "`provider` is not one this build can add")
                .with_suggestion("Use `icloud`. Gmail arrives with a later step."),
        ));
    }
    let address = input
        .get("address")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let plausible = address.len() <= MOST_ADDRESS
        && address
            .split_once('@')
            .is_some_and(|(local, domain)| !local.is_empty() && domain.contains('.'))
        && !address.chars().any(|c| c.is_whitespace() || c.is_control());
    if !plausible {
        return Err(Box::new(
            CommandError::new("INVALID_INPUT", "`address` is not an email address")
                .with_suggestion("Give the address the account signs in with."),
        ));
    }
    let (local, domain) = address.split_once('@').unwrap_or((address, ""));
    Ok((provider, format!("{local}@{}", domain.to_ascii_lowercase())))
}

struct AccountAdd {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for AccountAdd {
    async fn execute(
        &self,
        input: serde_json::Value,
        context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        let (provider, address) = match account_fields(&input) {
            Ok(fields) => fields,
            Err(error) => return failure(*error),
        };
        let address = address.as_str();
        let engine = &self.engine;
        // The sign-in is the keychain's: the command line put it there.
        match engine.secrets().get(&account_key(provider, address)) {
            Ok(Some(_)) => {}
            Ok(None) => {
                return failure(
                    CommandError::new("SIGN_IN_REQUIRED", "there is no stored sign-in for the account")
                        .with_suggestion(
                            "Run `loam-mail mail-account-add` at a terminal; it asks for the app-specific password.",
                        ),
                );
            }
            Err(error) => {
                return failure(
                    CommandError::new("SIGN_IN_REQUIRED", error.to_string())
                        .with_suggestion("Unlock the keychain, then try again."),
                );
            }
        }
        let Some(connector) = engine.connector().cloned() else {
            return failure(CommandError::new(
                "PROVIDER_UNAVAILABLE",
                "this build of the engine cannot reach a provider",
            ));
        };
        // Signing in proves the sign-in works; nothing is read or changed.
        let candidate = AccountRow {
            id: crate::store::AccountId(0),
            provider: provider.to_string(),
            address: address.to_string(),
        };
        match connector.connect(&candidate).await {
            Ok(mut session) => session.close().await,
            Err(error) => return failure(sync_failure(&SyncError::Provider(error))),
        }
        let now = context.clock().now();
        let added = engine.with_store(|store| {
            let existed = store
                .accounts()?
                .iter()
                .any(|account| account.provider == provider && account.address == address);
            let account = store.add_account(provider, address, now)?;
            Ok((account, !existed))
        });
        match added {
            Ok((account, new)) => success(json!({
                "account": account.0,
                "provider": provider,
                "added": new,
            })),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-account-add`: adds an account once its sign-in, which the command
/// line keeps in the keychain, works. A person's command (the
/// specification's section 3.5).
#[must_use]
pub fn account_add(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-account-add",
        "Add a mail account, checking that its sign-in works",
        vec![
            CommandParameter {
                name: "provider".to_string(),
                param_type: JsonSchemaType::String,
                description: "The account's provider: icloud".to_string(),
                required: true,
                default: None,
                enum_values: Some(PROVIDERS.iter().map(|provider| json!(provider)).collect()),
                schema: None,
            },
            CommandParameter::required_string("address", "The address the account signs in with"),
        ],
        AccountAdd { engine },
    )
    .as_mutation()
    .with_confirm_prompt("Add the account and sign in to check that the sign-in works")
    // Input that cannot be added is refused by the handler without asking
    // the person about it; anything else waits for the person's approval.
    .with_approval(ApprovalPolicy::when(|input, _context| {
        if account_fields(input).is_ok() {
            ApprovalDecision::Required
        } else {
            ApprovalDecision::NotRequired
        }
    }))
    .with_expose(command_line_only())
}

struct AccountList {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for AccountList {
    async fn execute(
        &self,
        _input: serde_json::Value,
        _context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        match self.engine.with_store(|store| store.accounts()) {
            Ok(accounts) => success(json!({
                "accounts": accounts.iter().map(|account| json!({
                    "account": account.id.0,
                    "provider": account.provider,
                    "address": account.address,
                })).collect::<Vec<_>>(),
            })),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-account-list`: the accounts the engine syncs.
#[must_use]
pub fn account_list(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-account-list",
        "List the mail accounts",
        vec![],
        AccountList { engine },
    )
    .with_expose(ExposeOptions::new().with_cli(true).with_mcp(true))
}
