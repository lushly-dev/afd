//! The `ideas` plugin: a store of a person's ideas, each a few sentences, typed, kept for good as
//! a standing record, matched against what is held, and affirmed only by the person
//! (`docs/plugins/ideas/spec.md`).
//!
//! [`plugin`] is the SDK value; `umbel::plugins::sdk(umbel_plugin_ideas::plugin())` links it into
//! a host as `compiled:ideas`. It depends on no other plugin (D3).
//!
//! - `pack`: the vocabulary pack, read and checked on every call that needs it.
//! - `records`: the four declared kinds (`wording`, `idea`, `review`, `proposal`) and their
//!   writes; `ids`: ids drawn or derived from an idempotency key; `label`: the host's standing
//!   label passed through; `bands`: a score's band.
//! - `capture`, `match_`, `find`, `open`, `guide` and `archive`: the commands of step C1.
//!   The review commands and `ideas-ask` answer `NOT_IMPLEMENTED` until steps C2 and C3.
//!
//! A statement, a reason or a question is never in a message, a suggestion, a detail or a log
//! line. No code here uses a filesystem, clock, thread or network: the clock and the random
//! source are the host's grants.
#![forbid(unsafe_code)]

mod archive;
mod bands;
mod budget;
mod capture;
mod fail;
mod find;
mod guide;
mod ids;
mod label;
mod match_;
mod open;
mod pack;
mod pending;
mod records;

use serde_json::Value;
use umbel_sdk::{Asset, Cx, Outcome, Plugin, success};

/// The manifest of the compiled build.
pub const MANIFEST: &str = include_str!("../umbel-plugin.toml");

/// The ideas plugin.
#[derive(Debug, Clone, Copy, Default)]
pub struct Ideas;

/// The plugin as an SDK value.
pub fn plugin() -> Ideas {
    Ideas
}

impl Plugin for Ideas {
    fn manifest(&self) -> &'static str {
        MANIFEST
    }

    fn assets(&self) -> &'static [Asset] {
        umbel_sdk::embedded_assets!()
    }

    fn handle(&self, name: &str, input: Value, cx: &mut Cx) -> Outcome {
        let call = match Call::open(cx) {
            Ok(call) => call,
            Err(refusal) => return refusal,
        };
        let result = match name {
            "ideas-capture" => capture::run(&input, cx, &call),
            "ideas-match" => match_::run(&input, cx, &call),
            "ideas-find" => find::run(&input, cx, &call),
            "ideas-open" => open::run(&input, cx, &call),
            "ideas-guide" => guide::run(cx, &call),
            "ideas-export" => archive::export(&input, cx, &call),
            "ideas-import" => archive::import(&input, cx, &call),
            "ideas-ask"
            | "ideas-review-stage"
            | "ideas-review-show"
            | "ideas-review-unstage"
            | "ideas-review-preview"
            | "ideas-review-apply"
            | "ideas-review-report" => Err(fail::not_implemented(name)),
            other => Err(fail::unknown_command(other)),
        };
        result.unwrap_or_else(|refusal| refusal)
    }

    /// The doctor's check of a space override (D172): the commands' own reader, so a refused
    /// override fails `plugins.pack_checks` with the code a call would get (section 5).
    fn check_pack(&self, pack: &str, cx: &mut Cx) -> Option<Outcome> {
        if pack != pack::PACK {
            return None;
        }
        Some(match pack::Pack::read(cx) {
            Ok(read) => success(serde_json::json!({
                "types": read.types.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
            })),
            Err(refusal) => refusal,
        })
    }
}

/// What every command needs of its call: the space, the caller's effective principal and the
/// clock.
#[derive(Debug, Clone)]
pub(crate) struct Call {
    /// The call's space.
    pub(crate) space: String,
    /// The caller's effective principal, derived as the host derives it; empty when the caller
    /// has none, which the host then refuses at the first write.
    pub(crate) principal: String,
    /// The command's name.
    pub(crate) command: String,
}

impl Call {
    fn open(cx: &Cx) -> Result<Self, Outcome> {
        let call = cx.call();
        let space = call.space.clone().ok_or_else(fail::no_space)?;
        Ok(Self {
            space,
            principal: principal(call).unwrap_or_default(),
            command: call.command.clone(),
        })
    }
}

/// The caller's effective principal, as the host derives it (`src/provenance.rs:245`) and the
/// curator does: `human:<on_behalf_of>` when the actor acts for someone, else `<kind>:<id>`.
fn principal(call: &umbel_sdk::CallContext) -> Option<String> {
    if let Some(person) = call.on_behalf_of.as_deref().filter(|p| !p.is_empty()) {
        return Some(format!("human:{person}"));
    }
    let id = call.actor_id.as_deref().filter(|id| !id.is_empty())?;
    matches!(
        call.actor_kind.as_str(),
        "human" | "agent" | "service" | "script"
    )
    .then(|| format!("{}:{id}", call.actor_kind))
}

/// Input helpers: a refusal names the field, never its value.
pub(crate) mod input {
    use serde_json::Value;
    use umbel_sdk::Outcome;

    use crate::fail;

    /// An optional string member.
    pub(crate) fn string<'a>(input: &'a Value, field: &str) -> Result<Option<&'a str>, Outcome> {
        match input.get(field) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(text)) => Ok(Some(text)),
            Some(_) => Err(fail::invalid(field, "must be a string")),
        }
    }

    /// An optional boolean member.
    pub(crate) fn boolean(input: &Value, field: &str) -> Result<Option<bool>, Outcome> {
        match input.get(field) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Bool(flag)) => Ok(Some(*flag)),
            Some(_) => Err(fail::invalid(field, "must be true or false")),
        }
    }

    /// An optional integer member within `min..=max`.
    pub(crate) fn integer(
        input: &Value,
        field: &str,
        min: u64,
        max: u64,
    ) -> Result<Option<u64>, Outcome> {
        match input.get(field) {
            None | Some(Value::Null) => Ok(None),
            Some(value) => match value.as_u64() {
                Some(n) if (min..=max).contains(&n) => Ok(Some(n)),
                _ => Err(fail::invalid(
                    field,
                    &format!("must be an integer from {min} to {max}"),
                )),
            },
        }
    }

    /// An optional array of strings.
    pub(crate) fn strings(input: &Value, field: &str) -> Result<Option<Vec<String>>, Outcome> {
        match input.get(field) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Array(items)) => items
                .iter()
                .map(|item| {
                    item.as_str()
                        .map(str::to_owned)
                        .ok_or_else(|| fail::invalid(field, "must hold strings only"))
                })
                .collect::<Result<Vec<_>, _>>()
                .map(Some),
            Some(_) => Err(fail::invalid(field, "must be an array of strings")),
        }
    }

    /// Whether `text` is one line with no control character.
    pub(crate) fn one_line(text: &str) -> bool {
        !text.chars().any(char::is_control)
    }
}
