//! The ARIA snapshot of the mount root from Chromium's own accessibility tree
//! (`Accessibility.getFullAXTree`), written in the indented YAML form of Playwright's ARIA
//! snapshots: `- role "name" [state]`, with text as `- text:` lines.
//!
//! Ignored nodes, `generic`, `none` and `presentation` nodes and Chromium's internal roles
//! (`LabelText` and the like) are flattened into their parent. Adjacent text joins into one
//! line. A child list that is only text is written inline, or omitted when it repeats the
//! name. Text fields show their value instead of their editor's contents. States are
//! Playwright's: checked, disabled, expanded, level, pressed and selected.

use serde_json::Value;
use std::collections::HashMap;

const FLATTENED: &[&str] = &["generic", "none", "presentation"];
const VALUED: &[&str] = &["textbox", "searchbox", "combobox", "spinbutton", "slider"];

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|entry| entry.get("value"))
        .map_or(String::new(), |entry| match entry {
            Value::String(text) => text.clone(),
            Value::Null => String::new(),
            other => other.to_string(),
        })
}

fn normalize(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn states(node: &Value) -> Vec<String> {
    let mut states = Vec::new();
    let properties = node
        .get("properties")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for property in properties {
        let name = property.get("name").and_then(Value::as_str).unwrap_or("");
        let value = property.get("value").and_then(|entry| entry.get("value"));
        let flag = |label: &str| match value {
            Some(Value::Bool(true)) => Some(label.to_string()),
            Some(Value::String(state)) if state == "true" => Some(label.to_string()),
            Some(Value::String(state)) if state == "mixed" => Some(format!("{label}=mixed")),
            _ => None,
        };
        let state = match name {
            "checked" | "pressed" | "selected" | "expanded" | "disabled" => flag(name),
            "level" => value
                .and_then(Value::as_i64)
                .map(|level| format!("level={level}")),
            _ => None,
        };
        states.extend(state);
    }
    states.sort();
    states
}

/// Playwright's rule for when a YAML key or scalar must be quoted to read back as itself.
fn needs_quotes(text: &str) -> bool {
    let first = text.chars().next();
    let mut chars = text.chars().peekable();
    let mut colon_or_newline_then_space = false;
    let mut space_then_hash = false;
    while let Some(c) = chars.next() {
        let next = chars.peek().copied();
        if matches!(c, ':' | '\n') && next.is_none_or(char::is_whitespace) {
            colon_or_newline_then_space = true;
        }
        if c.is_whitespace() && next == Some('#') {
            space_then_hash = true;
        }
    }
    text.is_empty()
        || text.starts_with(char::is_whitespace)
        || text.ends_with(char::is_whitespace)
        || text
            .chars()
            .any(|c| matches!(c as u32, 0x00..=0x08 | 0x0b | 0x0c | 0x0e..=0x1f | 0x7f..=0x9f))
        || text.starts_with('-')
        || colon_or_newline_then_space
        || space_then_hash
        || text.contains(['\n', '\r'])
        || first.is_some_and(|c| "&*],?!>|@\"'#%[".contains(c))
        || text.contains(['{', '}', '`'])
        || js_numeric(text)
        || matches!(
            text.to_lowercase().as_str(),
            "y" | "n" | "yes" | "no" | "true" | "false" | "on" | "off" | "null"
        )
}

/// Whether JavaScript's `Number(text)` is a number rather than `NaN`.
fn js_numeric(text: &str) -> bool {
    let text = text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    if text.is_empty() {
        return true;
    }
    for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] {
        let lower = text.get(..2).map(str::to_ascii_lowercase);
        if lower.as_deref() == Some(prefix) {
            let digits = &text[2..];
            return !digits.is_empty() && digits.chars().all(|c| c.is_digit(radix));
        }
    }
    let unsigned = text.strip_prefix(['+', '-']).unwrap_or(text);
    if unsigned == "Infinity" {
        return true;
    }
    let bytes = unsigned.as_bytes();
    let (mut index, mut digits) = (0, 0);
    let digit = |index: usize| bytes.get(index).is_some_and(u8::is_ascii_digit);
    while digit(index) {
        index += 1;
        digits += 1;
    }
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        while digit(index) {
            index += 1;
            digits += 1;
        }
    }
    if digits == 0 {
        return false;
    }
    if matches!(bytes.get(index), Some(b'e' | b'E')) {
        index += 1;
        if matches!(bytes.get(index), Some(b'+' | b'-')) {
            index += 1;
        }
        let start = index;
        while digit(index) {
            index += 1;
        }
        if index == start {
            return false;
        }
    }
    index == bytes.len()
}

