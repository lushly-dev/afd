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

pub mod doctor;
pub mod events;
pub mod plugins;
pub mod principal;
pub mod provenance;
pub mod workspace;

mod commands;
mod host;
#[cfg(feature = "cli")]
mod logging;
mod middleware;
mod surfaces;
mod versions;

#[cfg(feature = "testkit")]
pub mod testkit;

pub use host::{Host, HostBuilder, HostError, RESERVED_VERBS, SPACE_NOT_FOUND};
pub use plugins::{MANIFEST_VERSION, PACK_VERSION, PLUGIN_PROTOCOL_VERSION, WIT_WORLD};
pub use versions::{CURSOR_VERSION, EVENT_VERSION, PRINCIPAL_VERSION, PROVENANCE_VERSION};
pub use workspace::{CONFIG_VERSION, Config, SpaceId, Workspace};

#[cfg(feature = "cli")]
pub mod cli;
