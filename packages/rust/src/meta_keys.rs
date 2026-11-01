//! The `_meta` key rule (`spec/mcp-resources.md`, T2): which extra keys a command's tool, a
//! resource entry and a resource read's content item may carry.
//!
//! An extra key is allowed when it is either a prefixed key in MCP's `_meta` key format with a
//! prefix of two or more labels (`dev.umbel/origin`, `com.example/flags`) outside `dev.afd/` and
//! outside the prefixes MCP reserves, or exactly `ui`, the MCP Apps key. Every other key is
//! refused, so an extra entry can never replace an entry the server sets itself.

use serde_json::Value;

/// The MCP Apps key. Its value must be an object, and a `resourceUri` in it a `ui://` string.
pub const MCP_APPS_META_KEY: &str = "ui";

/// The prefix that is AFD's alone (`dev.afd/context`, `dev.afd/digest`, ...).
const AFD_PREFIX: &str = "dev.afd/";

/// Whether `label` is one prefix label: a letter, then letters, digits and `-`, ending in a
/// letter or digit.
fn is_label(label: &str) -> bool {
    let bytes = label.as_bytes();
    let (Some(first), Some(last)) = (bytes.first(), bytes.last()) else {
        return false;
    };
    first.is_ascii_alphabetic()
        && last.is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
}

/// Whether `name` is a key name: begins and ends with a letter or digit, with only letters,
/// digits, `-`, `_` and `.` between.
fn is_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    let (Some(first), Some(last)) = (bytes.first(), bytes.last()) else {
        return false;
    };
    first.is_ascii_alphanumeric()
        && last.is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

/// Check one extra `_meta` entry against the key rule.
///
/// `allow_ui` is `true` for a command's tool and a read's content item, and `false` for a
/// resource entry (`ui` is not allowed on a listed resource).
///
/// # Errors
/// The reason the entry is refused, naming the key.
pub fn check_meta_entry(key: &str, value: &Value, allow_ui: bool) -> Result<(), String> {
    if key == MCP_APPS_META_KEY {
        if !allow_ui {
            return Err(format!(
                "_meta key \"{key}\" is not allowed here (the MCP Apps key belongs on a tool or a read's content item)"
            ));
        }
        let Some(ui) = value.as_object() else {
            return Err(format!("_meta key \"{key}\" must hold an object"));
        };
        return match ui.get("resourceUri") {
            None => Ok(()),
            Some(Value::String(uri)) if uri.starts_with("ui://") => Ok(()),
            Some(_) => Err(format!(
                "_meta key \"{key}\": resourceUri must be a string beginning ui://"
            )),
        };
    }
    let Some((prefix, name)) = key.split_once('/') else {
        return Err(format!(
            "_meta key \"{key}\" must be a prefixed key such as dev.example/name, or \"{MCP_APPS_META_KEY}\""
        ));
    };
    let labels: Vec<&str> = prefix.split('.').collect();
    if labels.len() < 2 || !labels.iter().all(|label| is_label(label)) || !is_name(name) {
        return Err(format!(
            "_meta key \"{key}\" is not in MCP's key format with a prefix of two or more labels (such as dev.example/name)"
        ));
    }
    // Reserved prefixes are compared without regard to case, which only widens the refusal.
    if key.to_ascii_lowercase().starts_with(AFD_PREFIX) {
        return Err(format!(
            "_meta key \"{key}\" is under the reserved prefix {AFD_PREFIX}"
        ));
    }
    let second = labels[1].to_ascii_lowercase();
    if second == "modelcontextprotocol" || second == "mcp" {
        return Err(format!(
            "_meta key \"{key}\" is under a prefix MCP reserves (second label modelcontextprotocol or mcp)"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn accepts_prefixed_keys_with_two_or_more_labels() {
        for key in [
            "dev.umbel/origin",
            "com.example/flags",
            "com.example.mcp/x",
            "org.example-co/v2.name_x",
        ] {
            assert_eq!(check_meta_entry(key, &json!(1), false), Ok(()), "{key}");
        }
    }

    #[test]
    fn refuses_reserved_unprefixed_and_malformed_keys() {
        for key in [
            "origin",
            "approval",
            "category",
            "ui/resourceUri",
            "dev.afd/context",
            "dev.afd/digest",
            "DEV.AFD/x",
            "io.modelcontextprotocol/ui",
            "dev.mcp/x",
            "com.modelcontextprotocol.api/x",
            "progressToken",
            "traceparent",
            "example/x",
            "1com.example/x",
            "com.example-/x",
            "com.example/",
            "com.example/-x",
            "com.example/x y",
            "com..example/x",
            "",
        ] {
            let error = check_meta_entry(key, &json!(1), true).unwrap_err();
            assert!(error.contains(&format!("\"{key}\"")), "{key}: {error}");
        }
    }

    #[test]
    fn ui_needs_an_object_and_a_ui_resource_uri() {
        let ok = |value: Value| check_meta_entry("ui", &value, true);
        assert_eq!(ok(json!({})), Ok(()));
        assert_eq!(ok(json!({ "resourceUri": "ui://a/b.html" })), Ok(()));
        assert_eq!(
            ok(json!({ "resourceUri": "ui://a/b.html", "visibility": ["app"] })),
            Ok(())
        );
        assert!(ok(json!({ "resourceUri": "https://a/b.html" })).is_err());
        assert!(ok(json!({ "resourceUri": 3 })).is_err());
        assert!(ok(json!("ui://a/b.html")).is_err());
        assert!(check_meta_entry("ui", &json!({}), false).is_err());
    }
}
