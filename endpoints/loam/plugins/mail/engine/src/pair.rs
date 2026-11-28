//! No-terminal pairing (`loam-mail pair`), unpairing (`loam-mail unpair`), and
//! pre-bearer `/health` proof helpers (phase 5 no-terminal amendment, sections
//! 5.1 and 5.2).

use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

use afd::{CommandError, CommandResult, JournalRecord, create_context_digest, failure, success};
use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::Sha256;

use crate::PROGRAM;
use crate::cli::{EXIT_FAILED, EXIT_OK, EXIT_USAGE};
use crate::commands::store_failure;
use crate::engine::Engine;
use crate::home::Home;
use crate::store::{StoreError, TokenRole, TokenRow};
use crate::tokens;

/// Private `/cli` forwarding command name for `loam-mail pair`.
/// Not registered in `CommandRegistry` and never reachable over `/mcp`.
pub const CLI_PAIR_COMMAND: &str = "_pair";

/// Private `/cli` forwarding command name for `loam-mail unpair`.
/// Not registered in `CommandRegistry` and never reachable over `/mcp`.
pub const CLI_UNPAIR_COMMAND: &str = "_unpair";

/// Parsed arguments for `loam-mail pair`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairArgs {
    /// Requested token role (`approver` or `agent`).
    pub role: TokenRole,
    /// Display name for the token.
    pub name: String,
}

/// Parsed arguments for `loam-mail unpair`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnpairArgs {
    /// Token identifier to revoke.
    pub token_id: String,
}

/// JSON object printed to stdout by `loam-mail pair` (amendment 5.1 row 3a).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairOutput {
    /// Newly created bearer token (shown once; only its SHA-256 is stored).
    pub token: String,
    /// Stable token id matching `^[A-Za-z0-9_-]{1,31}$`.
    pub token_id: String,
    /// Role of the created token (`"approver"` or `"agent"`).
    pub role: String,
    /// Persistent 64-lowercase-hex non-bearer instance identity key.
    pub proof_key: String,
}

/// JSON object printed to stdout by `loam-mail unpair` (amendment 5.1 row 3b).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnpairOutput {
    /// Token id targeted for revocation.
    pub token_id: String,
    /// Whether an active token with that id was removed (`false` if already
    /// revoked or absent).
    pub revoked: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PairForwardInput {
    role: String,
    name: String,
    accept_consent: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UnpairForwardInput {
    token_id: String,
}

/// Returns whether `value` is strictly 64 lowercase hexadecimal ASCII characters.
#[must_use]
pub fn is_hex64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Returns whether `id` matches `^[A-Za-z0-9_-]{1,31}$` (amendment 5.1 row 3a).
#[must_use]
pub fn is_valid_token_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 31
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

/// Parses a `/health` query string strictly matching `nonce=<64-lowercase-hex>`
/// with no extra parameters, uppercase hex, or malformed values.
#[must_use]
pub fn parse_health_nonce(query: Option<&str>) -> Option<&str> {
    let nonce = query?.strip_prefix("nonce=")?;
    if is_hex64(nonce) { Some(nonce) } else { None }
}

/// Decodes a 64-character lowercase hex string into 32 bytes.
pub(crate) fn decode_hex32(hex: &str) -> Option<[u8; 32]> {
    if !is_hex64(hex) {
        return None;
    }
    let mut out = Vec::with_capacity(32);
    for pair in hex.as_bytes().as_chunks::<2>().0 {
        let hi = hex_nibble(pair[0])?;
        let lo = hex_nibble(pair[1])?;
        out.push((hi << 4) | lo);
    }
    out.try_into().ok()
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        _ => None,
    }
}