/// A scalar value, double-quoted with Playwright's escapes when it needs quotes.
fn scalar(text: &str) -> String {
    if !needs_quotes(text) {
        return text.to_string();
    }
    let mut quoted = String::from("\"");
    for c in text.chars() {
        match c {
            '\\' => quoted.push_str("\\\\"),
            '"' => quoted.push_str("\\\""),
            '\u{8}' => quoted.push_str("\\b"),
            '\u{c}' => quoted.push_str("\\f"),
            '\n' => quoted.push_str("\\n"),
            '\r' => quoted.push_str("\\r"),
            '\t' => quoted.push_str("\\t"),
            c if matches!(c as u32, 0x00..=0x1f | 0x7f..=0x9f) => {
                quoted.push_str(&format!("\\x{:02x}", c as u32));
            }
            c => quoted.push(c),
        }
    }
    quoted.push('"');
    quoted
}

/// A mapping key, single-quoted when it needs quotes.
fn key(text: &str) -> String {
    if needs_quotes(text) {
        format!("'{}'", text.replace('\'', "''"))
    } else {
        text.to_string()
    }
}

/// One rendered child of a node: a run of text, or an element's lines.
enum Item {
    Text(String),
    Element(Vec<String>),
}

fn children_of<'a>(nodes: &'a HashMap<String, Value>, node: &Value) -> Vec<&'a Value> {
    node.get("childIds")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|child| nodes.get(child.as_str()?))
        .collect()
}

fn collect(nodes: &HashMap<String, Value>, node: &Value, items: &mut Vec<Item>) {
    let role = text(node, "role");
    let internal = node.pointer("/role/type").and_then(Value::as_str) == Some("internalRole");
    if role == "StaticText" {
        let content = normalize(&text(node, "name"));
        if content.is_empty() {
            return;
        }
        match items.last_mut() {
            Some(Item::Text(previous)) => {
                previous.push(' ');
                previous.push_str(&content);
            }
            _ => items.push(Item::Text(content)),
        }
        return;
    }
    let ignored = node
        .get("ignored")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if ignored || internal || FLATTENED.contains(&role.as_str()) {
        for child in children_of(nodes, node) {
            collect(nodes, child, items);
        }
        return;
    }
    items.push(Item::Element(element(nodes, node, &role)));
}

fn element(nodes: &HashMap<String, Value>, node: &Value, role: &str) -> Vec<String> {
    let name = normalize(&text(node, "name"));
    let mut line = role.to_string();
    // Playwright omits names longer than 900 UTF-16 code units.
    if !name.is_empty() && name.encode_utf16().count() <= 900 {
        line.push(' ');
        line.push_str(&serde_json::to_string(&name).unwrap_or_default());
    }
    for state in states(node) {
        line.push_str(&format!(" [{state}]"));
    }
    if VALUED.contains(&role) {
        let value = normalize(&text(node, "value"));
        return vec![if value.is_empty() {
            format!("- {line}")
        } else {
            format!("- {}: {}", key(&line), scalar(&value))
        }];
    }
    let mut items = Vec::new();
    for child in children_of(nodes, node) {
        collect(nodes, child, &mut items);
    }
    match items.as_slice() {
        [] => vec![format!("- {line}")],
        [Item::Text(content)] if *content == name => vec![format!("- {line}")],
        [Item::Text(content)] => vec![format!("- {}: {}", key(&line), scalar(content))],
        _ => {
            let mut lines = vec![format!("- {}:", key(&line))];
            for item in items {
                match item {
                    Item::Text(content) => lines.push(format!("  - text: {}", scalar(&content))),
                    Item::Element(nested) => {
                        lines.extend(nested.into_iter().map(|nested| format!("  {nested}")))
                    }
                }
            }
            lines
        }
    }
}

