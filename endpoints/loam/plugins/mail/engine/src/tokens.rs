//! The tokens a running server accepts (the specification's 3.3 and 3.4),
//! and the person's commands that make, list and revoke the agents' ones.
//!
//! A token is 32 bytes from the operating system's random source, never from
//! a command context's, so that the journal's tape could not rebuild it. The
//! store keeps its SHA-256 alone; the token itself is shown once.

use std::sync::Arc;

use afd::{
    ApprovalDecision, ApprovalPolicy, CommandContext, CommandDefinition, CommandError,
    CommandHandler, CommandParameter, CommandResult, failure, success,
};
use async_trait::async_trait;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::commands::{command_line_only, store_failure};
use crate::engine::Engine;
use crate::store::{StoreError, TokenRow};

/// What every agent's token starts with, so that one found in a file or a
/// paste is known for what it is.
pub const AGENT_PREFIX: &str = "lmail_agent_";

/// What the command line's own token starts with.
pub const CLI_PREFIX: &str = "lmail_cli_";

/// The longest name a token may have.
const MOST_NAME: usize = 64;

/// The name of the command that makes a token, whose result the journal
/// never keeps.
pub const CREATE: &str = "mail-token-create";

/// `n` bytes from the operating system's random source, as lower-case hex.
///
/// # Errors
/// When the operating system has no random source to give.
pub fn random_hex(n: usize) -> Result<String, String> {
    let mut bytes = vec![0u8; n];
    getrandom::fill(&mut bytes).map_err(|_| "no random source".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// A token's SHA-256: what the store keeps and the layer compares.
#[must_use]
pub fn hash(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

/// Whether two hashes are equal, in a time that does not depend on where
/// they differ.
#[must_use]
pub fn same(a: &[u8; 32], b: &[u8; 32]) -> bool {
    a.iter()
        .zip(b.iter())
        .fold(0u8, |difference, (x, y)| difference | (x ^ y))
        == 0
}

/// A token's name, checked: the person's own words, for display.
fn name_field(input: &serde_json::Value) -> Result<String, Box<CommandError>> {
    let name = input
        .get("name")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .trim();
    if name.is_empty() || name.chars().count() > MOST_NAME || name.chars().any(char::is_control) {
        return Err(Box::new(
            CommandError::new(
                "INVALID_INPUT",
                format!("`name` is 1 to {MOST_NAME} characters, with no control characters"),
            )
            .with_suggestion("Name the token after the agent that will use it."),
        ));
    }
    Ok(name.to_string())
}

/// Whether `id` has the shape of a token's id: `tok_` and 16 hex digits.
fn plausible_id(id: &str) -> bool {
    id.strip_prefix("tok_")
        .is_some_and(|rest| rest.len() == 16 && rest.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

/// The id `mail-token-revoke` names, checked.
fn id_field(input: &serde_json::Value) -> Result<&str, Box<CommandError>> {
    let id = input
        .get("token")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if plausible_id(id) {
        Ok(id)
    } else {
        Err(Box::new(
            CommandError::new(
                "INVALID_INPUT",
                "`token` is a token's id, such as tok_0123456789abcdef",
            )
            .with_suggestion("Run `loam-mail mail-token-list` to see the tokens' ids."),
        ))
    }
}

/// What the person is asked to approve for a token command, in the engine's
/// words: `None` for the command's own prompt. A token's name is the
/// person's own, typed at the terminal, not text from mail.
#[must_use]
pub fn approval_summary(command: &str, input: &serde_json::Value) -> Option<String> {
    match command {
        CREATE => {
            let name = name_field(input).ok()?;
            Some(format!(
                "Make a token named \"{name}\", for an agent to reach your mail over MCP while `loam-mail serve` runs"
            ))
        }
        "mail-token-revoke" => {
            let id = id_field(input).ok()?;
            Some(format!(
                "Revoke the token {id}: an agent that presents it is refused from then on, and it cannot be brought back"
            ))
        }
        _ => None,
    }
}

/// Reads the tokens again into what a running server checks, after a
/// change.
fn refresh(engine: &Engine, store: &crate::store::Store) -> Result<(), StoreError> {
    engine.set_agent_tokens(store.tokens()?);
    Ok(())
}

struct Create {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Create {
    async fn execute(
        &self,
        input: serde_json::Value,
        context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        let name = match name_field(&input) {
            Ok(name) => name,
            Err(error) => return failure(*error),
        };
        let (id, secret) = match (random_hex(8), random_hex(32)) {
            (Ok(id), Ok(secret)) => (format!("tok_{id}"), format!("{AGENT_PREFIX}{secret}")),
            _ => {
                return failure(CommandError::new(
                    "STORE_FAILED",
                    "the operating system gave no random bytes for the token",
                ));
            }
        };
        let row = TokenRow {
            id: id.clone(),
            name: name.clone(),
            hash: hash(&secret),
            created_at: context.clock().now(),
        };
        let engine = &self.engine;
        let made = engine.with_store(|store| {
            if store.tokens()?.iter().any(|token| token.name == name) {
                return Ok(false);
            }
            store.add_token(&row)?;
            refresh(engine, store)?;
            Ok(true)
        });
        match made {
            Ok(true) => success(json!({
                "token": id,
                "name": name,
                // Shown this once: the store keeps its hash alone.
                "secret": secret,
            })),
            Ok(false) => failure(
                CommandError::new("INVALID_INPUT", "a token already has that name")
                    .with_suggestion("Choose another name, or revoke the other token first."),
            ),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-token-create`: makes a token for an agent and shows it once. A
/// person's command.
#[must_use]
pub fn create(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        CREATE,
        "Make a token an agent presents to reach the mail over MCP",
        vec![CommandParameter::required_string(
            "name",
            "A name for the token, such as the agent that will use it",
        )],
        Create { engine },
    )
    .as_mutation()
    .with_confirm_prompt("Make a token for an agent to reach your mail over MCP")
    .with_approval(ApprovalPolicy::when(|input, _context| {
        if name_field(input).is_ok() {
            ApprovalDecision::Required
        } else {
            ApprovalDecision::NotRequired
        }
    }))
    .with_expose(command_line_only())
}

struct List {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for List {
    async fn execute(
        &self,
        _input: serde_json::Value,
        _context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        match self.engine.with_store(|store| store.tokens()) {
            Ok(tokens) => success(json!({
                "tokens": tokens.iter().map(|token| json!({
                    "token": token.id,
                    "name": token.name,
                    "createdAt": token.created_at,
                })).collect::<Vec<_>>(),
            })),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-token-list`: the agents' tokens, by id and name; never the tokens
/// themselves, which the store does not have. A read, so it asks nothing.
#[must_use]
pub fn list(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-token-list",
        "List the tokens agents may present",
        vec![],
        List { engine },
    )
    .with_expose(command_line_only())
}

struct Revoke {
    engine: Arc<Engine>,
}

#[async_trait]
impl CommandHandler for Revoke {
    async fn execute(
        &self,
        input: serde_json::Value,
        _context: CommandContext,
    ) -> CommandResult<serde_json::Value> {
        let id = match id_field(&input) {
            Ok(id) => id,
            Err(error) => return failure(*error),
        };
        let engine = &self.engine;
        let removed = engine.with_store(|store| {
            let removed = store.remove_token(id)?;
            refresh(engine, store)?;
            Ok(removed)
        });
        match removed {
            Ok(token) => success(json!({
                "token": token.id,
                "name": token.name,
                "revoked": true,
            })),
            Err(StoreError::NotFound(_)) => failure(
                CommandError::new("TOKEN_NOT_FOUND", "no token has that id")
                    .with_suggestion("Run `loam-mail mail-token-list` to see the tokens' ids."),
            ),
            Err(error) => failure(store_failure(&error)),
        }
    }
}

/// `mail-token-revoke`: forgets an agent's token, so that a running server
/// refuses it from the next request on. A person's command, and destructive:
/// a revoked token cannot be brought back.
#[must_use]
pub fn revoke(engine: Arc<Engine>) -> CommandDefinition {
    CommandDefinition::new(
        "mail-token-revoke",
        "Revoke an agent's token",
        vec![CommandParameter::required_string(
            "token",
            "The token's id, as mail-token-list shows it",
        )],
        Revoke { engine },
    )
    .as_mutation()
    .with_destructive(true)
    .with_confirm_prompt("Revoke the token; an agent that presents it is refused from then on")
    .with_approval(ApprovalPolicy::Required)
    .with_expose(command_line_only())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_compare_equal_only_when_every_byte_does() {
        let a = hash("one");
        let mut b = a;
        assert!(same(&a, &b));
        b[31] ^= 1;
        assert!(!same(&a, &b));
        b = a;
        b[0] ^= 0x80;
        assert!(!same(&a, &b));
    }

    #[test]
    fn a_name_is_the_persons_words_without_control_characters() {
        assert_eq!(
            name_field(&json!({ "name": "  claude  " })).unwrap(),
            "claude"
        );
        for bad in [
            json!({}),
            json!({ "name": "" }),
            json!({ "name": "a\u{1b}[2J" }),
        ] {
            assert!(name_field(&bad).is_err(), "{bad}");
        }
        let long = "x".repeat(MOST_NAME + 1);
        assert!(name_field(&json!({ "name": long })).is_err());
    }

    #[test]
    fn only_an_id_of_the_engines_shape_is_named_in_a_summary() {
        assert!(
            approval_summary(
                "mail-token-revoke",
                &json!({ "token": "tok_0123456789abcdef" })
            )
            .is_some()
        );
        for bad in [
            "tok_0123",
            "0123456789abcdef",
            "tok_0123456789abcdeg",
            "tok_\u{1b}23456789abcdef",
        ] {
            assert!(
                approval_summary("mail-token-revoke", &json!({ "token": bad })).is_none(),
                "{bad}"
            );
        }
    }

    #[test]
    fn a_secret_is_long_and_random() {
        let a = random_hex(32).unwrap();
        let b = random_hex(32).unwrap();
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
    }
}
