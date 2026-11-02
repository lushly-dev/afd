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
#[cfg(feature = "mounted")]
mod mounted;
mod outcome;
mod store;

pub mod build;

pub use assets::Asset;
pub use cx::{CallContext, Cx, HostError, HostServices, Level, NoServices};
#[cfg(feature = "mounted")]
pub use mounted::{mounted_server, serve_mounted};
pub use outcome::{Outcome, failure, success};
pub use store::{ContentEntry, Reader, SpaceCx};
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
}
