//! `plugin-check`: validate a plugin directory without enabling it (specification section 10.3).
//!
//! It reads the directory and, for `boot`, seals an internal host over a temporary workspace that
//! it removes afterwards; it changes nothing else. A mount's program runs only with
//! `spawn=true`.

use super::{Builtin, blocking, returns_object, validation_error};
use crate::doctor::CheckStatus;
use crate::plugins::{CompiledPlugin, check_plugin};
use afd::{
    CommandContext, CommandDefinition, CommandError, CommandHandler, CommandResult, ExposeOptions,
    ResultOptions, Warning, failure, success_with,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

struct Handler {
    compiled: Vec<Arc<dyn CompiledPlugin>>,
}

#[async_trait]
impl CommandHandler for Handler {
    async fn execute(&self, input: Value, _context: CommandContext) -> CommandResult<Value> {
        let Some(path) = input
            .get("path")
            .and_then(Value::as_str)
            .filter(|path| !path.is_empty())
        else {
            return failure(validation_error(
                "path is required".to_owned(),
                "Pass path=<dir>: the plugin directory that holds umbel-plugin.toml.",
            ));
        };
        let path = PathBuf::from(path);
        let spawn = input.get("spawn").and_then(Value::as_bool).unwrap_or(false);
        let compiled = self.compiled.clone();
        let checked = match blocking(move || Ok(check_plugin(&path, spawn, &compiled))).await {
            Ok(checked) => checked,
            Err(error) => return failure(error),
        };
        let data = checked.data();
        if let Some(failed) = checked
            .checks
            .iter()
            .find(|check| check.status == CheckStatus::Fail)
        {
            let details: HashMap<String, Value> = match &data {
                Value::Object(map) => map.clone().into_iter().collect(),
                _ => HashMap::new(),
            };
            return failure(
                CommandError::new(
                    "PLUGIN_CHECK_FAILED",
                    format!(
                        "The plugin failed its check: {} ({})",
                        failed.message, failed.id
                    ),
                )
                .with_suggestion(failed.suggestion.clone().unwrap_or_default())
                .with_retryable(false)
                .with_details(details),
            );
        }
        let warnings: Vec<Warning> = checked
            .checks
            .iter()
            .filter(|check| check.status == CheckStatus::Warn)
            .map(|check| {
                Warning::new(
                    format!("PLUGIN_CHECK_{}", check.id.to_uppercase()),
                    &check.message,
                )
            })
            .collect();
        let mut options = ResultOptions::default();
        if !warnings.is_empty() {
            options.warnings = Some(warnings);
        }
        success_with(data, options)
    }
}

/// `plugin-check`: reads files and may start a mount's program, so only the CLI reaches it.
pub(crate) fn plugin_check(compiled: Vec<Arc<dyn CompiledPlugin>>) -> Builtin {
    let definition = CommandDefinition::new(
        "plugin-check",
        "Validate a plugin directory without enabling it: manifest, grants, schemas, packs, skills, configuration, a component's imports, and a boot of an internal host with only this plugin; a mount's server starts only with spawn=true",
        vec![],
        Handler { compiled },
    )
    .with_category("plugins")
    .with_returns(returns_object(
        "plugin, kind, healthy and checks (id, status pass|warn|fail|skip, message, suggestion)",
    ))
    .with_expose(
        ExposeOptions::new()
            .with_palette(false)
            .with_mcp(false)
            .with_agent(false)
            .with_cli(true),
    );
    Builtin {
        definition,
        schema: json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "The plugin directory, the one that holds umbel-plugin.toml"
                },
                "spawn": {
                    "type": "boolean",
                    "description": "Start a mounted plugin's server to list its tools; this runs the plugin's own program. Default false"
                },
            },
            "required": ["path"],
            "additionalProperties": false,
        }),
    }
}
