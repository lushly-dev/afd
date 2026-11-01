//! Declared context fields (`spec/context-fields.md`): named, schema-validated request values a
//! host declares, such as the project a shell is scoped to or a locale.
//!
//! Declare them with
//! [`CommandRegistry::set_context_fields`](crate::CommandRegistry::set_context_fields). A call
//! carries its value for a field in [`CommandContext::extra`] under the field's
//! [`name`](ContextField::name). [`CommandRegistry::execute`](crate::CommandRegistry::execute)
//! validates it against the field's schema after the input and before the middleware and the
//! handler run, and replaces it with the schema's output (defaults applied, undeclared keys
//! dropped). An invalid value, or a missing required one, fails the call with
//! `VALIDATION_ERROR`, whose `details` name the field and its `_meta` key.
//!
//! A registry's [`JournalRecorder`](crate::JournalRecorder) keeps the value of each field declared
//! [`journal`](ContextField::journal) in the entry's `context` (`spec/journal.md`, "Declared
//! context fields"), and [`replay_journal`](crate::replay_journal) restores it.
//!
//! The MCP server (feature `server`) reads each field's value from a `tools/call`'s
//! `params._meta[meta]`, on both protocol eras, over Streamable HTTP and stdio; a value the
//! context hook sets for the same name wins, and undeclared `_meta` keys are dropped.
//! `server/discover` lists the fields under `_meta["dev.afd/context-fields"]`
//! ([`AFD_CONTEXT_FIELDS_META_KEY`]), and `afd-help` returns them as `contextFields`.
//!
//! A declared field is a claim the caller makes. A handler may use it to narrow what it does
//! (which project, which space), never to grant anything: authorization still comes from the
//! actor and verified credentials.
//!
//! ```rust
//! use afd::context_fields::ContextField;
//! use afd::CommandRegistry;
//! use serde_json::json;
//!
//! let registry = CommandRegistry::new();
//! registry
//!     .set_context_fields([
//!         ContextField::new(
//!             "scope",
//!             "dev.example/scope",
//!             json!({"type": "object", "properties": {"project": {"type": "string"}}, "required": ["project"]}),
//!         )
//!         .with_journal(true),
//!         ContextField::new("locale", "dev.example/locale", json!({"type": "string"})),
//!     ])
//!     .unwrap();
//! ```

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use crate::commands::CommandContext;
use crate::errors::{error_codes, CommandError};

/// The `_meta` key under which `server/discover` lists the declared fields, each as
/// [`ContextField`] serializes.
pub const AFD_CONTEXT_FIELDS_META_KEY: &str = "dev.afd/context-fields";

/// A request value a host declares: where it lands in the context, the `_meta` key a caller
/// sends it in, how it is validated and whether the journal keeps it.
///
/// It serializes as `server/discover` lists a field: `name`, `meta`, `schema`, `required` and
/// `journal`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct ContextField {
    /// The [`CommandContext::extra`] key the value lands under. Not empty, and not a name the
    /// context uses itself (`actor`, `clock`, `traceId`, `trace_id` and the rest).
    pub name: String,
    /// The MCP `_meta` key a caller sends the value in, with a reverse-DNS prefix, such as
    /// `dev.example/scope`. `dev.afd/`, and any prefix with a label `mcp` or
    /// `modelcontextprotocol`, are reserved.
    pub meta: String,
    /// The JSON Schema the value must match, in the subset
    /// [`CommandRegistry::register_with_schema`](crate::CommandRegistry::register_with_schema)
    /// supports.
    pub schema: Value,
    /// Fail a call that has no value (or `null`) for this field. Default `false`. AFD's own
    /// commands (`afd-help`, `afd-docs`, `afd-schema`, `afd-context-*`, the meta-tools) run
    /// without it, so a client can discover the fields first.
    #[serde(default)]
    pub required: bool,
    /// Record the value in the journal. Default `false`: set it only for a field that never
    /// holds a secret.
    #[serde(default)]
    pub journal: bool,
}

