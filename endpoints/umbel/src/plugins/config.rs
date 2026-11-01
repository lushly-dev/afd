//! An instance's configuration against the manifest's configuration schema (load step 3).
//!
//! The schema's `default` values are applied first, then the result is validated; a failure is
//! `PLUGIN_CONFIG_INVALID` naming the instance and the JSON pointer.

use serde_json::{Map, Value};

use super::PluginError;
use super::files::PluginFiles;
use super::manifest::Manifest;

/// The configuration of the instance `instance` with the schema's defaults applied.
///
/// # Errors
/// `PLUGIN_CONFIG_INVALID` when the plugin declares no schema and the table is not empty, or the
/// configuration fails the schema.
pub(crate) fn resolve(
    instance: &str,
    manifest: &Manifest,
    files: &dyn PluginFiles,
    given: &Value,
) -> Result<Value, PluginError> {
    let mut value = if given.is_object() {
        given.clone()
    } else {
        Value::Object(Map::new())
    };
    let Some(declared) = &manifest.config else {
        return if value.as_object().is_some_and(Map::is_empty) {
            Ok(value)
        } else {
            Err(PluginError::config_invalid(
                instance,
                "config",
                "must be empty: the plugin declares no configuration schema",
            ))
        };
    };
    let schema = declared
        .schema
        .load(files)
        .map_err(|problem| PluginError::config_invalid(instance, "config", problem))?;
    apply_defaults(&schema, &mut value);
    validate(instance, &schema, &value)?;
    Ok(value)
}

fn validate(instance: &str, schema: &Value, value: &Value) -> Result<(), PluginError> {
    let validator = jsonschema::validator_for(schema).map_err(|error| {
        PluginError::config_invalid(
            instance,
            "config",
            format!("cannot be checked: the schema is not usable ({error})"),
        )
    })?;
    if let Some(error) = validator.iter_errors(value).next() {
        let pointer = error.instance_path().to_string();
        let key = if pointer.is_empty() {
            "config".to_owned()
        } else {
            format!("config{pointer}")
        };
        return Err(PluginError::config_invalid(instance, &key, error));
    }
    Ok(())
}

/// Insert each property's `default` where the value has none, down through nested objects.
fn apply_defaults(schema: &Value, value: &mut Value) {
    let (Some(properties), Value::Object(map)) =
        (schema.get("properties").and_then(Value::as_object), value)
    else {
        return;
    };
    for (key, sub) in properties {
        if !map.contains_key(key)
            && let Some(default) = sub.get("default")
        {
            map.insert(key.clone(), default.clone());
        }
        if let Some(inner) = map.get_mut(key) {
            apply_defaults(sub, inner);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_fill_missing_keys_down_the_tree() {
        let schema = json!({
            "type": "object",
            "properties": {
                "a": { "type": "string", "default": "x" },
                "inner": {
                    "type": "object",
                    "properties": { "b": { "type": "integer", "default": 2 } }
                }
            }
        });
        let mut value = json!({ "inner": {} });
        apply_defaults(&schema, &mut value);
        assert_eq!(value, json!({ "a": "x", "inner": { "b": 2 } }));
        let mut given = json!({ "a": "kept" });
        apply_defaults(&schema, &mut given);
        assert_eq!(given["a"], "kept");
    }
}
