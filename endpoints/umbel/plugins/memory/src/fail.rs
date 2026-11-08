//! Failures as AFD results (phase 3 specification, section 8.12). No message, suggestion or detail
//! ever holds a record's text (D67).

use serde_json::json;
use umbel_sdk::{HostError, Outcome, failure};

/// `MEMORY_INVALID` for a bad field, `at` or label. `what` names the rule, never the value.
pub(crate) fn invalid(what: &str) -> Outcome {
    failure(
        "MEMORY_INVALID",
        &format!("the input was refused: {what}"),
        "Fix the field the message names and run the command again; memory-guide lists every field's limits.",
    )
}

/// `MEMORY_TTL_TOO_LONG`, naming the class's maximum.
pub(crate) fn ttl_too_long(class: &str, max_days: u32) -> Outcome {
    failure(
        "MEMORY_TTL_TOO_LONG",
        &format!("a {class} record lives at most {max_days} days"),
        &format!(
            "Pass ttlDays of at most {max_days}, or leave it out for the class's default. What should last longer goes through a knowledge proposal."
        ),
    )
}

/// `MEMORY_PACK_INVALID`: a pack override that does not load. Nothing is written.
pub(crate) fn pack_invalid(pack: &str, reason: &str) -> Outcome {
    failure(
        "MEMORY_PACK_INVALID",
        &format!("the {pack} pack does not load: {reason}"),
        &format!(
            "Fix the space's override of the memory plugin's {pack} pack (spaces/<space>/packs/memory/{pack}/), or remove it to use the default. Nothing was written."
        ),
    )
}

/// `CAPTURE_TOO_LARGE`: the whole call is refused, and the adapter splits it.
pub(crate) fn capture_too_large(what: &str) -> Outcome {
    failure(
        "CAPTURE_TOO_LARGE",
        &format!("the capture was refused whole: {what}"),
        "Split the window into calls of at most 1 MiB and 256 entries, with at most 64 KiB in each entry.",
    )
    .with_retryable(false)
}

/// `MEMORY_NOT_FOUND`: absent, purged, forgotten or unreadable, alike.
pub(crate) fn not_found() -> Outcome {
    failure(
        "MEMORY_NOT_FOUND",
        "no record with that id that you can read",
        "Check the id with memory-list or memory-recall; a record you may not read, one that was forgotten and one that never existed are reported the same way.",
    )
}

/// The failure for a call that resolved no space.
pub(crate) fn no_space() -> Outcome {
    failure(
        "SPACE_NOT_FOUND",
        "the call resolved no space",
        "Pass `space`, or set default_space in umbel.toml.",
    )
}

/// The error code a host message leads with (`MEMORY_SHARE_NOT_ALLOWED: ...`), if any.
fn leading_code(text: &str) -> Option<&str> {
    let (code, _) = text.split_once(": ")?;
    let valid = !code.is_empty()
        && code
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_');
    valid.then_some(code)
}

/// The suggestion for a code the host names.
fn suggestion(code: &str) -> &'static str {
    match code {
        "MEMORY_SHARE_NOT_ALLOWED" => {
            "Leave out share, or pass share = \"private\"; widening who reads a record needs a person, or a writer the deployer lists under the memory_write grant's writers."
        }
        "MEMORY_AUTHORITY_TOO_LOW" => {
            "A record a person vouched for changes only by a person at a terminal; leave it, or ask the person to run the command."
        }
        "MEMORY_NOT_OWNED" => {
            "Only the record's owner, or a sharing writer who can read it, may replace it; remember a new record instead."
        }
        "MEMORY_SCOPE_MISMATCH" => {
            "A record may only supersede records in the same project and with the same access set; pass the same project and share, or remember it without supersedes."
        }
        "MEMORY_PRINCIPAL_REQUIRED" => {
            "Call as an actor with an id, or acting for a person, so the record has an owner."
        }
        "MEMORY_TTL_TOO_LONG" => "Pass a shorter ttlDays, or leave it out.",
        "MEMORY_CONFIRM_NOT_ALLOWED" => {
            "Only a person at a terminal confirms, with umbel call memory-confirm and no --yes, no --approve and no agent environment variable; and only their own records."
        }
        "MEMORY_FORGET_HUMAN_REQUIRED" => {
            "Forget by ids, which memory-list returns; a forget by session, project or time needs a person at a terminal, without --yes."
        }
        "SPACE_NOT_READABLE" => "Ask the workspace owner to add you to the space's readers.",
        "STORE_WRITE_NOT_ALLOWED" => {
            "Allow the memory plugin's memory_write grant for this space in umbel.toml."
        }
        _ => "Check the input against memory-guide and run the command again.",
    }
}

