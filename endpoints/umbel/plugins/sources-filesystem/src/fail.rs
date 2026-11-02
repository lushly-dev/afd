//! Host refusals as AFD failures.

use umbel_sdk::{HostError, Outcome, failure};

/// The failure for a host service refusing: the AFD code section 3.3 maps it to, and what the
/// caller can do.
pub(crate) fn host(error: &HostError) -> Outcome {
    let message = error.to_string();
    match error {
        HostError::NotGranted(text) if text.contains("STORE_WRITE_NOT_ALLOWED") => failure(
            "STORE_WRITE_NOT_ALLOWED",
            &message,
            "Add the collection to the instance's `allow` list for the write grants in umbel.toml.",
        ),
        HostError::NotGranted(text) if text.contains("SPACE_NOT_READABLE") => failure(
            "SPACE_NOT_READABLE",
            &message,
            "Ask the workspace owner to add you to the space's readers.",
        ),
        HostError::NotGranted(_) => failure(
            "PLUGIN_GRANT_DENIED",
            &message,
            "Enable the plugin with every grant its manifest declares, with the write grants allowed for this space in umbel.toml.",
        ),
        HostError::NotFound(_) => failure(
            "COLLECTION_NOT_FOUND",
            &message,
            "Declare the collection under [spaces.<id>.collections] in umbel.toml and create its root.",
        ),
        HostError::Invalid(text) if text.contains("STORE_PROVENANCE_REQUIRED") => failure(
            "STORE_PROVENANCE_REQUIRED",
            &message,
            "Report this: the plugin sent a document the store could not accept.",
        ),
        HostError::Invalid(_) => failure(
            "SOURCE_INVALID",
            &message,
            "Check the collection's configuration and the files under its root.",
        ),
        HostError::TooLarge(_) => failure(
            "SOURCE_TOO_LARGE",
            &message,
            "Lower `limit` or raise the collection's max_file_bytes (at most 16 MiB).",
        ),
        HostError::Conflict { .. } => failure(
            "STORE_CONFLICT",
            &message,
            "Another process changed the same documents; run the command again.",
        ),
        HostError::Busy(_) => failure(
            "STORE_BUSY",
            &message,
            "Another process holds the store; run the command again shortly.",
        ),
        HostError::Corrupt(_) => failure(
            "STORE_CORRUPT",
            &message,
            "Run store-check, then knowledge-index with rebuild=true.",
        ),
        HostError::Io(_) => failure(
            "STORE_IO",
            &message,
            "Check the disk and the permissions of the workspace's state directory.",
        ),
        _ => failure("SOURCE_FAILED", &message, "Run store-check and try again."),
    }
}
