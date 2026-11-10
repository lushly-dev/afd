//! AFD Umbel: an empty host for capability plugins over MCP and CLI.
//!
//! The host library arrives step by step, as the
//! [phase 0](https://github.com/lushly-dev/afd/blob/main/endpoints/umbel/docs/phases/0-host-skeleton/spec.md)
//! and [phase 1](https://github.com/lushly-dev/afd/blob/main/endpoints/umbel/docs/phases/1-plugin-contract/spec.md)
//! specifications plan it; `endpoints/umbel/docs/STATUS.md` says what exists.
#![forbid(unsafe_code)]
// AFD's `CommandError` is the error type of the specified signatures (`resolve_space`, the
// middleware); it is 136 bytes and the signatures are not ours to change.
#![allow(clippy::result_large_err)]

pub mod access;
pub mod auth;
pub mod authority;
pub mod doctor;
pub mod events;
pub mod plugins;
pub mod positions;
pub mod principal;
pub mod provenance;
pub mod workspace;

mod commands;
mod host;
#[cfg(feature = "cli")]
mod logging;
mod middleware;
mod person;
#[cfg(feature = "auth")]
mod shared;
mod store;
mod surfaces;
mod templates;
mod versions;

#[cfg(feature = "testkit")]
pub mod testkit;

pub use host::{Host, HostBuilder, HostError, RESERVED_VERBS, SPACE_NOT_FOUND};
pub use plugins::{
    MANIFEST_VERSION, MANIFEST_VERSIONS, PACK_VERSION, PLUGIN_PROTOCOL_VERSION, WIT_WORLD,
};
pub use store::{STORE_GRANTS, codes as store_codes};
pub use surfaces::http::HttpServer;
pub use versions::{
    BUNDLE_VERSION, CAPTURE_VERSION, CURATOR_VERSION, CURSOR_VERSION, CURSOR_VERSIONS,
    DOCUMENT_VERSION, ENVELOPE_VERSIONS, EVENT_VERSION, EVENT_VERSIONS, LOCATOR_VERSION,
    LOCATOR_VERSIONS, MEMORY_KEYS_VERSION, MEMORY_VERSION, MEMORY_VERSIONS, PERSON_VERSION,
    PRINCIPAL_VERSION, PRINCIPAL_VERSIONS, PROPOSAL_VERSION, PROPOSAL_VERSIONS, PROVENANCE_VERSION,
    STORE_VERSION, TASK_VERSION, USAGE_VERSION,
};
pub use workspace::{CONFIG_VERSION, CONFIG_VERSIONS, Config, SpaceId, Workspace};

#[cfg(feature = "cli")]
pub mod cli;
