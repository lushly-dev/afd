//! Native execution and failure classification for portable pattern gates (`spec.md` §4.3).

use crate::keyboard::Keyboard;
use crate::page::{Page, TargetError, emulate};
use anyhow::{Result, anyhow};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::Duration;
use tokio::time::{Instant, timeout_at};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateRunRequest {
    pub targets: Value,
    pub scenario: Vec<Value>,
    #[serde(default)]
    pub events: Vec<Value>,
}

pub(crate) enum GateExec {
    MountFailed(Value),
    Completed(Value),
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_gate(
    page: &Page<'_>,
    gate: &GateRunRequest,
    entry: &Value,
    retained: bool,
    context: &Value,
    timeout_ms: u64,
    attempt_deadline: Instant,
    capture_on_failure: bool,
    mut enter: impl FnMut(&'static str),
) -> Result<GateExec> {
    let mount_result: Result<()> = async {
        if retained {
            enter("loading the story's modules");
            // Keep the gate's effective context authoritative so story globals cannot switch
            // theme or viewport after the pre-launch context check (`spec.md` §4.3).
            page.evaluate(&format!(
                "window.__specimen.resolve({}, {}, {}, {{ check: false, authoritative: true }})",
                entry, context, context,
            ))
            .await?;
            emulate(page, context).await?;
            enter("rendering the story");
            page.evaluate(&format!("window.__specimen.mount({}, {})", entry, context))
                .await?;
        } else {
            enter("mounting the specimen");
            page.evaluate(&format!("window.__specimen.mount({}, {})", entry, context))
                .await?;
        }
        Ok(())
    }
    .await;

    if let Err(error) = mount_result {
        return Ok(GateExec::MountFailed(json!({
            "status": "failed",
            "failures": [{
                "stepId": "mount",
                "kind": "render",
                "message": format!("{error:#}"),
            }],
        })));
    }

    let events_declared = !gate.events.is_empty();
    let gate_mounted = json!({ "events": gate.events });
    if events_declared {
        page.evaluate(&format!(
            "window.__specimen.installEvents({})",
            Value::Array(gate.events.clone())
        ))
        .await?;
        page.bind_event_targets(&gate_mounted, &gate.targets)
            .await?;
    }
    enter("running the pattern gate");
    // Reserve a slice of the render budget so a timed-out step keeps its stepId/kind and can
    // still run failure-time capture before the outer render deadline cancels the page.
    let reserve_ms = if capture_on_failure {
        (timeout_ms / 5).clamp(250, 1500)
    } else {
        (timeout_ms / 10).clamp(100, 500)
    };
    let reserve = Duration::from_millis(reserve_ms);
    let step_deadline = attempt_deadline
        .checked_sub(reserve)
        .filter(|deadline| *deadline > Instant::now())
        .unwrap_or(attempt_deadline);

    let mut keyboard = Keyboard::default();
    let mut failures = Vec::new();
    for step in &gate.scenario {
        let step_result = match timeout_at(
            step_deadline,
            page.run_step(
                &gate_mounted,
                &gate.targets,
                events_declared,
                step,
                &mut keyboard,
            ),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => {
                let step_id = step
                    .get("id")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("step");
                Err(anyhow!(
                    "Gate step '{step_id}' timed out after {timeout_ms}ms"
                ))
            }
        };
        if let Err(error) = step_result {
            failures.push(classify_gate_failure(step, &error));
            break;
        }
    }
    let status = if failures.is_empty() {
        "passed"
    } else {
        "failed"
    };
    Ok(GateExec::Completed(json!({
        "status": status,
        "failures": failures,
    })))
}

/// Classify a failing portable pattern gate step into a structured `GateFailure` JSON object.
pub(crate) fn classify_gate_failure(step: &Value, error: &anyhow::Error) -> Value {
    let step_id = step
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or("step");
    let message = format!("{error:#}");
    if let Some(target_err) = error
        .chain()
        .find_map(|cause| cause.downcast_ref::<TargetError>())
    {
        return json!({
            "stepId": step_id,
            "kind": "target",
            "code": target_err.code(),
            "message": message,
        });
    }
    let kind = if step.get("action").is_some() {
        "action"
    } else if let Some(expectation) = step.get("expect") {
        if expectation.get("event").is_some() {
            "event"
        } else if expectation.get("form").is_some() {
            "form"
        } else if expectation.get("validity").is_some() {
            "validity"
        } else if expectation.get("a11y").is_some() {
            "a11y"
        } else if expectation.get("focus").is_some() {
            "focus"
        } else if expectation.get("layout").is_some() {
            "layout"
        } else {
            "render"
        }
    } else {
        "render"
    };
    json!({
        "stepId": step_id,
        "kind": kind,
        "message": message,
    })
}

#[cfg(test)]
mod tests {
    use super::classify_gate_failure;
    use crate::page::TargetError;
    use anyhow::anyhow;
    use serde_json::json;

    #[test]
    fn classify_gate_failure_reports_target_codes_and_step_kinds() {
        let not_found: anyhow::Error = TargetError::NotFound {
            name: "control".into(),
            target: "role \"combobox\"".into(),
        }
        .into();
        let target_failure = classify_gate_failure(
            &json!({ "id": "open", "action": { "click": "control" } }),
            &not_found,
        );
        assert_eq!(target_failure["stepId"], "open");
        assert_eq!(target_failure["kind"], "target");
        assert_eq!(target_failure["code"], "TARGET_NOT_FOUND");

        let focus_failure = classify_gate_failure(
            &json!({ "id": "back", "expect": { "target": "control", "focus": true } }),
            &anyhow!("Target did not hold focus"),
        );
        assert_eq!(focus_failure["stepId"], "back");
        assert_eq!(focus_failure["kind"], "focus");
        assert!(focus_failure.get("code").is_none());

        let layout_failure = classify_gate_failure(
            &json!({ "id": "fits", "expect": { "target": "control", "layout": { "noOverflow": true } } }),
            &anyhow!("Element overflowed container"),
        );
        assert_eq!(layout_failure["stepId"], "fits");
        assert_eq!(layout_failure["kind"], "layout");

        let event_failure = classify_gate_failure(
            &json!({ "id": "changed", "expect": { "event": "change", "since": "pick" } }),
            &anyhow!("Event not seen"),
        );
        assert_eq!(event_failure["stepId"], "changed");
        assert_eq!(event_failure["kind"], "event");
    }
}