/// Computes the 64-character lowercase hex `HMAC-SHA256(proof_key, nonce)` proof
/// matching `mounts_proof.rs` (amendment 5.2): `proof_key` is the 32-byte key
/// and `nonce` is hashed as its 64-byte ASCII lowercase hex string.
#[must_use]
pub fn compute_health_proof(proof_key: &[u8; 32], nonce: &str) -> Option<String> {
    if !is_hex64(nonce) {
        return None;
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(proof_key).ok()?;
    mac.update(nonce.as_bytes());
    Some(tokens::encode_hex(&mac.finalize().into_bytes()))
}

/// Verifies an `X-Loam-Proof` header value in constant time against
/// `HMAC-SHA256(proof_key, nonce)`.
#[must_use]
pub(crate) fn verify_health_proof(proof_key: &[u8; 32], nonce: &str, header: &str) -> bool {
    if !is_hex64(nonce) {
        return false;
    }
    let Some(received) = decode_hex32(header) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(proof_key) else {
        return false;
    };
    mac.update(nonce.as_bytes());
    let expected: [u8; 32] = mac.finalize().into_bytes().into();
    tokens::same(&expected, &received)
}

/// Parses `loam-mail pair --role <approver|agent> --name <name> --accept-consent`.
///
/// # Errors
/// Returns a user-facing error message with a suggestion when required flags are
/// missing, repeated, malformed, or unrecognized.
pub fn parse_pair_args(args: &[String]) -> Result<PairArgs, String> {
    let mut role: Option<TokenRole> = None;
    let mut name: Option<String> = None;
    let mut accept_consent = false;
    let mut index = 0;

    while index < args.len() {
        let arg = args[index].as_str();
        if arg == "--accept-consent" {
            if accept_consent {
                return Err("`--accept-consent` may be given only once.".to_string());
            }
            accept_consent = true;
            index += 1;
            continue;
        }
        if arg == "--role" || arg.starts_with("--role=") {
            if role.is_some() {
                return Err("`--role` may be given only once.".to_string());
            }
            let raw = match arg.strip_prefix("--role=") {
                Some(value) => {
                    index += 1;
                    value
                }
                None => {
                    let Some(value) = args.get(index + 1) else {
                        return Err(
                            "`--role` requires a value: \"approver\" or \"agent\".".to_string()
                        );
                    };
                    index += 2;
                    value.as_str()
                }
            };
            let parsed = TokenRole::parse(raw).ok_or_else(|| {
                "`--role` must be \"approver\" or \"agent\"; pass `--role approver` or `--role agent`."
                    .to_string()
            })?;
            role = Some(parsed);
            continue;
        }
        if arg == "--name" || arg.starts_with("--name=") {
            if name.is_some() {
                return Err("`--name` may be given only once.".to_string());
            }
            let raw = match arg.strip_prefix("--name=") {
                Some(value) => {
                    index += 1;
                    value
                }
                None => {
                    let Some(value) = args.get(index + 1) else {
                        return Err("`--name` requires a token name.".to_string());
                    };
                    index += 2;
                    value.as_str()
                }
            };
            let validated = tokens::validate_name(raw).map_err(|err| {
                format!("{}; {}", err.message, err.suggestion.unwrap_or_default())
            })?;
            name = Some(validated);
            continue;
        }
        let shown: String = arg.chars().filter(|c| !c.is_control()).take(64).collect();
        return Err(format!(
            "unexpected argument `{shown}` for `pair`; expected `--role <approver|agent> --name <name> --accept-consent`."
        ));
    }

    if !accept_consent {
        return Err(
            "`pair` requires `--accept-consent` to record host-collected consent. Pass `--accept-consent` after the person confirms pairing, or run `loam-mail mail-token-create` at a terminal."
                .to_string(),
        );
    }
    let Some(role) = role else {
        return Err(
            "`pair` requires `--role <approver|agent>`; pass `--role approver` or `--role agent`."
                .to_string(),
        );
    };
    let Some(name) = name else {
        return Err(
            "`pair` requires `--name <name>`; pass a display name such as `--name \"Loam Desktop\"`."
                .to_string(),
        );
    };
    Ok(PairArgs { role, name })
}

/// Parses `loam-mail unpair --token-id <tokenId>`.
///
/// # Errors
/// Returns a user-facing error message with a suggestion when `--token-id` is
/// missing, repeated, malformed, or unrecognized arguments are supplied.
pub fn parse_unpair_args(args: &[String]) -> Result<UnpairArgs, String> {
    let mut token_id: Option<String> = None;
    let mut index = 0;

    while index < args.len() {
        let arg = args[index].as_str();
        if arg == "--token-id" || arg.starts_with("--token-id=") {
            if token_id.is_some() {
                return Err("`--token-id` may be given only once.".to_string());
            }
            let raw = match arg.strip_prefix("--token-id=") {
                Some(value) => {
                    index += 1;
                    value
                }
                None => {
                    let Some(value) = args.get(index + 1) else {
                        return Err("`--token-id` requires a token id.".to_string());
                    };
                    index += 2;
                    value.as_str()
                }
            };
            if !is_valid_token_id(raw) {
                return Err(
                    "`--token-id` must be 1 to 31 characters in `[A-Za-z0-9_-]`; run `loam-mail mail-token-list` to see token ids."
                        .to_string(),
                );
            }
            token_id = Some(raw.to_string());
            continue;
        }
        let shown: String = arg.chars().filter(|c| !c.is_control()).take(64).collect();
        return Err(format!(
            "unexpected argument `{shown}` for `unpair`; expected `--token-id <tokenId>`."
        ));
    }

    let Some(token_id) = token_id else {
        return Err(
            "`unpair` requires `--token-id <tokenId>`; run `loam-mail mail-token-list` to see token ids."
                .to_string(),
        );
    };
    Ok(UnpairArgs { token_id })
}

fn now_ms() -> i64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis());
    i64::try_from(millis).unwrap_or(i64::MAX)
}

