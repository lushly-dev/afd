//! The plugin as a WebAssembly component (feature `component`, target `wasm32-wasip2`).
//!
//! [`export_component!`](crate::export_component) generates the exports of the WIT world
//! `umbel:plugin/plugin@1.0.0` for a plugin and routes `command.execute` to
//! [`Plugin::handle`]. The imports (the host services) are reached through [`Cx`], which calls
//! each one only when a handler asks for it, so a component imports exactly the interfaces its
//! plugin uses, and the host checks those against the grants the manifest declares.
//!
//! Components must read time and randomness only through [`Cx::now_ms`] and [`Cx::random`], or
//! the standard library, whose WASI clocks and random bytes the host also takes from the command
//! context. A component must never use random bytes for secrets: they are written to the
//! journal's tape, so anyone who can read the journal can recompute them.

use serde_json::Value;

use crate::{CallContext, Cx, HostError, Level, Plugin, failure};

/// The generated bindings of the world. Hidden: the macro and [`run`] are the interface.
#[doc(hidden)]
#[allow(unsafe_code, missing_docs, unreachable_pub, clippy::all)]
pub mod bindings {
    wit_bindgen::generate!({
        path: "../wit/umbel-plugin-1.0.0",
        world: "plugin",
        pub_export_macro: true,
        export_macro_name: "__umbel_export_plugin",
        default_bindings_module: "umbel_sdk::component::bindings",
    });
}

use bindings::umbel::plugin::{clock, config, events, log, packs, random, types};

/// Run one command: parse the input, build the [`Cx`] over the imports and call the plugin.
/// Used by [`export_component!`](crate::export_component); the answer is a `CommandResult` as
/// JSON text.
#[doc(hidden)]
pub fn run(
    plugin: &impl Plugin,
    name: &str,
    input: &str,
    context: types::CallContext,
) -> String {
    let call = CallContext {
        command: context.command,
        trace_id: context.trace_id,
        space: context.space,
        actor_kind: context.actor_kind,
        actor_id: context.actor_id,
        on_behalf_of: context.on_behalf_of,
        interface: context.interface,
    };
    let outcome = match serde_json::from_str::<Value>(input) {
        Ok(input) => {
            let mut cx = Cx::component(call);
            plugin.handle(name, input, &mut cx)
        }
        Err(error) => failure(
            "INVALID_INPUT",
            &format!("the input is not JSON: {error}"),
            "Send the command's input as a JSON value.",
        ),
    };
    outcome.into_value().to_string()
}

fn host_error(error: types::HostError) -> HostError {
    match error {
        types::HostError::NotGranted(message) => HostError::NotGranted(message),
        types::HostError::NotFound(message) => HostError::NotFound(message),
        types::HostError::Invalid(message) => HostError::Invalid(message),
        types::HostError::TooLarge(message) => HostError::TooLarge(message),
    }
}

fn parse(text: &str) -> Result<Value, HostError> {
    serde_json::from_str(text)
        .map_err(|error| HostError::Invalid(format!("the host answered invalid JSON: {error}")))
}

pub(crate) fn config() -> Result<Value, HostError> {
    parse(&config::get())
}

pub(crate) fn log(level: Level, message: &str) {
    let level = match level {
        Level::Error => log::Level::Error,
        Level::Warn => log::Level::Warn,
        Level::Info => log::Level::Info,
        Level::Debug => log::Level::Debug,
        Level::Trace => log::Level::Trace,
    };
    log::write(level, message);
}

pub(crate) fn pack_list(pack: &str) -> Result<Vec<String>, HostError> {
    packs::list(pack).map_err(host_error)
}

pub(crate) fn pack_read(pack: &str, path: &str) -> Result<Vec<u8>, HostError> {
    packs::read(pack, path).map_err(host_error)
}

pub(crate) fn events(
    space: Option<&str>,
    after: Option<&str>,
    limit: u32,
) -> Result<Value, HostError> {
    let listed = events::list(space, after, limit).map_err(host_error)?;
    parse(&listed)
}

pub(crate) fn now_ms() -> i64 {
    clock::now()
}

pub(crate) fn random() -> f64 {
    random::next()
}

/// Build the plugin as a WebAssembly component: generate the exports of
/// `umbel:plugin/plugin@1.0.0` and route `command.execute` to [`Plugin::handle`].
///
/// ```ignore
/// umbel_sdk::export_component!(MyPlugin);
/// ```
///
/// The argument is an expression of the plugin's type, evaluated on every call (a component
/// keeps no state between calls). The expansion contains the canonical-ABI glue, which uses
/// `unsafe`, so a crate that calls this macro sets `unsafe_code = "deny"` rather than `forbid`
/// in its lints (specification section 1); the glue is wrapped in `#[allow(unsafe_code)]`.
#[macro_export]
macro_rules! export_component {
    ($plugin:expr) => {
        // The plugin expression is evaluated in the caller's scope, then the glue module reaches
        // it through this function.
        #[doc(hidden)]
        fn __umbel_plugin() -> impl $crate::Plugin {
            $plugin
        }

        #[allow(unsafe_code, missing_docs, unreachable_pub)]
        mod __umbel_component {
            use $crate::component::bindings::exports::umbel::plugin::command::Guest;
            use $crate::component::bindings::umbel::plugin::types::CallContext;

            struct Component;

            impl Guest for Component {
                fn execute(name: String, input: String, context: CallContext) -> String {
                    $crate::component::run(&super::__umbel_plugin(), &name, &input, context)
                }
            }

            $crate::component::bindings::__umbel_export_plugin!(Component with_types_in $crate::component::bindings);
        }
    };
}
