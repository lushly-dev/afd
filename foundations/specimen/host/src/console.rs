//! Console messages, log entries and uncaught page errors, reported as Playwright reports them.

use crate::cdp::Event;
use serde_json::Value;
use std::sync::{Arc, Mutex};

/// An exception's message and name, as Playwright reports page errors: the description up
/// to its stack.
pub fn exception_text(details: &Value) -> String {
    let text = match details.get("exception") {
        Some(exception) => exception
            .get("description")
            .and_then(Value::as_str)
            .map(String::from)
            .unwrap_or_else(|| {
                exception
                    .get("value")
                    .map_or("undefined".into(), |value| match value {
                        Value::String(text) => text.clone(),
                        other => other.to_string(),
                    })
            }),
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

/// The message of a page error without its `Name: ` prefix.
fn error_message(details: &Value) -> String {
    let text = exception_text(details);
    match text.find(':') {
        Some(index) if index + 2 <= text.len() => text[index + 2..].to_string(),
        _ => text,
    }
}

/// Playwright's console text for one argument.
fn preview(argument: &Value) -> String {
    if argument.get("type").and_then(Value::as_str) == Some("undefined") {
        return "undefined".into();
    }
    if let Some(value) = argument.get("value") {
        return match value {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        };
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

/// Console errors and warnings, log entries and uncaught page errors, as Playwright reports them.
pub fn collect(mut events: tokio::sync::mpsc::UnboundedReceiver<Event>) -> Arc<Mutex<Messages>> {
    let messages: Arc<Mutex<Messages>> = Arc::default();
    let sink = messages.clone();
    tokio::spawn(async move {
        while let Some(event) = events.recv().await {
            let (kind, text) = match event.method.as_str() {
                "Runtime.consoleAPICalled" => {
                    if event
                        .params
                        .get("executionContextId")
                        .and_then(Value::as_i64)
                        == Some(0)
                    {
                        continue;
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
                            .unwrap_or("")
                            .to_string(),
                        text,
                    )
                }
                "Log.entryAdded" => {
                    let entry = event.params.get("entry").cloned().unwrap_or(Value::Null);
                    if entry.get("source").and_then(Value::as_str) == Some("worker") {
                        continue;
                    }
                    (
                        entry
                            .get("level")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        entry
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                    )
                }
                "Runtime.exceptionThrown" => {
                    let details = event
                        .params
                        .get("exceptionDetails")
                        .cloned()
                        .unwrap_or(Value::Null);
                    ("pageerror".to_string(), error_message(&details))
                }
                _ => continue,
            };
            let mut messages = sink.lock().unwrap();
            match kind.as_str() {
                "error" | "pageerror" => messages.errors.push(text),
                "warning" => messages.warnings.push(text),
                _ => {}
            }
        }
    });
    messages
}
