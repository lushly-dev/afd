//! `umbel-hook print-settings claude-code` (section 10.4): the hooks fragment of a Claude Code
//! settings file. It prints and never writes a harness's settings; the person adds it.
//!
//! `SessionEnd` shares a 1.5-second budget unless a hook sets `timeout`, so `SessionEnd` and
//! `PreCompact` get 30 seconds and `SessionStart` 10. `Stop` is `async`, so parsing and capture
//! never run in the turn path (Claude Code does not enforce `timeout` on an async hook).

use serde_json::{Value, json};

fn hook(event: &str, extra: &Value) -> Value {
    let mut hook =
        json!({ "type": "command", "command": format!("umbel-hook claude-code {event}") });
    if let (Some(hook), Some(extra)) = (hook.as_object_mut(), extra.as_object()) {
        hook.extend(extra.clone());
    }
    hook
}

/// The fragment, pretty-printed.
pub(crate) fn claude_code() -> String {
    let fragment = json!({
        "hooks": {
            "SessionStart": [{
                "matcher": "startup|clear|compact",
                "hooks": [hook("session-start", &json!({ "timeout": 10 }))],
            }],
            "Stop": [{ "hooks": [hook("stop", &json!({ "async": true }))] }],
            "PreCompact": [{ "hooks": [hook("pre-compact", &json!({ "timeout": 30 }))] }],
            "SessionEnd": [{ "hooks": [hook("session-end", &json!({ "timeout": 30 }))] }],
        }
    });
    serde_json::to_string_pretty(&fragment).unwrap_or_default()
}
