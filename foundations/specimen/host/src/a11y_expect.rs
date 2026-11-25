//! Portable `a11y` expectation evaluator for scenario steps (`spec.md` §3.2).

use crate::aria::{AccessibleStates, InvalidState, TriState};
use crate::page::normalize_name;
use serde_json::{Value, json};

/// Evaluate a portable `a11y` expectation against an observed ARIA role, accessible name, and
/// capture-0.10 structured states (`spec.md` §3.2).
pub(crate) fn check_a11y_node(
    target: &str,
    expected: &Value,
    observed_role: &str,
    observed_name: &str,
    observed_states: &AccessibleStates,
) -> std::result::Result<Value, String> {
    const ALLOWED: &[&str] = &[
        "role",
        "name",
        "nameNonEmpty",
        "nameContains",
        "expanded",
        "selected",
        "checked",
        "pressed",
        "disabled",
        "invalid",
        "readonly",
        "required",
        "level",
    ];
    let Some(map) = expected.as_object() else {
        return Err(format!(
            "Expected '{target}' a11y assertion to be an object."
        ));
    };
    if map.is_empty() {
        return Err(format!(
            "Expected '{target}' a11y assertion to specify at least one property."
        ));
    }
    for key in map.keys() {
        if !ALLOWED.contains(&key.as_str()) {
            return Err(format!(
                "Unsupported a11y assertion field '{key}' on '{target}'."
            ));
        }
    }
    if let Some(want_role) = map.get("role") {
        let matched = match want_role {
            Value::String(role) => observed_role.eq_ignore_ascii_case(role),
            Value::Array(roles) if !roles.is_empty() && roles.iter().all(Value::is_string) => roles
                .iter()
                .filter_map(Value::as_str)
                .any(|role| observed_role.eq_ignore_ascii_case(role)),
            _ => {
                return Err(format!(
                    "Invalid a11y.role assertion on '{target}': expected string or non-empty string array."
                ));
            }
        };
        if !matched {
            return Err(format!(
                "Expected '{target}' a11y.role to be {want_role}; it is {observed_role:?}."
            ));
        }
    }
    if let Some(raw_name) = map.get("name") {
        let Some(want_name) = raw_name.as_str() else {
            return Err(format!(
                "Invalid a11y.name assertion on '{target}': expected string."
            ));
        };
        if observed_name != normalize_name(want_name) {
            return Err(format!(
                "Expected '{target}' a11y.name to be {want_name:?}; it is {observed_name:?}."
            ));
        }
    }
    if let Some(raw_non_empty) = map.get("nameNonEmpty") {
        let Some(want_non_empty) = raw_non_empty.as_bool() else {
            return Err(format!(
                "Invalid a11y.nameNonEmpty assertion on '{target}': expected boolean."
            ));
        };
        let non_empty = !observed_name.is_empty();
        if non_empty != want_non_empty {
            return Err(format!(
                "Expected '{target}' a11y.nameNonEmpty to be {want_non_empty}; observed name is {observed_name:?}."
            ));
        }
    }
    if let Some(raw_contains) = map.get("nameContains") {
        let Some(want_contains) = raw_contains.as_str() else {
            return Err(format!(
                "Invalid a11y.nameContains assertion on '{target}': expected string."
            ));
        };
        if !observed_name.contains(want_contains) {
            return Err(format!(
                "Expected '{target}' a11y.name to contain {want_contains:?}; it is {observed_name:?}."
            ));
        }
    }
    if let Some(raw_expanded) = map.get("expanded") {
        let Some(want) = raw_expanded.as_bool() else {
            return Err(format!(
                "Invalid a11y.expanded assertion on '{target}': expected boolean."
            ));
        };
        if observed_states.expanded != Some(want) {
            return Err(format!(
                "Expected '{target}' a11y.expanded to be {want}; it is {:?}.",
                observed_states.expanded
            ));
        }
    }
    if let Some(raw_selected) = map.get("selected") {
        let Some(want) = raw_selected.as_bool() else {
            return Err(format!(
                "Invalid a11y.selected assertion on '{target}': expected boolean."
            ));
        };
        if observed_states.selected != Some(want) {
            return Err(format!(
                "Expected '{target}' a11y.selected to be {want}; it is {:?}.",
                observed_states.selected
            ));
        }
    }
    for (field, observed) in [
        ("checked", observed_states.checked),
        ("pressed", observed_states.pressed),
    ] {
        if let Some(want) = map.get(field) {
            let expected_state = match want {
                Value::Bool(b) => TriState::Bool(*b),
                Value::String(s) if s == "mixed" => TriState::Mixed,
                _ => {
                    return Err(format!(
                        "Invalid a11y.{field} assertion on '{target}': expected boolean or \"mixed\"."
                    ));
                }
            };
            if observed != Some(expected_state) {
                return Err(format!(
                    "Expected '{target}' a11y.{field} to be {want}; it is {observed:?}."
                ));
            }
        }
    }
    for (field, observed) in [
        ("disabled", observed_states.disabled),
        ("readonly", observed_states.readonly),
        ("required", observed_states.required),
    ] {
        if let Some(raw_flag) = map.get(field) {
            let Some(want) = raw_flag.as_bool() else {
                return Err(format!(
                    "Invalid a11y.{field} assertion on '{target}': expected boolean."
                ));
            };
            let actual = observed.unwrap_or(false);
            if actual != want {
                return Err(format!(
                    "Expected '{target}' a11y.{field} to be {want}; it is {actual}."
                ));
            }
        }
    }
    if let Some(want) = map.get("invalid") {
        let ok = match want {
            Value::Bool(true) => matches!(
                observed_states.invalid,
                Some(InvalidState::True | InvalidState::Grammar | InvalidState::Spelling)
            ),
            Value::Bool(false) => observed_states.invalid.is_none(),
            Value::String(s) if s == "grammar" => {
                observed_states.invalid == Some(InvalidState::Grammar)
            }
            Value::String(s) if s == "spelling" => {
                observed_states.invalid == Some(InvalidState::Spelling)
            }
            _ => {
                return Err(format!(
                    "Invalid a11y.invalid assertion on '{target}': expected boolean, \"grammar\", or \"spelling\"."
                ));
            }
        };
        if !ok {
            return Err(format!(
                "Expected '{target}' a11y.invalid to be {want}; it is {:?}.",
                observed_states.invalid
            ));
        }
    }
    if let Some(raw_level) = map.get("level") {
        let Some(want) = raw_level.as_i64().filter(|&n| (1..=6).contains(&n)) else {
            return Err(format!(
                "Invalid a11y.level assertion on '{target}': expected integer 1..6."
            ));
        };
        if observed_states.level != Some(want) {
            return Err(format!(
                "Expected '{target}' a11y.level to be {want}; it is {:?}.",
                observed_states.level
            ));
        }
    }
    let mut detail = json!({ "role": observed_role, "name": observed_name });
    if !observed_states.is_empty() {
        detail["states"] = json!(observed_states);
    }
    Ok(detail)
}