impl ContextField {
    /// A field named `name`, sent in `_meta[meta]`, whose value must match `schema`. Neither
    /// required nor journaled.
    pub fn new(name: impl Into<String>, meta: impl Into<String>, schema: Value) -> Self {
        Self {
            name: name.into(),
            meta: meta.into(),
            schema,
            required: false,
            journal: false,
        }
    }

    /// Set [`required`](Self::required).
    pub fn with_required(mut self, required: bool) -> Self {
        self.required = required;
        self
    }

    /// Set [`journal`](Self::journal).
    pub fn with_journal(mut self, journal: bool) -> Self {
        self.journal = journal;
        self
    }
}

/// Context names a declared field cannot take: the names TypeScript's command context uses
/// (`spec/context-fields.md`), [`CommandContext`]'s own fields and accessors, and `timeoutMs`,
/// the name the journal's context digest gives `timeout_ms`.
const RESERVED_NAMES: &[&str] = &[
    "actor",
    "approval",
    "auth",
    "clock",
    "credentials",
    "interface",
    "random",
    "session",
    "signal",
    "source",
    "timeout",
    "traceId",
    "trace_id",
    "timeout_ms",
    "timeoutMs",
    "extra",
    "active_context",
    "context_scope",
    "journal_state",
    "direct_approval",
    "remote",
    "tool_surface",
    "outputBudget",
    "output_budget",
    "output_budget_ask",
];

/// The prefix of AFD's own command names, which do not enforce required fields.
const AFD_COMMAND_PREFIX: &str = "afd-";

/// A reverse-DNS prefix of two or more labels, a slash, then the key's name.
fn meta_key_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        const LABEL: &str = "[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?";
        Regex::new(&format!(
            "^{LABEL}(?:\\.{LABEL})+/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$"
        ))
        .expect("the meta key pattern compiles")
    })
}

/// Check declarations before a registry takes them.
///
/// # Errors
/// A message naming the field for an empty, reserved or repeated name, a `meta` key without a
/// reverse-DNS prefix or with a reserved one, a repeated `meta` key, or a schema this
/// implementation cannot validate.
pub(crate) fn check_context_fields(fields: &[ContextField]) -> Result<(), String> {
    let mut names = HashSet::new();
    let mut meta_keys = HashSet::new();
    for field in fields {
        let ContextField { name, meta, .. } = field;
        if name.is_empty() {
            return Err("A context field needs a non-empty name".to_string());
        }
        if RESERVED_NAMES.contains(&name.as_str()) {
            return Err(format!(
                "Context field '{name}' uses a name AFD sets itself; choose another name"
            ));
        }
        if !names.insert(name.as_str()) {
            return Err(format!("Context field '{name}' is declared twice"));
        }
        if !meta_key_pattern().is_match(meta) {
            return Err(format!(
                "Context field '{name}' needs a meta key with a reverse-DNS prefix, such as 'dev.example/{name}'"
            ));
        }
        let lower = meta.to_ascii_lowercase();
        let prefix = lower.split('/').next().unwrap_or_default();
        if lower.starts_with("dev.afd/")
            || prefix
                .split('.')
                .any(|label| matches!(label, "mcp" | "modelcontextprotocol"))
        {
            return Err(format!(
                "Context field '{name}' uses the reserved meta prefix of '{meta}'; use your own domain"
            ));
        }
        if !meta_keys.insert(meta.as_str()) {
            return Err(format!(
                "Meta key '{meta}' of context field '{name}' is declared twice"
            ));
        }
        crate::schema_validation::compile(&field.schema).map_err(|error| {
            format!("Context field '{name}' has an unsupported schema: {error}")
        })?;
    }
    Ok(())
}

