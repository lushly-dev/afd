//! Console messages, log entries and uncaught page errors, reported as Playwright reports them.

use crate::cdp::Event;
use serde_json::Value;
use tokio::sync::mpsc::UnboundedReceiver;

/// `String(value)` for a JavaScript number.
fn js_number(value: f64) -> String {
    if value == 0.0 {
        return "0".into();
    }
    if !value.is_finite() {
        return if value.is_nan() {
            "NaN".into()
        } else if value > 0.0 {
            "Infinity".into()
        } else {
            "-Infinity".into()
        };
    }
    // Shortest round-trip digits and exponent, laid out by Number.prototype.toString's rules.
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((&scientific, "0"));
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let (k, n) = (
        digits.len() as i64,
        exponent.parse::<i64>().unwrap_or(0) + 1,
    );
    let sign = if value < 0.0 { "-" } else { "" };
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let power = n - 1;
        let exponent = format!("e{}{}", if power < 0 { "-" } else { "+" }, power.abs());
        if k == 1 {
            format!("{digits}{exponent}")
        } else {
            format!("{}.{}{exponent}", &digits[..1], &digits[1..])
        }
    };
    format!("{sign}{body}")
}

/// `String(value)` for a JSON value from the protocol.
fn js_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number
            .as_f64()
            .map_or_else(|| number.to_string(), js_number),
        other => other.to_string(),
    }
}

/// An exception's message and name, as Playwright reports page errors: the description up
/// to its stack.
pub fn exception_text(details: &Value) -> String {
    let text = match details.get("exception") {
        Some(exception) => exception
            .get("description")
            .and_then(Value::as_str)
            .map(String::from)
            .unwrap_or_else(|| exception.get("value").map_or("undefined".into(), js_string)),
        None => details
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    };
    let lines: Vec<&str> = text.split('\n').collect();
    let stack = lines
        .iter()
        .position(|line| line.starts_with("    at"))
        .unwrap_or(lines.len());
    lines[..stack].join("\n")
}

/// The message of a page error without its `Name: ` prefix: Playwright drops the text up to
/// the first colon and the character after it, when there is one.
fn error_message(details: &Value) -> String {
    let text = exception_text(details);
    let Some(colon) = text.find(':') else {
        return text;
    };
    let mut rest = text[colon + 1..].chars();
    match rest.next() {
        Some(_) => rest.as_str().to_string(),
        None => text,
    }
}

/// Playwright's console text for one argument.
fn preview(argument: &Value) -> String {
    if argument.get("type").and_then(Value::as_str) == Some("undefined") {
        return "undefined".into();
    }
    if let Some(value) = argument.get("value") {
        return js_string(value);
    }
    if let Some(value) = argument.get("unserializableValue").and_then(Value::as_str) {
        return value.into();
    }
    if argument.get("subtype").and_then(Value::as_str) == Some("node") {
        return "JSHandle@node".into();
    }
    let description = argument.get("description").and_then(Value::as_str);
    let properties = argument
        .pointer("/preview/properties")
        .and_then(Value::as_array);
    if let (Some("Object"), Some(properties)) = (description, properties) {
        let tokens: Vec<String> = properties
            .iter()
            .map(|property| {
                let name = property.get("name").and_then(Value::as_str).unwrap_or("");
                let value = property.get("value").and_then(Value::as_str).unwrap_or("");
                format!("{name}: {value}")
            })
            .collect();
        return format!("{{{}}}", tokens.join(", "));
    }
    if let (Some("array"), Some(properties)) =
        (argument.get("subtype").and_then(Value::as_str), properties)
    {
        let mut entries: Vec<(u64, String)> = properties
            .iter()
            .filter_map(|property| {
                let index = property.get("name")?.as_str()?.parse().ok()?;
                Some((
                    index,
                    property
                        .get("value")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                ))
            })
            .collect();
        entries.sort_by_key(|(index, _)| *index);
        let (mut last, mut tokens) = (-1i64, Vec::new());
        for (index, value) in entries {
            match index as i64 - last - 1 {
                0 => {}
                1 => tokens.push("empty".to_string()),
                gap => tokens.push(format!("empty x {gap}")),
            }
            tokens.push(value);
            last = index as i64;
        }
        return format!("[{}]", tokens.join(", "));
    }
    description.map_or_else(|| "JSHandle@object".into(), String::from)
}

#[derive(Default)]
pub struct Messages {
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

/// Console errors and warnings, log entries and uncaught page errors, as Playwright reports
/// them. Events are read in the render's own task: everything the browser sent before a reply
/// the render has awaited is already queued here, so taking the messages loses none.
pub struct Collector {
    events: UnboundedReceiver<Event>,
    messages: Messages,
}

impl Collector {
    pub fn new(events: UnboundedReceiver<Event>) -> Collector {
        Collector {
            events,
            messages: Messages::default(),
        }
    }

    pub fn take(&mut self) -> Messages {
        while let Ok(event) = self.events.try_recv() {
            self.record(&event);
        }
        std::mem::take(&mut self.messages)
    }

    fn record(&mut self, event: &Event) {
        let (kind, text) = match event.method.as_str() {
            "Runtime.consoleAPICalled" => {
                if event
                    .params
                    .get("executionContextId")
                    .and_then(Value::as_i64)
                    == Some(0)
                {
                    return;
                }
                let text = event
                    .params
                    .get("args")
                    .and_then(Value::as_array)
                    .map(|args| args.iter().map(preview).collect::<Vec<_>>().join(" "))
                    .unwrap_or_default();
                (
                    event
                        .params
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or(""),
                    text,
                )
            }
            "Log.entryAdded" => {
                let entry = event.params.get("entry").unwrap_or(&Value::Null);
                if entry.get("source").and_then(Value::as_str) == Some("worker") {
                    return;
                }
                (
                    entry.get("level").and_then(Value::as_str).unwrap_or(""),
                    entry
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                )
            }
            "Runtime.exceptionThrown" => (
                "pageerror",
                error_message(event.params.get("exceptionDetails").unwrap_or(&Value::Null)),
            ),
            _ => return,
        };
        match kind {
            "error" | "pageerror" => self.messages.errors.push(text),
            "warning" => self.messages.warnings.push(text),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{error_message, js_number};
    use serde_json::json;

    #[test]
    fn formats_numbers_as_javascript_does() {
        for (value, text) in [
            (1.0, "1"),
            (-2.5, "-2.5"),
            (1e21, "1e+21"),
            (1.5e21, "1.5e+21"),
            (123456789012345680000.0, "123456789012345680000"),
            (0.000001, "0.000001"),
            (1e-7, "1e-7"),
            (0.1, "0.1"),
        ] {
            assert_eq!(js_number(value), text);
        }
    }

    #[test]
    fn splits_error_names_by_character() {
        let error = |text: &str| json!({ "exception": { "description": text } });
        assert_eq!(error_message(&error("Error: boom\n    at x")), "boom");
        assert_eq!(error_message(&error("a:é")), "");
        assert_eq!(error_message(&error("a:")), "a:");
        assert_eq!(error_message(&error("no colon")), "no colon");
    }
}
