//! How a verified caller's calls are authorised until phase 5 step 3 builds the scope resolver
//! and gate of section 5 (amendment from step 2b).
//!
//! Section 5.2 derives a call's needs from its spaces, and owner decision 2 narrows a caller's
//! reader filter to the spaces its token grants a verb in. Both need step 3's resolver and its
//! `Caller` in `reader_filter`. Until then this resolver decides every call on the scopes it can
//! decide without them, **the unqualified ones**, and leaves the space-qualified ones unused:
//!
//! - every call needs `<prefix>:read` (implied by any unqualified verb, 5.1);
//! - a mutating command (`plugin-state`, `store-write`, `workspace-write` or `external`; AFD's
//!   `mutation`) also needs `<prefix>:write`;
//! - a command with an approval policy, or confirmed by the host (`confirmationMode`), also
//!   needs `<prefix>:approve`;
//! - `memory-erase`, and any command whose name ends in `-erase`, also needs `<prefix>:erase`;
//! - a command's static `scopes` (AFD's rule) are needed too.
//!
//! An unqualified verb grants that verb in every space (5.1), so a token this resolver admits
//! is one whose narrowing would leave every readable space readable: the reader filter is the
//! person's, as section 5.3 makes it. A token holding only space-qualified scopes is refused
//! with HTTP 403 and `INSUFFICIENT_SCOPE` naming the unqualified scopes, never a space. That is
//! stricter than section 5.2 and never wider; step 3 replaces this resolver.

use std::sync::Arc;

use afd::server::auth::{ScopeDecision, ScopeResolver};
use afd::{CommandRegistry, Credentials};
use serde_json::Value;

use super::{Scope, ScopeVerb};

/// The interim resolver of mode `oauth`.
pub(crate) struct InterimScopes {
    prefix: String,
    registry: Arc<CommandRegistry>,
}

impl InterimScopes {
    /// A resolver for scopes under `prefix`, over `registry`'s commands.
    pub(crate) fn new(prefix: &str, registry: Arc<CommandRegistry>) -> Self {
        Self {
            prefix: prefix.to_owned(),
            registry,
        }
    }

    /// The scopes a call of `command` needs, in the order of 5.1's verbs, then its static ones.
    fn needs(&self, command: &str) -> Vec<String> {
        let mut verbs = vec![ScopeVerb::Read];
        let mut fixed = Vec::new();
        if let Some(definition) = self
            .registry
            .get(command)
            .filter(|definition| definition.expose.mcp)
        {
            if definition.mutation {
                verbs.push(ScopeVerb::Write);
            }
            if definition.approval.is_some() || definition.confirmation_mode.is_some() {
                verbs.push(ScopeVerb::Approve);
            }
            // Any command named like an erase, whatever its instance prefix, until step 10 gives
            // erasing a property of its own.
            if command == "memory-erase" || command.ends_with("-erase") {
                verbs.push(ScopeVerb::Erase);
            }
            fixed = definition.scopes.clone().unwrap_or_default();
        }
        let mut needs: Vec<String> = verbs
            .into_iter()
            .map(|verb| Scope { verb, space: None }.to_scope_string(&self.prefix))
            .collect();
        for scope in fixed {
            if !needs.contains(&scope) {
                needs.push(scope);
            }
        }
        needs
    }

    /// Whether `held` grants `need`: an unqualified Umbel scope that implies it, or (a static
    /// scope) the same string.
    fn grants(&self, held: &[String], need: &str) -> bool {
        match Scope::parse(&self.prefix, need) {
            Some(need) => held.iter().any(|scope| {
                Scope::parse(&self.prefix, scope)
                    .is_some_and(|scope| scope.space.is_none() && scope.implies(&need))
            }),
            None => held.iter().any(|scope| scope == need),
        }
    }
}

