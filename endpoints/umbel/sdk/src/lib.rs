//! The Umbel plugin SDK (phase 1 specification, section 5): the portable plugin API.
//!
//! One [`Plugin`] value serves every plugin kind: the host links it as a compiled plugin
//! (`umbel::plugins::sdk`), and later steps build it as a WebAssembly component and as a
//! mounted MCP server. The crate does not depend on the host crate.
//!
//! With the `component` feature, [`export_component!`] builds the plugin as a WebAssembly
//! component for `wasm32-wasip2` (the host side is in the `umbel` crate's component loader).
//!
//! A handler receives the validated input and a [`Cx`], the handle to the host services its
//! plugin was granted, and answers an [`Outcome`], an AFD `CommandResult` as JSON.
//!
//! ```
//! use umbel_sdk::{Asset, Cx, Outcome, Plugin, failure, success};
//!
//! struct Echo;
//!
//! impl Plugin for Echo {
//!     fn manifest(&self) -> &'static str {
//!         "manifest_version = 1\nprotocol = 1\n"
//!     }
//!
//!     fn handle(&self, name: &str, input: serde_json::Value, _cx: &mut Cx) -> Outcome {
//!         match name {
//!             "echo-say" => success(input),
//!             other => failure(
//!                 "UNKNOWN_COMMAND",
//!                 &format!("no command {other}"),
//!                 "Call a command the manifest declares.",
//!             ),
//!         }
//!     }
//! }
//!
//! let assets: &[Asset] = Echo.assets();
//! assert!(assets.is_empty());
//! ```
#![cfg_attr(not(feature = "component"), forbid(unsafe_code))]

mod assets;
#[cfg(feature = "component")]
pub mod component;
mod cx;
mod legacy;
mod memory;
#[cfg(feature = "mounted")]
mod mounted;
mod outcome;
mod records;
mod services;
mod store;

pub mod build;

pub use assets::Asset;
pub use cx::{
    CallContext, Cx, HostError, Level, PersonCheck, PersonDecision, PipelineAttestation,
    WalCheckpoint,
};
pub use legacy::HostServices;
pub use memory::{
    EraseAnswer, EraseCall, ErasePreview, LeftOutQuery, MemoryPath, MemoryWriteRequest,
};
#[cfg(feature = "mounted")]
pub use mounted::{mounted_server, serve_mounted};
pub use outcome::{Outcome, failure, success};
pub use services::{
    AllServices, ClockServices, ConfigServices, ContentServices, ContentWriteServices,
    DeriveServices, DocumentServices, DocumentWriteServices, EventServices, GraphServices,
    GraphWriteServices, IndexServices, IndexWriteServices, LogServices, MaintenanceServices,
    MemoryServices, MemoryWriteServices, NoServices, PackServices, RandomServices, ReadServices,
    ReaderServices, RecordServices, RecordWriteServices,
};
pub use store::{CollectionInfo, CollectionMeta, ContentEntry, Reader, SpaceCx};
/// The store types the methods take and return (phase 2 specification, section 3.3).
pub use umbel_store;

/// A plugin written against the SDK. One value serves every kind.
pub trait Plugin: Send + Sync + 'static {
    /// The manifest text, normally `include_str!("../umbel-plugin.toml")`.
    fn manifest(&self) -> &'static str;

    /// The plugin's files (packs, skills, schemas the manifest names), embedded by
    /// [`build::embed_assets`]. A compiled SDK plugin supplies its packs and skills through it;
    /// a component and a mounted server ship them in the plugin directory instead.
    fn assets(&self) -> &'static [Asset] {
        &[]
    }

    /// The command's handler, by registered name. Called once per call; must not keep state
    /// between calls if the plugin is built as a component.
    fn handle(&self, name: &str, input: serde_json::Value, cx: &mut Cx) -> Outcome;

    /// The plugin's own check of its pack `pack`, which the host's doctor runs against each space
    /// override of that pack before any command is called (D172, `plugins.pack_checks`). `cx`
    /// holds the plugin's own grants, with the override's space as the call's space, so
    /// [`Cx::pack_list`] and [`Cx::pack_read`] read the override exactly as a command would.
    ///
    /// Answer `None`, the default, to offer no check for `pack`: the doctor then checks that
    /// override's layout only. Otherwise answer a success when the override would be served,
    /// and the failure a command would answer when it would be refused: the doctor shows its
    /// code, message and suggestion, and the first entries of `details.problems` when the
    /// failure holds them (each `{ "code", "path", "at" }`, `at` a JSON pointer, optional). A
    /// retryable failure is a warning there, not a failure.
    ///
    /// A compiled plugin only: a component and a mounted server offer no check (WIT world
    /// 1.0.0 has no export for it).
    fn check_pack(&self, pack: &str, cx: &mut Cx) -> Option<Outcome> {
        let _ = (pack, cx);
        None
    }

    /// The plugin's own check of its configuration (the instance's `[plugins.<id>.config]`),
    /// which the host's doctor runs once for each instance before any command is called
    /// (`plugins.config_checks`). The configuration schema checks its shape when the workspace
    /// opens; this is for what a schema cannot say, such as one entry naming another or a
    /// resource the configuration names being reachable. `cx` holds the plugin's own grants in
    /// the workspace's default space, or in the instance's first enabled space when the default
    /// is not one of its spaces, so [`Cx::config`] reads the configuration as a command would.
    ///
    /// Answer `None`, the default, to offer no check. Otherwise answer as
    /// [`Plugin::check_pack`] does: a success, or the failure a command would answer, whose
    /// code, message, suggestion and first `details.problems` the doctor shows. A retryable
    /// failure is a warning there, not a failure. The doctor runs it on a blocking thread, so
    /// it may read files or probe a local service, briefly.
    ///
    /// A compiled plugin only, as [`Plugin::check_pack`] is.
    fn check_config(&self, cx: &mut Cx) -> Option<Outcome> {
        let _ = cx;
        None
    }
}
