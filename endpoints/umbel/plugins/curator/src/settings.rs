//! What every curator command opens with: the space, the clock, the caller's principal, the
//! instance's configuration (with the reserved `model` refused, section 8.5), the space's target
//! and the settle pack.

use serde_json::Value;
use umbel_sdk::{CallContext, Cx, Outcome};
use umbel_store::memory::Millis;

use crate::fail;
use crate::pack::Settle;
use crate::target::{self, Target};

/// One call's shared state.
pub(crate) struct Call {
    pub(crate) space: String,
    pub(crate) now: Millis,
    /// The caller's effective principal: whose candidates and records these are.
    pub(crate) principal: String,
    pub(crate) target: Target,
    pub(crate) settle: Settle,
}

/// The caller's effective principal, derived as the host and the knowledge plugin derive it: the
/// person acted for, else the actor's own `<kind>:<id>`. `None` for an actor with no id, which
/// has no curator records (step 4, amendment 4).
pub(crate) fn principal(call: &CallContext) -> Option<String> {
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

impl Call {
    /// The call's space, clock, principal, target and pack, in that order of refusal after the
    /// model: a configured model refuses before anything is read.
    pub(crate) fn open(cx: &Cx) -> Result<Self, Outcome> {
        let config = cx.config().unwrap_or(Value::Null);
        if config.get("model").is_some_and(|model| !model.is_null()) {
            return Err(fail::model_unavailable());
        }
        let call = cx.call();
        let space = call.space.clone().ok_or_else(fail::no_space)?;
        let principal = principal(call).ok_or_else(fail::no_principal)?;
        let now = cx.now_ms().map_err(|error| fail::host(&error))?;
        let target = target::resolve(cx, &config, &space)?;
        let settle = Settle::load(cx)?;
        Ok(Self {
            space,
            now,
            principal,
            target,
            settle,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(kind: &str, id: Option<&str>, on_behalf_of: Option<&str>) -> CallContext {
        CallContext {
            actor_kind: kind.to_owned(),
            actor_id: id.map(str::to_owned),
            on_behalf_of: on_behalf_of.map(str::to_owned),
            ..CallContext::default()
        }
    }

    #[test]
    fn the_principal_is_the_person_acted_for_else_the_actor() {
        assert_eq!(
            principal(&call("human", Some("ada"), None)).as_deref(),
            Some("human:ada")
        );
        assert_eq!(
            principal(&call("agent", Some("bot"), Some("ada"))).as_deref(),
            Some("human:ada")
        );
        assert_eq!(
            principal(&call("agent", Some("bot"), None)).as_deref(),
            Some("agent:bot")
        );
        assert_eq!(principal(&call("human", None, None)), None);
        assert_eq!(principal(&call("robot", Some("x"), None)), None);
    }
}
