//! MCP 2026-07-28 on the `http` lane (phase 5 specification, 7.2; #2137). The era is stateless over Streamable HTTP:
//! each request names its version in `_meta`, and the server also requires the standard request headers
//! (`MCP-Protocol-Version`, `Mcp-Method` and, for the methods that mirror a body field, `Mcp-Name`). The page builds
//! the message and never a header, so this host derives them from the message itself, as the MCP SDK's client does:
//! for a request whose `_meta` names the era, and no other. A 2025 message is sent as before, with its session.
use crate::mounts::RESULT_INVALID;
use serde_json::Value;

/// The era on which AFD accepts an approver's `_meta["dev.afd/approval"]`, and the only one the page names.
pub const MODERN_VERSION: &str = "2026-07-28";
/// The `_meta` key a 2026-07-28 request names its version by.
const VERSION_META_KEY: &str = "io.modelcontextprotocol/protocolVersion";
/// The Base64 sentinel of a header value that is not plain ASCII (SEP-2243's value encoding).
const SENTINEL_PREFIX: &str = "=?base64?";
const SENTINEL_SUFFIX: &str = "?=";
/// A method name's longest header value: JSON-RPC methods are short, and a header is not a place for a long one.
const METHOD_MAX: usize = 128;

/// The body field `Mcp-Name` mirrors for `method`, as the SDK's `MCP_NAME_HEADER_SOURCE` lists them.
fn name_source(method: &str) -> Option<&'static str> {
    match method {
        "tools/call" | "prompts/get" => Some("name"),
        "resources/read" => Some("uri"),
        "tasks/get" | "tasks/update" | "tasks/cancel" => Some("taskId"),
        _ => None,
    }
}

/// Whether `value` must be sent as the Base64 sentinel: empty, padded with whitespace, holding a byte outside
/// `0x20..=0x7E` and tab, or already shaped like the sentinel (the SDK's `needsBase64`).
fn needs_base64(value: &str) -> bool {
    value.is_empty()
        || (value.starts_with(SENTINEL_PREFIX) && value.ends_with(SENTINEL_SUFFIX))
        || value != value.trim_matches(|c| c == ' ' || c == '\t')
        || !value
            .bytes()
            .all(|byte| byte == b'\t' || (0x20..=0x7e).contains(&byte))
}