/// Validate a call's declared fields on `context.extra`, in place: each present value is
/// replaced by its schema's output. A JSON `null` counts as no value, like an absent key: it is
/// not validated, and it does not satisfy a required field. AFD's own commands (named `afd-*`:
/// the bootstrap, context and meta-tool commands) do not enforce `required`, so a client can
/// discover the fields first; a value they do get is still validated.
///
/// # Errors
/// A `VALIDATION_ERROR` for the first field, in declaration order, whose value is invalid or
/// that is required and missing.
pub(crate) fn apply_context_fields(
    fields: &[ContextField],
    command: &str,
    context: &mut CommandContext,
) -> Result<(), Box<CommandError>> {
    let enforce_required = !command.starts_with(AFD_COMMAND_PREFIX);
    for field in fields {
        let value = context
            .extra
            .get(&field.name)
            .filter(|value| !value.is_null());
        let Some(value) = value else {
            if field.required && enforce_required {
                return Err(field_failure(
                    field,
                    format!("Context field '{}' is required", field.name),
                    vec![json!({"path": "", "message": "Required"})],
                ));
            }
            continue;
        };
        match crate::schema_validation::validate_value(&field.schema, value) {
            Ok(parsed) => {
                context.extra.insert(field.name.clone(), parsed);
            }
            Err(errors) => {
                return Err(field_failure(
                    field,
                    format!("Context field '{}' is not valid", field.name),
                    errors,
                ))
            }
        }
    }
    Ok(())
}

/// The `VALIDATION_ERROR` for `field`, as TypeScript words it.
fn field_failure(field: &ContextField, message: String, errors: Vec<Value>) -> Box<CommandError> {
    let details = HashMap::from([
        ("field".to_string(), json!(field.name)),
        ("meta".to_string(), json!(field.meta)),
        ("errors".to_string(), Value::Array(errors)),
    ]);
    let ending = if field.required {
        "; it is required"
    } else {
        ", or leave it out"
    };
    Box::new(
        CommandError::new(error_codes::VALIDATION_ERROR, message)
            .with_suggestion(format!(
                "Send '{}' in _meta[\"{}\"] as its schema describes (server/discover lists it under _meta[\"{AFD_CONTEXT_FIELDS_META_KEY}\"]){ending}",
                field.name, field.meta
            ))
            .with_details(details),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope() -> ContextField {
        ContextField::new(
            "scope",
            "dev.example/scope",
            json!({"type": "object", "properties": {"project": {"type": "string"}}, "required": ["project"]}),
        )
        .with_journal(true)
    }

    #[test]
    fn meta_keys_need_a_reverse_dns_prefix() {
        for meta in [
            "dev.example/scope",
            "com.example.tools/scope.v2",
            "a.b/c",
            "Dev.Example-1/x_y-z",
        ] {
            assert!(meta_key_pattern().is_match(meta), "{meta}");
        }
        for meta in [
            "scope",
            "example/scope",
            "dev.example/",
            "dev..example/scope",
            "dev.example-/scope",
            "1dev.example/scope",
            "dev.example/scope/",
            "dev.example/-scope",
            "dev.example/scope\n",
        ] {
            assert!(!meta_key_pattern().is_match(meta), "{meta:?}");
        }
    }

    #[test]
    fn reserved_prefixes_are_refused_case_insensitively() {
        for meta in [
            "dev.afd/scope",
            "DEV.AFD/scope",
            "io.modelcontextprotocol/scope",
            "dev.MCP.tools/scope",
        ] {
            let error = check_context_fields(&[ContextField {
                meta: meta.into(),
                ..scope()
            }])
            .unwrap_err();
            assert!(error.contains("reserved meta prefix"), "{meta}: {error}");
        }
        // A label that only contains `mcp` is not reserved.
        assert!(check_context_fields(&[ContextField {
            meta: "dev.mcpx/scope".into(),
            ..scope()
        }])
        .is_ok());
    }

    #[test]
    fn invalid_values_report_paths_and_messages() {
        let mut context = CommandContext::new().with_extra("scope", json!({"project": 42}));
        let error = apply_context_fields(&[scope()], "scope-echo", &mut context).unwrap_err();
        let details = error.details.unwrap();
        assert_eq!(details["field"], json!("scope"));
        assert_eq!(details["meta"], json!("dev.example/scope"));
        assert_eq!(
            details["errors"],
            json!([{"path": "project", "message": "Invalid input: expected string, received number"}])
        );

        let mut context = CommandContext::new().with_extra("scope", json!("p-1"));
        let error = apply_context_fields(&[scope()], "scope-echo", &mut context).unwrap_err();
        assert_eq!(error.details.unwrap()["errors"][0]["path"], json!(""));
    }
}
