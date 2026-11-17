//! A server's notification, delivered to the main webview as a DOM event (phase 6 specification, 10.4, as
//! amended 2026-11-16). A Tauri event would need `core:event` listen permissions, which 10.2 forbids, so the
//! Rust host evaluates one fixed statement in the main webview:
//!
//! `window.dispatchEvent(new CustomEvent('loam:mount', { detail: <payload> }))`
//!
//! `<payload>` is `{ handle, message }`, serialised by `serde_json` into one JSON literal. Nothing a server
//! sends is formatted into code: the literal is data, and after the escapes below it holds no character that
//! could end the statement, a string or a script element.
use serde_json::{Value, json};

/// The bound of `mount_send`'s input, applied to a notification's message as well.
pub const MESSAGE_MAX: usize = 1024 * 1024;

/// The event's name on `window`.
pub const EVENT: &str = "loam:mount";

/// `value` as a JSON literal that is also safe as JavaScript source anywhere: `<`, `>` and `&` (so no
/// `</script>` or `<!--`), and U+2028 and U+2029 (line terminators in older engines) become `\u` escapes.
/// Each can occur only inside a JSON string, where the escape means the same character.
pub fn literal(value: &Value) -> String {
    let encoded = serde_json::to_string(value).expect("a JSON value serialises");
    let mut out = String::with_capacity(encoded.len());
    for character in encoded.chars() {
        match character {
            '<' => out.push_str("\\u003c"),
            '>' => out.push_str("\\u003e"),
            '&' => out.push_str("\\u0026"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            other => out.push(other),
        }
    }
    out
}

/// The statement for one notification, or `None` when the message is over [`MESSAGE_MAX`] or is not a
/// notification (a `method` and no `id`), which the caller drops and logs.
pub fn script(handle: u64, message: &Value) -> Option<String> {
    let notification =
        message.is_object() && message["method"].is_string() && message.get("id").is_none();
    if !notification {
        return None;
    }
    let size = serde_json::to_vec(message).ok()?.len();
    if size > MESSAGE_MAX {
        return None;
    }
    let detail = literal(&json!({ "handle": handle, "message": message }));
    Some(format!(
        "window.dispatchEvent(new CustomEvent('{EVENT}',{{detail:{detail}}}))"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detail_of(script: &str) -> &str {
        script
            .strip_prefix("window.dispatchEvent(new CustomEvent('loam:mount',{detail:")
            .and_then(|rest| rest.strip_suffix("}))"))
            .expect("the fixed statement")
    }

    #[test]
    fn p6_d2_a_hostile_payload_is_one_inert_literal() {
        let hostile = "</script><script>alert(1)</script>\u{2028}\u{2029}\"'`${x}\\<!--";
        let message = json!({ "jsonrpc": "2.0", "method": "notifications/message", "params": { "data": hostile, hostile: 1 } });
        let script = script(7, &message).expect("a notification");
        let detail = detail_of(&script);
        for forbidden in ['<', '>', '&', '\u{2028}', '\u{2029}'] {
            assert!(!detail.contains(forbidden), "{forbidden:?} left unescaped");
        }
        // The literal is JSON, and reads back as exactly what was sent.
        let read: Value = serde_json::from_str(detail).unwrap();
        assert_eq!(read, json!({ "handle": 7, "message": message }));
    }

    #[test]
    fn p6_d2_an_oversized_notification_is_dropped() {
        let padding = "x".repeat(MESSAGE_MAX);
        let message = json!({ "jsonrpc": "2.0", "method": "notifications/message", "params": { "data": padding } });
        assert!(script(1, &message).is_none());
        let fits = "x".repeat(MESSAGE_MAX - 200);
        assert!(
            script(
                1,
                &json!({ "jsonrpc": "2.0", "method": "n", "params": { "d": fits } })
            )
            .is_some()
        );
    }

    #[test]
    fn a_request_or_response_is_not_delivered() {
        assert!(
            script(
                1,
                &json!({ "jsonrpc": "2.0", "id": 1, "method": "sampling/createMessage" })
            )
            .is_none()
        );
        assert!(script(1, &json!({ "jsonrpc": "2.0", "id": 1, "result": {} })).is_none());
        assert!(script(1, &json!([{ "jsonrpc": "2.0", "method": "n" }])).is_none());
    }
}