/// Creates a paired bearer token for `role` and `name`, ensures the persistent
/// `proofKey` exists, stores only the token hash, refreshes active server
/// tokens, and appends a redacted journal entry (`source: "pair"`).
///
/// # Errors
/// Returns a [`CommandError`] on invalid input, duplicate token name, RNG
/// failure, or store failure.
pub async fn execute_pair(
    engine: &Engine,
    role: TokenRole,
    name: &str,
) -> Result<PairOutput, Box<CommandError>> {
    let name = tokens::validate_name(name)?;
    let prefix = match role {
        TokenRole::Agent => tokens::AGENT_PREFIX,
        TokenRole::Approver => tokens::APPROVER_PREFIX,
    };
    let (id, secret) = match (tokens::random_hex(8), tokens::random_hex(32)) {
        (Ok(id), Ok(secret)) => (format!("tok_{id}"), format!("{prefix}{secret}")),
        _ => {
            return Err(Box::new(
                CommandError::new(
                    "STORE_FAILED",
                    "the operating system gave no random bytes for the token",
                )
                .with_suggestion("Check the operating system random source and try again."),
            ));
        }
    };
    let created_at = now_ms();
    let row = TokenRow {
        id: id.clone(),
        name: name.clone(),
        hash: tokens::hash(&secret),
        created_at,
        role,
    };
    // Read existing tokens and proofKey BEFORE committing `add_token` so a
    // failure can never leave a committed token behind or skip refreshing the
    // live authorization cache.
    let created = engine.with_store(|store| {
        let mut active = store.tokens()?;
        if active.iter().any(|token| token.name == name) {
            return Ok(None);
        }
        let proof_key = store.proof_key()?;
        store.add_token(&row)?;
        active.push(row.clone());
        engine.set_agent_tokens(active);
        engine.set_proof_key(proof_key);
        Ok(Some(proof_key))
    });
    let proof_key = match created {
        Ok(Some(proof_key)) => proof_key,
        Ok(None) => {
            return Err(Box::new(
                CommandError::new("INVALID_INPUT", "a token already has that name")
                    .with_suggestion("Choose another name, or revoke the other token first."),
            ));
        }
        Err(error) => return Err(Box::new(store_failure(&error))),
    };

    // Never place the bearer token or proofKey in the journal record; it is
    // `mail-token-create`'s, which declares `secret`, so `journal::redact`
    // also strips `result.data` and `tape`.
    let context = crate::cli::command_line_context(false);
    let record = JournalRecord {
        timestamp: crate::journal::utc_timestamp_ms(created_at),
        trace_id: None,
        idempotency_key: None,
        command: tokens::CREATE.to_string(),
        input: json!({
            "name": name,
            "role": role.as_str(),
            "source": "pair",
        }),
        actor: context.actor.clone(),
        context_digest: create_context_digest(&context),
        context: None,
        context_omitted: None,
        output_budget: None,
        result: success(json!({
            "token": id,
            "name": name,
            "role": role.as_str(),
            "source": "pair",
        })),
        duration_ms: 0.0,
        tape: None,
    };
    // `true` as `tokens::create` declares `as_secret()`; a unit in `tokens`
    // holds the declaration.
    engine.append_journal(record, true).await;

    Ok(PairOutput {
        token: secret,
        token_id: id,
        role: role.as_str().to_string(),
        proof_key: tokens::encode_hex(&proof_key),
    })
}

