//! Where a call's idempotency key came from, as every entry point decides it (K1 to K6).
//!
//! A key reaches the engine on [`CommandContext::idempotency_key`]. The engine takes it:
//! - as no key when it is absent, or when it equals the key the engine delivered to the handler
//!   of the call this one is nested in (K6), marked on that handler's context;
//! - as it is when the engine set it itself, a derived key (K4) or one restored from a journal,
//!   which fail K2's form;
//! - as a caller's key when it has K2's form, and otherwise refuses the call.
//!
//! The marks are crate-private fields of the context, so code outside the crate cannot set a key
//! as the engine's. A key marked as the engine's still scopes only its caller's own calls (K5).

use super::{derive_idempotency_key, is_idempotency_key, IdempotencyRequestKind};
use crate::commands::CommandContext;

/// Who set the key a context carries, when the crate set it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) enum KeyMark {
    /// No mark: a key on the context is a caller's.
    #[default]
    None,
    /// The engine delivered this key to a handler (K3). A call made on that context, or a copy
    /// of it, starts without it (K6).
    Delivered(String),
    /// The engine chose this key: derived (K4) or restored from a journal entry.
    Engine(String),
}

/// The key a call carries, as the engine decides it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CallKey {
    None,
    Key { key: String, by_engine: bool },
    Invalid,
}

impl CallKey {
    /// The key, when there is one.
    pub(crate) fn key(&self) -> Option<&str> {
        match self {
            Self::Key { key, .. } => Some(key),
            Self::None | Self::Invalid => None,
        }
    }
}

/// The key `context` carries, decided as the module comment says.
pub(crate) fn resolve(context: &CommandContext) -> CallKey {
    let Some(raw) = context.idempotency_key.as_deref() else {
        return CallKey::None;
    };
    match &context.idempotency_mark {
        KeyMark::Delivered(key) if key == raw => CallKey::None,
        KeyMark::Engine(key) if key == raw => CallKey::Key {
            key: raw.to_owned(),
            by_engine: true,
        },
        _ if is_idempotency_key(raw) => CallKey::Key {
            key: raw.to_owned(),
            by_engine: false,
        },
        _ => CallKey::Invalid,
    }
}

/// Put the call's key on `context`, the context its middleware and handler share (K3), and mark
/// it delivered, so a call the handler makes on it starts without it (K6).
pub(crate) fn deliver(context: &mut CommandContext, key: &CallKey) {
    match key.key() {
        Some(key) => {
            context.idempotency_key = Some(key.to_owned());
            context.idempotency_mark = KeyMark::Delivered(key.to_owned());
        }
        None => {
            context.idempotency_key = None;
            context.idempotency_mark = KeyMark::None;
        }
    }
}

/// `context` carrying `key` as a key the engine chose (derived or restored), or no key.
pub(crate) fn with_engine_key(mut context: CommandContext, key: Option<String>) -> CommandContext {
    context.idempotency_mark = key.clone().map_or(KeyMark::None, KeyMark::Engine);
    context.idempotency_key = key;
    context
}

/// The context of a batch or pipeline request, with its key decided as a call's would be: as it
/// is when it carries no key; without a key it inherited (K6); unchanged with an invalid one, so
/// each item fails K2 at the engine.
pub(crate) fn request_context(context: CommandContext) -> CommandContext {
    if context.idempotency_key.is_none() && context.idempotency_mark == KeyMark::None {
        return context;
    }
    match resolve(&context) {
        CallKey::Invalid => context,
        CallKey::None => with_engine_key(context, None),
        CallKey::Key { key, by_engine } => {
            if by_engine {
                with_engine_key(context, Some(key))
            } else {
                let mut context = context;
                context.idempotency_mark = KeyMark::None;
                context
            }
        }
    }
}

/// The context of the item or step at `index` of a batch or pipeline whose request ran on
/// `context`: under the key derived from the request's (K4), without one when the request had
/// none or inherited it (K6), and unchanged with an invalid one, so the item fails K2.
pub(crate) fn derived_context(
    context: CommandContext,
    kind: IdempotencyRequestKind,
    index: usize,
) -> CommandContext {
    match resolve(&context) {
        CallKey::Invalid => context,
        CallKey::None if context.idempotency_key.is_none() => context,
        CallKey::None => with_engine_key(context, None),
        CallKey::Key { key, .. } => {
            let derived = derive_idempotency_key(&key, kind, index);
            with_engine_key(context, Some(derived))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_resolve_as_the_module_says() {
        let caller = CommandContext::new().with_idempotency_key("k1");
        assert_eq!(
            resolve(&caller),
            CallKey::Key {
                key: "k1".into(),
                by_engine: false
            }
        );
        assert_eq!(
            resolve(&CommandContext::new().with_idempotency_key("k1:0")),
            CallKey::Invalid
        );
        // A derived key is the engine's, and passes as it is.
        let item = derived_context(caller.clone(), IdempotencyRequestKind::Batch, 1);
        assert_eq!(
            resolve(&item),
            CallKey::Key {
                key: "k1:1".into(),
                by_engine: true
            }
        );
        // A delivered key is not a nested call's.
        let mut handler = caller;
        let key = resolve(&handler);
        deliver(&mut handler, &key);
        assert_eq!(handler.idempotency_key.as_deref(), Some("k1"));
        assert_eq!(resolve(&handler), CallKey::None);
        let nested_batch = request_context(handler.clone());
        assert_eq!(nested_batch.idempotency_key, None);
        // A key the handler sets of its own is a caller's again, checked by K2.
        let own = handler.with_idempotency_key("k2");
        assert_eq!(
            resolve(&own),
            CallKey::Key {
                key: "k2".into(),
                by_engine: false
            }
        );
    }
}
