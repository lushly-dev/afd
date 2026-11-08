//! Failures as AFD results. No message, suggestion or detail ever holds a document's or a
//! record's text, or the task (D67).

use umbel_sdk::{HostError, Outcome, failure};

/// `CONTEXT_INVALID` for a bad field. `what` names the rule, never the value.
pub(crate) fn invalid(what: &str) -> Outcome {
    failure(
        "CONTEXT_INVALID",
        &format!("the input was refused: {what}"),
        "Fix the field the message names and run the command again; context-guide lists every field.",
    )
}

/// `CONTEXT_PACK_INVALID`: a bundle pack override that does not load.
pub(crate) fn pack_invalid(reason: &str) -> Outcome {
    failure(
        "CONTEXT_PACK_INVALID",
        &format!("the bundle pack does not load: {reason}"),
        "Fix data/bundle.toml in spaces/<space>/packs/context/bundle/, or remove the override to use the default.",
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

/// The failure for a host service refusing in a way that is not a lane being absent.
pub(crate) fn host(error: &HostError) -> Outcome {
    let message = error.to_string();
    match error {
        HostError::Busy(_) => failure(
            "STORE_BUSY",
            &message,
            "Another process holds the store; run the command again shortly.",
        )
        .with_retryable(true),
        HostError::Corrupt(_) => failure("STORE_CORRUPT", &message, "Run store-check."),
        HostError::Io(_) => failure(
            "STORE_IO",
            &message,
            "Check the disk and the permissions of the workspace's state directory.",
        ),
        HostError::NotGranted(_) => failure(
            "PLUGIN_GRANT_DENIED",
            &message,
            "Enable the context plugin with its grants in umbel.toml.",
        ),
        HostError::QueryTooBroad { limit } => failure(
            "MEMORY_QUERY_TOO_BROAD",
            &message,
            "Name fewer or rarer task terms, or a project, so memory recall matches fewer records.",
        )
        .with_error_details(serde_json::json!({ "limit": limit })),
        _ => failure(
            "CONTEXT_FAILED",
            &message,
            "Run store-check and try again; context-bundle reads the stores and writes nothing.",
        ),
    }
}