/// Revokes `token_id` idempotently while leaving the persistent `proofKey` and
/// all other tokens intact, refreshes active server tokens, and journals the
/// revocation (`source: "unpair"`).
///
/// # Errors
/// Returns a [`CommandError`] on invalid `token_id` or store failure.
pub async fn execute_unpair(
    engine: &Engine,
    token_id: &str,
) -> Result<UnpairOutput, Box<CommandError>> {
    if !is_valid_token_id(token_id) {
        return Err(Box::new(
            CommandError::new(
                "INVALID_INPUT",
                "`tokenId` must be 1 to 31 characters in `[A-Za-z0-9_-]`",
            )
            .with_suggestion("Run `loam-mail mail-token-list` to see the tokens' ids."),
        ));
    }
    // Delete by primary key and unconditionally evict `token_id` from the
    // in-memory cache under the store lock on both deleted and already-absent
    // paths so a retry can never leave a stale bearer active.
    let removed = engine.with_store(|store| {
        let deleted = store.delete_token_by_id(token_id)?;
        engine.remove_agent_token(token_id);
        Ok(deleted)
    });
    let revoked = removed.map_err(|error| Box::new(store_failure(&error)))?;

    let context = crate::cli::command_line_context(false);
    let record = JournalRecord {
        timestamp: crate::journal::utc_timestamp_ms(now_ms()),
        trace_id: None,
        idempotency_key: None,
        command: "mail-token-revoke".to_string(),
        input: json!({
            "token": token_id,
            "source": "unpair",
        }),
        actor: context.actor.clone(),
        context_digest: create_context_digest(&context),
        context: None,
        context_omitted: None,
        output_budget: None,
        result: success(json!({
            "token": token_id,
            "revoked": revoked,
            "source": "unpair",
        })),
        duration_ms: 0.0,
        tape: None,
    };
    engine.append_journal(record, false).await;

    Ok(UnpairOutput {
        token_id: token_id.to_string(),
        revoked,
    })
}