impl ScopeResolver for InterimScopes {
    fn resolve(&self, command: &str, _input: &Value, credentials: &Credentials) -> ScopeDecision {
        let missing: Vec<String> = self
            .needs(command)
            .into_iter()
            .filter(|need| !self.grants(&credentials.scopes, need))
            .collect();
        if missing.is_empty() {
            ScopeDecision::Allowed
        } else {
            ScopeDecision::Missing(missing)
        }
    }

    fn visible(&self, command: &str, credentials: &Credentials) -> bool {
        self.resolve(command, &Value::Null, credentials) == ScopeDecision::Allowed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use afd::{CommandContext, CommandDefinition, CommandHandler, CommandResult, ExposeOptions};

    struct Nothing;

    #[async_trait::async_trait]
    impl CommandHandler for Nothing {
        async fn execute(&self, _input: Value, _context: CommandContext) -> CommandResult<Value> {
            afd::success(Value::Null)
        }
    }

    fn registry() -> Arc<CommandRegistry> {
        let registry = CommandRegistry::new();
        let exposed = ExposeOptions {
            mcp: true,
            ..ExposeOptions::default()
        };
        let mut read = CommandDefinition::new("doc-read", "Read.", vec![], Nothing);
        read.expose = exposed.clone();
        let mut write = CommandDefinition::new("doc-write", "Write.", vec![], Nothing);
        write.expose = exposed.clone();
        write.mutation = true;
        let mut erase = CommandDefinition::new("notes-erase", "Erase.", vec![], Nothing);
        erase.expose = exposed.clone();
        erase.mutation = true;
        let mut hidden = CommandDefinition::new("doc-hidden", "Hidden.", vec![], Nothing);
        hidden.mutation = true;
        for command in [read, write, erase, hidden] {
            registry.register(command).unwrap();
        }
        Arc::new(registry)
    }

    fn credentials(scopes: &[&str]) -> Credentials {
        Credentials::new(
            "https://as.example.com",
            "u",
            "c",
            "https://r.example.com/mcp",
            1,
            2,
        )
        .with_scopes(scopes.iter().copied())
    }

    #[test]
    fn only_unqualified_scopes_grant_until_step_3() {
        let resolver = InterimScopes::new("umbel", registry());
        let decide = |command: &str, scopes: &[&str]| {
            resolver.resolve(command, &Value::Null, &credentials(scopes))
        };
        assert_eq!(decide("doc-read", &["umbel:read"]), ScopeDecision::Allowed);
        assert_eq!(
            decide("doc-read", &["umbel:approve"]),
            ScopeDecision::Allowed
        );
        assert_eq!(
            decide("doc-write", &["umbel:write"]),
            ScopeDecision::Allowed
        );
        assert_eq!(
            decide("doc-write", &["umbel:read"]),
            ScopeDecision::Missing(vec!["umbel:write".into()])
        );
        // A space-qualified scope grants nothing yet, and the refusal names no space.
        assert_eq!(
            decide("doc-read", &["umbel:read:alpha", "umbel:write:alpha"]),
            ScopeDecision::Missing(vec!["umbel:read".into()])
        );
        assert_eq!(
            decide("doc-write", &["other:write", "umbel:writes"]),
            ScopeDecision::Missing(vec!["umbel:read".into(), "umbel:write".into()])
        );
        // Unknown and unexposed names, and meta-tools, need read alone.
        for name in ["afd-discover", "nothing-here", "doc-hidden"] {
            assert_eq!(
                decide(name, &["umbel:read"]),
                ScopeDecision::Allowed,
                "{name}"
            );
            assert_eq!(
                decide(name, &[]),
                ScopeDecision::Missing(vec!["umbel:read".into()]),
                "{name}"
            );
        }
        // Erasing needs `erase`, whatever the command's prefix.
        assert_eq!(
            decide("notes-erase", &["umbel:write"]),
            ScopeDecision::Missing(vec!["umbel:erase".into()])
        );
        assert!(resolver.visible("doc-write", &credentials(&["umbel:write"])));
        assert!(!resolver.visible("doc-write", &credentials(&["umbel:read"])));
    }
}