/// Standard Base64 with padding, of `bytes`.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let triple = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for index in 0..4 {
            if index <= chunk.len() {
                out.push(char::from(
                    ALPHABET[((triple >> (18 - 6 * index)) & 0x3f) as usize],
                ));
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// A header value for `value`: itself when it is a plain field value, otherwise the Base64 sentinel of its UTF-8.
pub fn header_value(value: &str) -> String {
    if needs_base64(value) {
        format!(
            "{SENTINEL_PREFIX}{}{SENTINEL_SUFFIX}",
            base64(value.as_bytes())
        )
    } else {
        value.to_owned()
    }
}

/// The era's headers for `message`, or `None` for a message the era does not cover: a 2025 message, a notification
/// or a response. A request that names another version, or a method no header may carry, is refused, since the page
/// never builds one: `MOUNT_RESULT_INVALID`, as a message the host cannot send.
pub fn headers(message: &Value) -> Result<Option<Vec<(&'static str, String)>>, &'static str> {
    let (Some(method), Some(_)) = (message.get("method"), message.get("id")) else {
        return Ok(None);
    };
    let params = message.get("params");
    let Some(version) = params
        .and_then(|params| params.get("_meta"))
        .and_then(|meta| meta.get(VERSION_META_KEY))
    else {
        return Ok(None);
    };
    if version != MODERN_VERSION {
        return Err(RESULT_INVALID);
    }
    let method = method.as_str().ok_or(RESULT_INVALID)?;
    if method.is_empty()
        || method.len() > METHOD_MAX
        || !method.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
    {
        return Err(RESULT_INVALID);
    }
    let mut headers = vec![
        ("MCP-Protocol-Version", MODERN_VERSION.to_owned()),
        ("Mcp-Method", method.to_owned()),
    ];
    if let Some(field) = name_source(method)
        && let Some(value) = params
            .and_then(|params| params.get(field))
            .and_then(Value::as_str)
    {
        headers.push(("Mcp-Name", header_value(value)));
    }
    Ok(Some(headers))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn modern(method: &str, params: Value) -> Value {
        let mut params = params;
        params["_meta"] =
            json!({ VERSION_META_KEY: MODERN_VERSION, "dev.loam/scope": { "workspace": "w" } });
        json!({ "jsonrpc": "2.0", "id": 3, "method": method, "params": params })
    }

    #[test]
    fn a_modern_request_gets_the_eras_headers_from_its_own_body() {
        assert_eq!(
            headers(&modern(
                "tools/call",
                json!({ "name": "mail-draft-send", "arguments": {} })
            )),
            Ok(Some(vec![
                ("MCP-Protocol-Version", "2026-07-28".to_owned()),
                ("Mcp-Method", "tools/call".to_owned()),
                ("Mcp-Name", "mail-draft-send".to_owned()),
            ]))
        );
        assert_eq!(
            headers(&modern("server/discover", json!({}))),
            Ok(Some(vec![
                ("MCP-Protocol-Version", "2026-07-28".to_owned()),
                ("Mcp-Method", "server/discover".to_owned()),
            ]))
        );
        assert_eq!(
            headers(&modern(
                "resources/read",
                json!({ "uri": "mail://drafts/1" })
            ))
            .unwrap()
            .unwrap()[2],
            ("Mcp-Name", "mail://drafts/1".to_owned())
        );
    }

    #[test]
    fn a_2025_message_a_notification_and_a_response_get_none() {
        let legacy = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } });
        assert_eq!(headers(&legacy), Ok(None));
        let mut notification = modern("notifications/cancelled", json!({}));
        notification.as_object_mut().unwrap().remove("id");
        assert_eq!(headers(&notification), Ok(None));
        assert_eq!(
            headers(&json!({ "jsonrpc": "2.0", "id": 1, "result": {} })),
            Ok(None)
        );
    }

    #[test]
    fn another_version_or_an_unsendable_method_is_refused() {
        let mut other = modern("tools/list", json!({}));
        other["params"]["_meta"][VERSION_META_KEY] = json!("2026-07-28\r\nX-Injected: 1");
        assert_eq!(headers(&other), Err(RESULT_INVALID));
        other["params"]["_meta"][VERSION_META_KEY] = json!(20260728);
        assert_eq!(headers(&other), Err(RESULT_INVALID));
        assert_eq!(
            headers(&modern("tools/list\r\nX: 1", json!({}))),
            Err(RESULT_INVALID)
        );
        assert_eq!(headers(&modern("", json!({}))), Err(RESULT_INVALID));
        assert_eq!(
            headers(&modern(&"m".repeat(129), json!({}))),
            Err(RESULT_INVALID)
        );
    }

    #[test]
    fn a_name_that_is_not_a_plain_field_value_is_sent_as_the_base64_sentinel() {
        assert_eq!(header_value("hello-greet"), "hello-greet");
        assert_eq!(header_value("a b\tc"), "a b\tc");
        // As the SDK's `utf8ToBase64`: the UTF-8 bytes, standard alphabet, padded.
        assert_eq!(header_value("café"), "=?base64?Y2Fmw6k=?=");
        assert_eq!(header_value(" padded"), "=?base64?IHBhZGRlZA==?=");
        assert_eq!(header_value(""), "=?base64??=");
        assert_eq!(header_value("line\nbreak"), "=?base64?bGluZQpicmVhaw==?=");
        assert_eq!(
            header_value("=?base64?eA==?="),
            "=?base64?PT9iYXNlNjQ/ZUE9PT89?="
        );
        for (input, encoded) in [
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
        ] {
            assert_eq!(base64(input.as_bytes()), encoded);
        }
    }
}