/// Handles private `/cli` forwarded `_pair` and `_unpair` calls on a running
/// server. Returns `None` for any normal registry command.
pub(crate) async fn handle_forwarded(
    engine: &Engine,
    command: &str,
    input: Value,
) -> Option<CommandResult<Value>> {
    match command {
        CLI_PAIR_COMMAND => {
            let Ok(parsed) = serde_json::from_value::<PairForwardInput>(input) else {
                return Some(failure(
                    CommandError::new(
                        "INVALID_INPUT",
                        "pair requires role, name, and acceptConsent",
                    )
                    .with_suggestion(
                        "Run `loam-mail pair --role <approver|agent> --name <name> --accept-consent`.",
                    ),
                ));
            };
            if !parsed.accept_consent {
                return Some(failure(
                    CommandError::new("CONSENT_REQUIRED", "`acceptConsent` must be true")
                        .with_suggestion("Pass `--accept-consent` after confirming pairing."),
                ));
            }
            let Some(role) = TokenRole::parse(&parsed.role) else {
                return Some(failure(
                    CommandError::new("INVALID_INPUT", "`role` must be \"agent\" or \"approver\"")
                        .with_suggestion("Use \"approver\" or \"agent\"."),
                ));
            };
            match execute_pair(engine, role, &parsed.name).await {
                Ok(output) => match serde_json::to_value(&output) {
                    Ok(value) => Some(success(value)),
                    Err(_) => Some(failure(
                        CommandError::new("INTERNAL_ERROR", "pair output could not be serialized")
                            .with_suggestion("Retry pairing."),
                    )),
                },
                Err(error) => Some(failure(*error)),
            }
        }
        CLI_UNPAIR_COMMAND => {
            let Ok(parsed) = serde_json::from_value::<UnpairForwardInput>(input) else {
                return Some(failure(
                    CommandError::new("INVALID_INPUT", "unpair requires tokenId")
                        .with_suggestion("Run `loam-mail unpair --token-id <tokenId>`."),
                ));
            };
            match execute_unpair(engine, &parsed.token_id).await {
                Ok(output) => match serde_json::to_value(&output) {
                    Ok(value) => Some(success(value)),
                    Err(_) => Some(failure(
                        CommandError::new(
                            "INTERNAL_ERROR",
                            "unpair output could not be serialized",
                        )
                        .with_suggestion("Retry unpairing."),
                    )),
                },
                Err(error) => Some(failure(*error)),
            }
        }
        _ => None,
    }
}

fn write_error(err: &mut dyn Write, error: &CommandError) -> std::io::Result<()> {
    match error.suggestion.as_deref() {
        Some(suggestion) => writeln!(
            err,
            "{PROGRAM}: {} ({}): {suggestion}",
            error.message, error.code
        ),
        None => writeln!(err, "{PROGRAM}: {} ({})", error.message, error.code),
    }
}

