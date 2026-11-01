//! The hello plugin: one command, one pack and one skill, written once against `umbel-sdk`.
//!
//! [`plugin`] is the SDK value; `umbel::plugins::sdk(umbel_plugin_hello::plugin())` links it into
//! a host as `compiled:hello`. The same source builds as a component and as a mounted server in
//! the steps that add those loaders.
#![forbid(unsafe_code)]

use serde_json::{Value, json};
use umbel_sdk::{Asset, Cx, HostError, Level, Outcome, Plugin, failure, success};

/// The manifest of the compiled build.
pub const COMPILED_MANIFEST: &str = include_str!("../manifests/compiled.toml");

/// The hello plugin.
#[derive(Debug, Clone, Copy, Default)]
pub struct Hello;

/// The hello plugin as an SDK value.
pub fn plugin() -> Hello {
    Hello
}

impl Plugin for Hello {
    fn manifest(&self) -> &'static str {
        COMPILED_MANIFEST
    }

    fn assets(&self) -> &'static [Asset] {
        umbel_sdk::embedded_assets!()
    }

    fn handle(&self, name: &str, input: Value, cx: &mut Cx) -> Outcome {
        match name {
            "hello-greet" => greet(&input, cx),
            other => failure(
                "COMMAND_NOT_FOUND",
                &format!("the hello plugin has no command `{other}`"),
                "Call hello-greet.",
            ),
        }
    }
}

fn denied(error: &HostError) -> Outcome {
    failure(
        "HELLO_UNAVAILABLE",
        &error.to_string(),
        "Enable the plugin with every grant its manifest declares, and do not deny any.",
    )
}

fn greet(input: &Value, cx: &Cx) -> Outcome {
    let name = match input.get("name").and_then(Value::as_str) {
        Some(name) => name.to_owned(),
        None => match cx.config() {
            Ok(config) => config
                .get("default_name")
                .and_then(Value::as_str)
                .unwrap_or("world")
                .to_owned(),
            Err(error) => return denied(&error),
        },
    };
    let salutation = match cx.pack_read("greetings", "data/salutation.txt") {
        Ok(bytes) => String::from_utf8_lossy(&bytes)
            .lines()
            .next()
            .unwrap_or("Hello")
            .trim()
            .to_owned(),
        Err(error) => return denied(&error),
    };
    let at = match cx.now_ms() {
        Ok(millis) => chrono::DateTime::from_timestamp_millis(millis)
            .map(|time| time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
            .unwrap_or_default(),
        Err(error) => return denied(&error),
    };
    cx.log(Level::Info, &format!("greeting {name} with {salutation}"));
    let space = cx.call().space.clone().unwrap_or_default();
    success(json!({ "greeting": format!("{salutation}, {name}!"), "space": space, "at": at }))
}
