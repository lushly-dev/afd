//! The principal behind a command call, and the context defaults AFD surfaces fill in
//! (`actor`, `clock`, `random`).

use std::fmt;
use std::str::FromStr;
use std::sync::{Arc, OnceLock};

use serde::{Deserialize, Deserializer, Serialize};

use crate::clock::{Clock, RandomSource, SYSTEM_CLOCK, SYSTEM_RANDOM};
use crate::commands::CommandContext;

/// What kind of principal is calling: a person, an AI agent, a service, a script or a test.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActorKind {
    /// A person.
    Human,
    /// An AI agent.
    Agent,
    /// Another service.
    Service,
    /// A script or scheduled job.
    Script,
    /// A test.
    Test,
}

/// The kinds of principal that can call a command, in TypeScript's order.
pub const ACTOR_KINDS: [ActorKind; 5] = [
    ActorKind::Human,
    ActorKind::Agent,
    ActorKind::Service,
    ActorKind::Script,
    ActorKind::Test,
];

impl ActorKind {
    /// The kind's wire name, such as `agent`.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Human => "human",
            Self::Agent => "agent",
            Self::Service => "service",
            Self::Script => "script",
            Self::Test => "test",
        }
    }
}

impl fmt::Display for ActorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for ActorKind {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, String> {
        ACTOR_KINDS
            .into_iter()
            .find(|kind| kind.as_str() == value)
            .ok_or_else(|| {
                format!(
                    "Unknown actor kind '{value}': expected human, agent, service, script or test"
                )
            })
    }
}

/// Whether `value` is the wire name of an [`ActorKind`].
pub fn is_actor_kind(value: &str) -> bool {
    value.parse::<ActorKind>().is_ok()
}

/// Reads an optional actor kind, treating an unknown kind as absent, so a result from a newer
/// implementation still parses.
pub(crate) fn deserialize_lenient_actor_kind<'de, D>(
    deserializer: D,
) -> Result<Option<ActorKind>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .and_then(|kind| kind.parse().ok()))
}

/// Who is calling a command.
///
/// Surfaces fill in `kind`: the MCP server (feature `server`) uses `agent`, and hosts set the
/// actor for their own callers with [`CommandContext::with_actor`]. Middleware and handlers
/// read `context.actor` to key trust, approval, rate-limit or data rules on it; AFD itself
/// only reports `kind` (as `metadata.actorKind`), never the id.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Actor {
    /// What kind of principal this is.
    pub kind: ActorKind,
    /// Stable identifier within the application, e.g. a user ID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Display name, e.g. "Claude (advisor)".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// The human an agent or service is acting for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_behalf_of: Option<String>,
}

impl Actor {
    /// An actor of `kind` with no id, label or principal.
    pub fn new(kind: ActorKind) -> Self {
        Self {
            kind,
            id: None,
            label: None,
            on_behalf_of: None,
        }
    }

    /// Set the identifier.
    pub fn with_id(mut self, id: impl Into<String>) -> Self {
        self.id = Some(id.into());
        self
    }

    /// Set the display name.
    pub fn with_label(mut self, label: impl Into<String>) -> Self {
        self.label = Some(label.into());
        self
    }

    /// Set the human this actor is acting for.
    pub fn with_on_behalf_of(mut self, on_behalf_of: impl Into<String>) -> Self {
        self.on_behalf_of = Some(on_behalf_of.into());
        self
    }
}

impl From<ActorKind> for Actor {
    fn from(kind: ActorKind) -> Self {
        Self::new(kind)
    }
}

/// Whether `value` is a well-formed actor object, as TypeScript's `isActor` checks it: a known
/// `kind`, and `id`, `label` and `onBehalfOf` strings when present. Other keys are allowed.
pub fn is_actor(value: &serde_json::Value) -> bool {
    let Some(actor) = value.as_object() else {
        return false;
    };
    actor
        .get("kind")
        .and_then(serde_json::Value::as_str)
        .is_some_and(is_actor_kind)
        && ["id", "label", "onBehalfOf"]
            .iter()
            .all(|key| actor.get(*key).is_none_or(serde_json::Value::is_string))
}

/// Defaults for [`with_context_defaults`].
#[derive(Debug, Clone, Default)]
pub struct ContextDefaults {
    /// Clock when the context has none. Default: [`SYSTEM_CLOCK`].
    pub clock: Option<Arc<dyn Clock>>,
    /// Random source when the context has none. Default: [`SYSTEM_RANDOM`].
    pub random: Option<Arc<dyn RandomSource>>,
    /// Actor when the context has none. Default: none (the context keeps no actor).
    pub actor: Option<Actor>,
}

impl ContextDefaults {
    /// No defaults beyond the system clock and random source.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the default clock.
    pub fn with_clock(mut self, clock: impl Clock + 'static) -> Self {
        self.clock = Some(Arc::new(clock));
        self
    }