/// The failure for a host service refusing, by the code its message leads with, else by kind.
pub(crate) fn host(error: &HostError) -> Outcome {
    let message = error.to_string();
    match error {
        HostError::NotGranted(text) | HostError::Invalid(text) | HostError::NotFound(text)
            if leading_code(text).is_some() =>
        {
            let code = leading_code(text).unwrap_or_default();
            if code == "MEMORY_NOT_FOUND" {
                return not_found();
            }
            let rest = text
                .split_once(": ")
                .map_or(text.as_str(), |(_, rest)| rest);
            failure(code, rest, suggestion(code))
        }
        HostError::NotGranted(_) => failure(
            "PLUGIN_GRANT_DENIED",
            &message,
            "Enable the memory plugin with its memory and memory_write grants, and allow memory_write for this space in umbel.toml.",
        ),
        HostError::NotFound(_) => not_found(),
        HostError::Invalid(_) => failure(
            "MEMORY_INVALID",
            &message,
            "Check the input against memory-guide and run the command again.",
        ),
        HostError::TooLarge(_) => failure(
            "MEMORY_INVALID",
            &message,
            "Shorten the text: remember takes at most 16 KiB, capture at most 64 KiB per entry.",
        ),
        HostError::QuotaExceeded {
            limit,
            retry_after_ms,
        } => {
            let outcome = failure(
                "MEMORY_QUOTA_EXCEEDED",
                &format!("the memory quota's {} is reached; nothing was written", limit.as_str()),
                match retry_after_ms {
                    Some(_) => "Wait retryAfterMs and run it again; memory-status shows the usage.",
                    None => "Forget records you no longer need, or ask the deployer to raise the policy pack's quota; memory-status shows the usage.",
                },
            )
            .with_retryable(retry_after_ms.is_some());
            match retry_after_ms {
                Some(ms) => outcome.with_error_details(json!({
                    "limit": limit.as_str(),
                    "retryAfterMs": ms,
                })),
                None => outcome.with_error_details(json!({ "limit": limit.as_str() })),
            }
        }
        HostError::Conflict { .. } => failure(
            "MEMORY_CONFLICT",
            "the record changed since it was read",
            "Read it again and run the command again.",
        ),
        HostError::Busy(_) => failure(
            "STORE_BUSY",
            &message,
            "Another process holds the memory store; run the command again shortly.",
        )
        .with_retryable(true),
        HostError::KeysMissing => failure(
            "MEMORY_KEYS_MISSING",
            &message,
            "Restore memory.keys beside memory.sqlite3 from your separate copy; without it no record opens. Run umbel doctor.",
        ),
        HostError::KeysMismatch => failure(
            "MEMORY_KEYS_MISMATCH",
            &message,
            "Put back the memory.keys that belongs to this memory.sqlite3; run umbel doctor and store-check.",
        ),
        HostError::KeyAbsent { .. } => failure(
            "MEMORY_KEY_ABSENT",
            "the record's key entry is absent, so it does not open",
            "Run store-check; a record whose key is gone cannot be read again.",
        ),
        HostError::SealInvalid { .. } => failure(
            "MEMORY_SEAL_INVALID",
            "the record's sealed body does not open",
            "Run store-check; the database or its key file was changed outside Umbel.",
        ),
        HostError::QueryTooBroad { limit } => failure(
            "MEMORY_QUERY_TOO_BROAD",
            &format!("the query matches more than {limit} readable records; nothing is ranked past that"),
            "Narrow the query: add a required term with +, limit a term to subject:, tags: or body:, or filter by class, tags or project.",
        )
        .with_error_details(json!({ "limit": limit })),
        HostError::NotProvisioned => not_found(),
        HostError::Corrupt(_) => failure("STORE_CORRUPT", &message, "Run store-check."),
        HostError::Io(_) => failure(
            "STORE_IO",
            &message,
            "Check the disk and the permissions of the workspace's state directory.",
        ),
        _ => failure("MEMORY_FAILED", &message, "Run store-check and try again."),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn a_leading_code_is_upper_snake_case() {
        assert_eq!(
            leading_code("MEMORY_SHARE_NOT_ALLOWED: no"),
            Some("MEMORY_SHARE_NOT_ALLOWED")
        );
        assert_eq!(leading_code("memory write: subject"), None);
        assert_eq!(leading_code("no code here"), None);
    }

    #[test]
    fn a_host_refusal_keeps_its_code() {
        let outcome = host(&HostError::NotGranted(
            "MEMORY_SHARE_NOT_ALLOWED: sharing needs a writer".into(),
        ));
        assert_eq!(
            outcome.as_value()["error"]["code"],
            "MEMORY_SHARE_NOT_ALLOWED"
        );
        let found = host(&HostError::NotFound(
            "MEMORY_NOT_FOUND: no record `mem-x`".into(),
        ));
        assert_eq!(found.as_value()["error"]["code"], "MEMORY_NOT_FOUND");
    }
}
