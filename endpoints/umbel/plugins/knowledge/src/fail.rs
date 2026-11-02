//! Host refusals as AFD failures.

use umbel_sdk::{HostError, Outcome, failure};

/// The failure for a host service refusing: the AFD code section 3.3 maps it to, and what the
/// caller can do.
pub(crate) fn host(error: &HostError) -> Outcome {
    let message = error.to_string();
    match error {
        HostError::NotGranted(text) if text.contains("SPACE_NOT_READABLE") => failure(
            "SPACE_NOT_READABLE",
            &message,
            "Ask the workspace owner to add you to the space's readers.",
        ),
        HostError::NotGranted(_) => failure(
            "PLUGIN_GRANT_DENIED",
            &message,
            "Enable the plugin with every grant its manifest declares, and allow its write grants for this space in umbel.toml.",
        ),
        HostError::NotFound(_) => failure(
            "DOCUMENT_NOT_FOUND",
            "no readable document has that id",
            "Check the id with knowledge-search or knowledge-list; a document you may not read is reported the same way.",
        ),
        HostError::Invalid(text) => failure(
            "QUERY_INVALID",
            &format!("the query was refused: {text}"),
            "Fix the query: fields are title, aliases, description, headings, body, code, tags, owners, type, collection, status, verified, sensitivity, lang, path, updated, stale_after and meta.<key>; `access` is never queryable.",
        ),
        HostError::TooLarge(_) => failure(
            "KNOWLEDGE_TOO_LARGE",
            &message,
            "Narrow the request: a smaller limit, a smaller window, or a shorter query.",
        ),
        HostError::Conflict { .. } => failure(
            "STORE_CONFLICT",
            &message,
            "Another process changed the index or the documents; run the command again.",
        ),
        HostError::Busy(_) => failure(
            "STORE_BUSY",
            &message,
            "Another process holds the store or the index writer; run the command again shortly.",
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
        _ => failure(
            "KNOWLEDGE_FAILED",
            &message,
            "Run store-check and try again.",
        ),
    }
}

/// The failure for a call that resolved no space (the host resolves one for every command whose
/// input has a `space` property, so this is a defensive answer).
pub(crate) fn no_space() -> Outcome {
    failure(
        "SPACE_NOT_FOUND",
        "the call resolved no space",
        "Pass `space`, or set default_space in umbel.toml.",
    )
}

/// The failure for a document that is absent or that the caller may not read: one code for both,
/// so existence does not leak.
pub(crate) fn document_not_found() -> Outcome {
    failure(
        "DOCUMENT_NOT_FOUND",
        "no readable document has that id in this space",
        "Check the id with knowledge-search or knowledge-list; a document you may not read is reported the same way.",
    )
}
