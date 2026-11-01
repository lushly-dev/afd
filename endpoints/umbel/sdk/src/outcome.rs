//! A handler's answer: an AFD `CommandResult` as JSON.

use serde_json::{Map, Value, json};

/// An AFD `CommandResult` as JSON, built with [`success`] and [`failure`]. It serializes exactly
/// as AFD's wire format does: camelCase keys, unset fields omitted, never `null`.
#[derive(Debug, Clone, PartialEq)]
pub struct Outcome(Value);

/// A successful result carrying `data`.
pub fn success(data: Value) -> Outcome {
    let mut result = Map::new();
    result.insert("success".to_owned(), Value::Bool(true));
    result.insert("data".to_owned(), data);
    Outcome(Value::Object(result))
}

/// A failed result. AFD requires the `suggestion`: say what the caller can do about it.
pub fn failure(code: &str, message: &str, suggestion: &str) -> Outcome {
    Outcome(json!({
        "success": false,
        "error": { "code": code, "message": message, "suggestion": suggestion },
    }))
}

impl Outcome {
    fn object(&mut self) -> &mut Map<String, Value> {
        if !self.0.is_object() {
            self.0 = Value::Object(Map::new());
        }
        match &mut self.0 {
            Value::Object(map) => map,
            _ => unreachable!("set to an object above"),
        }
    }

    /// Why the command answered as it did.
    #[must_use]
    pub fn with_reasoning(mut self, text: &str) -> Self {
        self.object()
            .insert("reasoning".to_owned(), Value::String(text.to_owned()));
        self
    }

    /// How sure the command is, from 0 to 1. A value that is not a finite number is left out.
    #[must_use]
    pub fn with_confidence(mut self, value: f64) -> Self {
        if let Some(number) = serde_json::Number::from_f64(value) {
            self.object()
                .insert("confidence".to_owned(), Value::Number(number));
        }
        self
    }

    /// Add a warning, which does not change `success`.
    #[must_use]
    pub fn with_warning(mut self, code: &str, message: &str) -> Self {
        let warning = json!({ "code": code, "message": message });
        let warnings = self
            .object()
            .entry("warnings".to_owned())
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Value::Array(list) = warnings {
            list.push(warning);
        }
        self
    }

    /// Set `result.metadata[key]`, for the keys a command may supply (`dev.umbel/record` and
    /// `dev.umbel/provenance`); the host removes every other `dev.umbel/` key.
    #[must_use]
    pub fn with_metadata(mut self, key: &str, value: Value) -> Self {
        let metadata = self
            .object()
            .entry("metadata".to_owned())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Value::Object(map) = metadata {
            map.insert(key.to_owned(), value);
        }
        self
    }

    /// Whether the outcome is a success.
    pub fn is_success(&self) -> bool {
        self.0.get("success") == Some(&Value::Bool(true))
    }

    /// The result as JSON.
    pub fn as_value(&self) -> &Value {
        &self.0
    }

    /// The result as JSON, consuming the outcome.
    pub fn into_value(self) -> Value {
        self.0
    }
}

impl From<Outcome> for Value {
    fn from(outcome: Outcome) -> Self {
        outcome.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use afd::CommandResult;

    fn round_trip(outcome: &Outcome) -> Value {
        let result: CommandResult<Value> =
            serde_json::from_value(outcome.as_value().clone()).expect("an AFD CommandResult");
        serde_json::to_value(&result).expect("serializes")
    }

    #[test]
    fn success_is_afds_wire_format() {
        let outcome = success(json!({ "greeting": "Hello" }))
            .with_reasoning("because")
            .with_confidence(0.5)
            .with_warning("W", "careful");
        assert_eq!(round_trip(&outcome), *outcome.as_value());
        assert!(outcome.is_success());
        assert_eq!(outcome.as_value()["data"]["greeting"], "Hello");
        assert_eq!(outcome.as_value()["warnings"][0]["code"], "W");
    }

    #[test]
    fn failure_is_afds_wire_format_with_a_suggestion() {
        let outcome = failure("BAD", "It broke", "Try again");
        assert_eq!(round_trip(&outcome), *outcome.as_value());
        assert!(!outcome.is_success());
        assert_eq!(outcome.as_value()["error"]["suggestion"], "Try again");
    }

    #[test]
    fn unset_fields_are_omitted_and_nothing_is_null() {
        let outcome = success(json!({}));
        let text = outcome.as_value().to_string();
        assert!(!text.contains("null"), "{text}");
        assert_eq!(outcome.as_value().as_object().map(Map::len), Some(2));
    }

    #[test]
    fn a_confidence_that_is_not_finite_is_left_out() {
        let outcome = success(json!(1)).with_confidence(f64::NAN);
        assert!(outcome.as_value().get("confidence").is_none());
    }

    #[test]
    fn metadata_keys_a_command_may_supply_round_trip() {
        let outcome = success(json!({})).with_metadata("dev.umbel/record", json!({"kind": "x"}));
        assert_eq!(round_trip(&outcome), *outcome.as_value());
    }
}