/// The snapshot of the subtree rooted at the DOM node whose backend id is `root_backend_id`.
pub fn snapshot(tree: &Value, root_backend_id: i64) -> String {
    let nodes: HashMap<String, Value> = tree
        .get("nodes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|node| Some((node.get("nodeId")?.as_str()?.to_string(), node.clone())))
        .collect();
    let Some(root) = nodes
        .values()
        .find(|node| node.get("backendDOMNodeId").and_then(Value::as_i64) == Some(root_backend_id))
    else {
        return String::new();
    };
    let mut items = Vec::new();
    collect(&nodes, root, &mut items);
    let mut lines = Vec::new();
    for item in items {
        match item {
            Item::Text(content) => lines.push(format!("- text: {}", scalar(&content))),
            Item::Element(element) => lines.extend(element),
        }
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::snapshot;
    use serde_json::json;

    fn node(id: &str, role: &str, extra: serde_json::Value) -> serde_json::Value {
        let kind = if role.chars().next().is_some_and(char::is_uppercase) {
            "internalRole"
        } else {
            "role"
        };
        let mut node =
            json!({ "nodeId": id, "ignored": false, "role": { "type": kind, "value": role } });
        for (key, value) in extra.as_object().unwrap() {
            node[key] = value.clone();
        }
        node
    }

    #[test]
    fn flattens_containers_and_writes_roles_names_states_and_text() {
        let tree = json!({ "nodes": [
            node("1", "main", json!({ "backendDOMNodeId": 10, "childIds": ["2", "6", "8", "11"] })),
            node("2", "generic", json!({ "childIds": ["3"] })),
            node("3", "button", json!({ "name": { "value": "Save" }, "childIds": ["4"],
                "properties": [{ "name": "pressed", "value": { "type": "tristate", "value": "true" } }] })),
            node("4", "StaticText", json!({ "name": { "value": "Save" }, "childIds": ["5"] })),
            node("5", "InlineTextBox", json!({ "name": { "value": "Save" } })),
            node("6", "LabelText", json!({ "childIds": ["7"] })),
            node("7", "StaticText", json!({ "name": { "value": "Account   name" } })),
            node("8", "textbox", json!({ "name": { "value": "Account" }, "value": { "value": "frame-value" }, "childIds": ["9"] })),
            node("9", "generic", json!({ "childIds": ["10"] })),
            node("10", "StaticText", json!({ "name": { "value": "frame-value" } })),
            node("11", "status", json!({ "childIds": ["12", "14"] })),
            node("12", "paragraph", json!({ "childIds": ["13"] })),
            node("13", "StaticText", json!({ "name": { "value": "Paused: rain" } })),
            node("14", "heading", json!({ "name": { "value": "Soon" }, "childIds": ["15"],
                "properties": [{ "name": "level", "value": { "type": "integer", "value": 2 } }] })),
            node("15", "StaticText", json!({ "name": { "value": "Soon" } })),
        ]});
        assert_eq!(
            snapshot(&tree, 10),
            [
                "- main:",
                "  - button \"Save\" [pressed]",
                "  - text: Account name",
                "  - textbox \"Account\": frame-value",
                "  - status:",
                "    - paragraph: \"Paused: rain\"",
                "    - heading \"Soon\" [level=2]",
            ]
            .join("\n")
        );
    }

    #[test]
    fn quotes_keys_and_values_yaml_would_misread() {
        let tree = json!({ "nodes": [
            node("1", "main", json!({ "backendDOMNodeId": 10, "childIds": ["2", "4"] })),
            node("2", "image", json!({ "name": { "value": "Current plan: Garden" }, "childIds": ["3"] })),
            node("3", "StaticText", json!({ "name": { "value": "GARDEN" } })),
            node("4", "paragraph", json!({ "childIds": ["5"] })),
            node("5", "StaticText", json!({ "name": { "value": "42" } })),
        ]});
        assert_eq!(
            snapshot(&tree, 10),
            "- main:\n  - 'image \"Current plan: Garden\"': GARDEN\n  - paragraph: \"42\""
        );
    }

    #[test]
    fn quotes_what_javascript_reads_as_a_number_and_escapes_controls() {
        use super::scalar;
        for text in ["0x1F", "0o7", "0b1", "1e3", ".5", "-2", "Infinity", "  "] {
            assert!(scalar(text).starts_with('"'), "{text}");
        }
        for text in ["infinity", "1e", "0x", "abc", "a:b"] {
            assert_eq!(scalar(text), text);
        }
        assert_eq!(scalar("a: b"), "\"a: b\"");
        assert_eq!(scalar("a\tb #c"), "\"a\\tb #c\"");
        assert_eq!(scalar("x\u{85}"), "\"x\\x85\"");
    }

    #[test]
    fn ignored_nodes_are_flattened_and_a_missing_root_is_empty() {
        let tree = json!({ "nodes": [
            node("1", "main", json!({ "backendDOMNodeId": 10, "childIds": ["2"] })),
            json!({ "nodeId": "2", "ignored": true, "role": { "type": "role", "value": "none" }, "childIds": ["3"] }),
            node("3", "StaticText", json!({ "name": { "value": "only" } })),
        ]});
        assert_eq!(snapshot(&tree, 10), "- main: only");
        assert_eq!(snapshot(&tree, 11), "");
    }
}