#[cfg(test)]
mod tests {
    use super::check_a11y_node;
    use crate::aria::{AccessibleStates, InvalidState, TriState};
    use serde_json::json;

    #[test]
    fn checks_portable_a11y_expectations() {
        let states = AccessibleStates {
            expanded: Some(true),
            selected: Some(false),
            checked: Some(TriState::Mixed),
            pressed: Some(TriState::Bool(true)),
            disabled: Some(true),
            invalid: Some(InvalidState::Grammar),
            readonly: Some(true),
            required: Some(true),
            level: Some(2),
        };
        let detail = check_a11y_node(
            "control",
            &json!({
                "role": ["combobox", "button"],
                "nameNonEmpty": true,
                "nameContains": "Fruit",
                "expanded": true,
                "selected": false,
                "checked": "mixed",
                "pressed": true,
                "disabled": true,
                "invalid": true,
                "readonly": true,
                "required": true,
                "level": 2
            }),
            "button",
            "Fruit Apple",
            &states,
        )
        .unwrap();
        assert_eq!(detail["role"], json!("button"));
        assert_eq!(detail["states"]["invalid"], json!("grammar"));

        assert!(
            check_a11y_node(
                "c",
                &json!({ "invalid": "grammar" }),
                "textbox",
                "Email",
                &states
            )
            .is_ok()
        );
        assert!(
            check_a11y_node(
                "c",
                &json!({ "invalid": "spelling" }),
                "textbox",
                "Email",
                &states
            )
            .is_err()
        );
        assert!(
            check_a11y_node(
                "c",
                &json!({ "invalid": false, "disabled": false, "readonly": false, "required": false }),
                "textbox",
                "Email",
                &AccessibleStates::default()
            )
            .is_ok()
        );
        assert!(
            check_a11y_node(
                "c",
                &json!({ "expanded": false }),
                "button",
                "Menu",
                &AccessibleStates::default()
            )
            .is_err()
        );
    }
}