fn forward_or_fail(
    engine: &Engine,
    home: Option<&Home>,
    command: &str,
    input: Value,
    err: &mut dyn Write,
) -> std::io::Result<Result<(Value, String), u8>> {
    let Some(server) = home.and_then(crate::forward::Server::find) else {
        let error = store_failure(&StoreError::InUse);
        write_error(err, &error)?;
        return Ok(Err(EXIT_FAILED));
    };
    if server.transport() != engine.transport_tag() {
        writeln!(
            err,
            "{PROGRAM}: a running server owns the store with a different transport configuration (`{}` vs `{}`); stop the server or match its environment before running commands.",
            server.transport(),
            engine.transport_tag()
        )?;
        return Ok(Err(EXIT_FAILED));
    }
    let Some(expected_proof_key) = server.proof_key_hex() else {
        writeln!(
            err,
            "{PROGRAM}: the running server's `server.json` has no instance proof key; restart `loam-mail serve` before pairing."
        )?;
        return Ok(Err(EXIT_FAILED));
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let forwarded = crate::serve::Forwarded {
        command: command.to_string(),
        input,
        terminal: false,
        approval: None,
    };
    let result = runtime.block_on(server.call_verified(&forwarded));
    if result.success {
        let Some(data) = result.data else {
            writeln!(
                err,
                "{PROGRAM}: the running server returned no payload for `{command}`."
            )?;
            return Ok(Err(EXIT_FAILED));
        };
        Ok(Ok((data, expected_proof_key)))
    } else {
        if let Some(error) = result.error.as_ref() {
            write_error(err, error)?;
        } else {
            writeln!(err, "{PROGRAM}: `{command}` failed on the running server.")?;
        }
        Ok(Err(EXIT_FAILED))
    }
}

/// Runs `loam-mail pair` locally when the store is free, or forwards over `/cli`
/// when `loam-mail serve` owns the store. Prints strictly one JSON object to
/// `out` on success; writes diagnostics only to `err`.
///
/// # Errors
/// Returns an error only when writing to `out` or `err` fails.
pub fn run_pair_cli(
    args: &[String],
    engine: &Engine,
    home: Option<&Home>,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> std::io::Result<u8> {
    let parsed = match parse_pair_args(args) {
        Ok(parsed) => parsed,
        Err(problem) => {
            writeln!(err, "{PROGRAM}: {problem}")?;
            return Ok(EXIT_USAGE);
        }
    };
    let output = match engine.open_store() {
        Ok(()) => {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?;
            match runtime.block_on(execute_pair(engine, parsed.role, &parsed.name)) {
                Ok(output) => output,
                Err(error) => {
                    write_error(err, &error)?;
                    return Ok(EXIT_FAILED);
                }
            }
        }
        Err(StoreError::InUse) => {
            let (payload, expected_proof_key) = match forward_or_fail(
                engine,
                home,
                CLI_PAIR_COMMAND,
                json!({
                    "role": parsed.role.as_str(),
                    "name": parsed.name,
                    "acceptConsent": true,
                }),
                err,
            )? {
                Ok(value) => value,
                Err(status) => return Ok(status),
            };
            match serde_json::from_value::<PairOutput>(payload) {
                Ok(output) if output.proof_key == expected_proof_key => output,
                _ => {
                    writeln!(
                        err,
                        "{PROGRAM}: the running server returned an invalid or mismatched pairing response."
                    )?;
                    return Ok(EXIT_FAILED);
                }
            }
        }
        Err(error) => {
            write_error(err, &store_failure(&error))?;
            return Ok(EXIT_FAILED);
        }
    };
    let line = serde_json::to_string(&output).map_err(std::io::Error::other)?;
    writeln!(out, "{line}")?;
    Ok(EXIT_OK)
}

/// Runs `loam-mail unpair` locally when the store is free, or forwards over
/// `/cli` when `loam-mail serve` owns the store. Idempotent: exits `0` even if
/// the token is already revoked or absent.
///
/// # Errors
/// Returns an error only when writing to `out` or `err` fails.
pub fn run_unpair_cli(
    args: &[String],
    engine: &Engine,
    home: Option<&Home>,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> std::io::Result<u8> {
    let parsed = match parse_unpair_args(args) {
        Ok(parsed) => parsed,
        Err(problem) => {
            writeln!(err, "{PROGRAM}: {problem}")?;
            return Ok(EXIT_USAGE);
        }
    };
    let output = match engine.open_store() {
        Ok(()) => {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()?;
            match runtime.block_on(execute_unpair(engine, &parsed.token_id)) {
                Ok(output) => output,
                Err(error) => {
                    write_error(err, &error)?;
                    return Ok(EXIT_FAILED);
                }
            }
        }
        Err(StoreError::InUse) => {
            let (payload, _expected_proof_key) = match forward_or_fail(
                engine,
                home,
                CLI_UNPAIR_COMMAND,
                json!({ "tokenId": parsed.token_id }),
                err,
            )? {
                Ok(value) => value,
                Err(status) => return Ok(status),
            };
            match serde_json::from_value::<UnpairOutput>(payload) {
                Ok(output) => output,
                Err(_) => {
                    writeln!(
                        err,
                        "{PROGRAM}: the running server returned an invalid unpairing response."
                    )?;
                    return Ok(EXIT_FAILED);
                }
            }
        }
        Err(error) => {
            write_error(err, &store_failure(&error))?;
            return Ok(EXIT_FAILED);
        }
    };
    let line = serde_json::to_string(&output).map_err(std::io::Error::other)?;
    writeln!(out, "{line}")?;
    Ok(EXIT_OK)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_proof_matches_mounts_proof_rfc2104_vector() {
        let key_vec: Vec<u8> = (0u8..32).collect();
        let key: [u8; 32] = key_vec.try_into().ok().unwrap_or_else(|| unreachable!());
        let nonce_vec: Vec<u8> = (32u8..64).collect();
        let nonce = tokens::encode_hex(&nonce_vec);
        // Same independent vector as `endpoints/loam/packages/desktop/src-tauri/src/mounts_proof_tests.rs`.
        let expected = "f11850ce2b92900b74888d4b8512576ee53d386643a045a8a46d9e0a3e760bfd";
        assert_eq!(
            compute_health_proof(&key, &nonce).as_deref(),
            Some(expected)
        );
        assert!(compute_health_proof(&key, &nonce.to_ascii_uppercase()).is_none());
        assert!(compute_health_proof(&key, &nonce[..63]).is_none());
    }

    #[test]
    fn health_nonce_parser_enforces_exact_query_shape() {
        let nonce_vec: Vec<u8> = (32u8..64).collect();
        let nonce = tokens::encode_hex(&nonce_vec);
        let valid = format!("nonce={nonce}");
        assert_eq!(parse_health_nonce(Some(&valid)), Some(nonce.as_str()));
        let upper = format!("nonce={}", nonce.to_ascii_uppercase());
        let extra = format!("nonce={nonce}&foo=1");
        let prefix = format!("foo=1&nonce={nonce}");
        let short = format!("nonce={}", &nonce[..63]);
        for bad in [
            None,
            Some(""),
            Some("nonce="),
            Some(upper.as_str()),
            Some(extra.as_str()),
            Some(prefix.as_str()),
            Some(short.as_str()),
        ] {
            assert_eq!(parse_health_nonce(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn pair_and_unpair_arg_parsers_fail_closed() {
        let args = |items: &[&str]| items.iter().map(ToString::to_string).collect::<Vec<_>>();
        let ok = parse_pair_args(&args(&[
            "--role",
            "approver",
            "--name",
            "Loam Desktop (abc123)",
            "--accept-consent",
        ]));
        assert_eq!(
            ok,
            Ok(PairArgs {
                role: TokenRole::Approver,
                name: "Loam Desktop (abc123)".to_string(),
            })
        );
        // Missing --accept-consent refuses clearly.
        let no_consent = parse_pair_args(&args(&["--role", "approver", "--name", "Loam"]));
        assert!(no_consent.is_err());
        assert!(
            no_consent
                .err()
                .is_some_and(|msg| msg.contains("--accept-consent"))
        );
        // Unknown role, missing name, duplicate flags, extra args all refused.
        for bad in [
            &["--role", "admin", "--name", "Loam", "--accept-consent"][..],
            &["--role", "agent", "--accept-consent"][..],
            &["--name", "Loam", "--accept-consent"][..],
            &[
                "--role",
                "agent",
                "--name",
                "Loam",
                "--accept-consent",
                "--extra",
            ][..],
            &[
                "--role",
                "agent",
                "--role",
                "approver",
                "--name",
                "Loam",
                "--accept-consent",
            ][..],
        ] {
            assert!(parse_pair_args(&args(bad)).is_err(), "{bad:?}");
        }

        assert_eq!(
            parse_unpair_args(&args(&["--token-id", "tok_0123456789abcdef"])),
            Ok(UnpairArgs {
                token_id: "tok_0123456789abcdef".to_string()
            })
        );
        for bad in [
            &[][..],
            &["--token-id"][..],
            &["--token-id", ""][..],
            &["--token-id", "bad space"][..],
            &["--token-id", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"][..],
            &["--token-id", "tok_1", "--extra"][..],
        ] {
            assert!(parse_unpair_args(&args(bad)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn utc_timestamp_formats_known_epochs() {
        assert_eq!(
            crate::journal::utc_timestamp_ms(0),
            "1970-01-01T00:00:00.000Z"
        );
        assert_eq!(
            crate::journal::utc_timestamp_ms(1_735_689_600_123),
            "2025-01-01T00:00:00.123Z"
        );
    }
}