    /// Set the default random source.
    pub fn with_random(mut self, random: impl RandomSource + 'static) -> Self {
        self.random = Some(Arc::new(random));
        self
    }

    /// Set the default actor.
    pub fn with_actor(mut self, actor: impl Into<Actor>) -> Self {
        self.actor = Some(actor.into());
        self
    }
}

/// `context` with `clock`, `random` and (when given) `actor` filled in where it has none.
/// Values already on the context always win.
pub fn with_context_defaults(
    mut context: CommandContext,
    defaults: &ContextDefaults,
) -> CommandContext {
    // Shared instances, so filling the defaults allocates nothing per call.
    static SYSTEM_CLOCK_ARC: OnceLock<Arc<dyn Clock>> = OnceLock::new();
    static SYSTEM_RANDOM_ARC: OnceLock<Arc<dyn RandomSource>> = OnceLock::new();
    if context.clock.is_none() {
        context.clock = Some(defaults.clock.clone().unwrap_or_else(|| {
            Arc::clone(SYSTEM_CLOCK_ARC.get_or_init(|| Arc::new(SYSTEM_CLOCK)))
        }));
    }
    if context.random.is_none() {
        context.random = Some(defaults.random.clone().unwrap_or_else(|| {
            Arc::clone(SYSTEM_RANDOM_ARC.get_or_init(|| Arc::new(SYSTEM_RANDOM)))
        }));
    }
    if context.actor.is_none() {
        context.actor.clone_from(&defaults.actor);
    }
    context
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::{fixed_clock, seeded_random};
    use serde_json::json;

    #[test]
    fn actor_kinds_round_trip_by_wire_name() {
        let names: Vec<&str> = ACTOR_KINDS.iter().map(|kind| kind.as_str()).collect();
        assert_eq!(names, ["human", "agent", "service", "script", "test"]);
        for kind in ACTOR_KINDS {
            assert_eq!(kind.to_string().parse::<ActorKind>(), Ok(kind));
            assert_eq!(serde_json::to_value(kind).unwrap(), json!(kind.as_str()));
            assert!(is_actor_kind(kind.as_str()));
        }
        assert!(!is_actor_kind("robot"));
        assert!(!is_actor_kind("Agent"));
        assert!("robot".parse::<ActorKind>().unwrap_err().contains("robot"));
    }

    #[test]
    fn actor_serializes_in_camel_case_without_absent_fields() {
        let actor = Actor::new(ActorKind::Agent)
            .with_id("claude")
            .with_label("Claude (advisor)")
            .with_on_behalf_of("user-1");
        let value = serde_json::to_value(&actor).unwrap();
        assert_eq!(
            value,
            json!({"kind": "agent", "id": "claude", "label": "Claude (advisor)", "onBehalfOf": "user-1"})
        );
        assert_eq!(serde_json::from_value::<Actor>(value).unwrap(), actor);
        assert_eq!(
            serde_json::to_value(Actor::from(ActorKind::Test)).unwrap(),
            json!({"kind": "test"})
        );
    }

    #[test]
    fn is_actor_checks_the_shape() {
        assert!(is_actor(&json!({"kind": "human"})));
        assert!(is_actor(
            &json!({"kind": "service", "id": "svc", "onBehalfOf": "u", "extra": 1})
        ));
        assert!(!is_actor(&json!({"kind": "robot"})));
        assert!(!is_actor(&json!({"id": "u"})));
        assert!(!is_actor(&json!({"kind": "human", "id": 7})));
        assert!(!is_actor(&json!({"kind": "human", "label": null})));
        assert!(!is_actor(&json!(["human"])));
        assert!(!is_actor(&json!("human")));
    }

    #[test]
    fn with_context_defaults_fills_only_what_is_missing() {
        let filled = with_context_defaults(CommandContext::new(), &ContextDefaults::new());
        assert!(filled.clock.is_some());
        assert!(filled.random.is_some());
        assert_eq!(filled.actor, None);

        let defaults = ContextDefaults::new()
            .with_clock(fixed_clock(5))
            .with_random(seeded_random("d"))
            .with_actor(ActorKind::Agent);
        let filled = with_context_defaults(CommandContext::new(), &defaults);
        assert_eq!(filled.clock().now(), 5);
        assert_eq!(filled.random().seed(), Some("d"));
        assert_eq!(filled.actor, Some(Actor::new(ActorKind::Agent)));

        let own = CommandContext::new()
            .with_clock(fixed_clock(9))
            .with_random(seeded_random("own"))
            .with_actor(Actor::new(ActorKind::Human).with_id("u1"));
        let kept = with_context_defaults(own, &defaults);
        assert_eq!(kept.clock().now(), 9);
        assert_eq!(kept.random().seed(), Some("own"));
        assert_eq!(kept.actor, Some(Actor::new(ActorKind::Human).with_id("u1")));
    }
}
