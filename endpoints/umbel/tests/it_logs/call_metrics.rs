//! Metrics per command and the call line (D217, #1773): one MCP call counts in the command's
//! series and writes one `command finished` line whose request id is the W3C trace id of the
//! request's `_meta.traceparent`; a call without one gets a new id, and a refused call counts as
//! an error with its code in the line.

use crate::logs;
use serde_json::{Value, json};
use umbel::testkit::TestHost;
use umbel::testkit::mcp::{Http, command_result, modern_meta};

const TRACE: &str = "7d1a4c2e9b3f40a8b6c5d4e3f2a1b0c9";

fn meta(traceparent: Option<&str>) -> Value {
    let mut meta = modern_meta();
    if let Some(traceparent) = traceparent {
        meta["traceparent"] = json!(traceparent);
    }
    meta
}

async fn greet(http: &Http, space: &str, traceparent: Option<&str>) -> Value {
    let response = http
        .modern(
            "tools/call",
            json!({
                "name": "hello-greet",
                "arguments": { "name": "Ada", "space": space },
                "_meta": meta(traceparent),
            }),
        )
        .await;
    command_result(&response)
}

fn finished(needle: &str) -> Vec<String> {
    logs::lines("command finished")
        .into_iter()
        .filter(|line| line.contains(needle))
        .collect()
}

#[tokio::test]
async fn one_call_produces_its_metric_and_its_log_line() {
    logs::install();
    let host = TestHost::compiled(umbel::plugins::sdk(umbel_plugin_hello::plugin()))
        .boot()
        .unwrap();
    let http = Http::new(host.host());
    let before = host.host().metrics_text();
    assert!(
        before.contains("umbel_command_calls_total{command=\"hello-greet\",outcome=\"ok\"} 0\n"),
        "{before}"
    );

    // With trace context: the line's request id is the caller's trace id.
    let traceparent = format!("00-{TRACE}-00f067aa0ba902b7-01");
    let result = greet(&http, "main", Some(&traceparent)).await;
    assert_eq!(result["success"], json!(true), "{result}");
    let text = host.host().metrics_text();
    assert!(
        text.contains("umbel_command_calls_total{command=\"hello-greet\",outcome=\"ok\"} 1\n"),
        "{text}"
    );
    assert!(
        text.contains("umbel_command_duration_seconds_count{command=\"hello-greet\"} 1\n"),
        "{text}"
    );
    let lines = finished(TRACE);
    assert_eq!(lines.len(), 1, "{lines:?}");
    let line = &lines[0];
    assert!(line.contains("umbel::call"), "{line}");
    assert!(line.contains("hello-greet"), "{line}");
    assert!(line.contains("success=true"), "{line}");
    // The line never carries the input.
    assert!(!line.contains("Ada"), "{line}");

    // Without trace context, a new id in the same form; a refused call is an error with its code.
    // The binary's tests share one log buffer, so the line is the one this call added.
    let failed = |code: &str| {
        finished(code)
            .into_iter()
            .filter(|line| line.contains("hello-greet") && line.contains("success=false"))
            .collect::<Vec<_>>()
    };
    let earlier = failed("SPACE_NOT_FOUND");
    let refused = greet(&http, "nowhere", None).await;
    assert_eq!(refused["success"], json!(false), "{refused}");
    let code = refused["error"]["code"].as_str().unwrap().to_owned();
    assert_eq!(code, "SPACE_NOT_FOUND", "{refused}");
    let text = host.host().metrics_text();
    assert!(
        text.contains("umbel_command_calls_total{command=\"hello-greet\",outcome=\"error\"} 1\n"),
        "{text}"
    );
    let lines: Vec<String> = failed(&code)
        .into_iter()
        .filter(|line| !earlier.contains(line))
        .collect();
    assert_eq!(lines.len(), 1, "{lines:?}");
    let line = &lines[0];
    assert!(line.contains("abandoned=false"), "{line}");
    let id = line
        .split("request_id=")
        .nth(1)
        .unwrap()
        .trim_start_matches('"')
        .split(|c: char| !c.is_ascii_hexdigit())
        .next()
        .unwrap();
    assert_eq!(id.len(), 32, "{line}");
    assert_ne!(id, TRACE, "{line}");
    // The exposition names no principal, space or content.
    for leak in ["loopback", "main", "nowhere", "Ada"] {
        assert!(!text.contains(leak), "{leak} in {text}");
    }
}
