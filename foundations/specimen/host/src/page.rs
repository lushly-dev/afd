//! One page's CDP session: its environment, scenario targets and actions with Playwright's
//! actionability checks, and evaluation.

use crate::cdp::Cdp;
use crate::console::exception_text;
use anyhow::{Result, anyhow};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::Duration;
use tokio::time::sleep;

/// Playwright's headless default font families (`Page.setFontFamilies`) for this platform.
fn font_families() -> Value {
    if cfg!(target_os = "macos") {
        json!({
            "fontFamilies": { "standard": "Times", "fixed": "Courier", "serif": "Times", "sansSerif": "Helvetica", "cursive": "Apple Chancery", "fantasy": "Papyrus" },
            "forScripts": [
                { "script": "jpan", "fontFamilies": { "standard": "Hiragino Kaku Gothic ProN", "fixed": "Osaka-Mono", "serif": "Hiragino Mincho ProN", "sansSerif": "Hiragino Kaku Gothic ProN" } },
                { "script": "hang", "fontFamilies": { "standard": "Apple SD Gothic Neo", "serif": "AppleMyungjo", "sansSerif": "Apple SD Gothic Neo" } },
                { "script": "hans", "fontFamilies": { "standard": ",PingFang SC,STHeiti", "serif": "Songti SC", "sansSerif": ",PingFang SC,STHeiti", "cursive": "Kaiti SC" } },
                { "script": "hant", "fontFamilies": { "standard": ",PingFang TC,Heiti TC", "serif": "Songti TC", "sansSerif": ",PingFang TC,Heiti TC", "cursive": "Kaiti TC" } }
            ]
        })
    } else {
        json!({
            "fontFamilies": { "standard": "Times New Roman", "fixed": "Monospace", "serif": "Times New Roman", "sansSerif": "Arial", "cursive": "Comic Sans MS", "fantasy": "Impact" }
        })
    }
}

#[derive(Deserialize)]
pub struct Viewport {
    pub width: u32,
    pub height: u32,
}

pub const FRAME: &str = "new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))";
/// Actionability for click and hover (Playwright's visible, enabled, stable and hit-target
/// checks) and fill's editable check. Returns `"ok"`, a reason to retry, or throws.
const ACTIONABLE: &str = r#"async function (kind, x, y) {
    if (!this.isConnected) throw new Error('Element is not attached to the DOM');
    const style = getComputedStyle(this);
    const box = this.getBoundingClientRect();
    if (style.visibility !== 'visible' || box.width <= 0 || box.height <= 0) return 'element is not visible';
    if (kind !== 'hover') {
        const disabled = this.matches(':disabled') || this.getAttribute('aria-disabled') === 'true';
        if (disabled) return 'element is not enabled';
    }
    if (kind === 'fill' && (this.readOnly || this.getAttribute('aria-readonly') === 'true')) return 'element is not editable';
    const next = await new Promise((resolve) => requestAnimationFrame(() => resolve(this.getBoundingClientRect())));
    if (next.x !== box.x || next.y !== box.y || next.width !== box.width || next.height !== box.height) return 'element is not stable';
    if (kind === 'fill') return 'ok';
    let hit = document.elementFromPoint(x, y);
    while (hit && hit.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === hit) break;
        hit = inner;
    }
    for (let node = hit; node; node = node.assignedSlot || node.parentElement || (node.parentNode instanceof ShadowRoot ? node.parentNode.host : null))
        if (node === this) return 'ok';
    return hit ? `${hit.localName} intercepts pointer events` : 'element is outside the viewport';
}"#;
/// Playwright's fill: set the value of value-typed inputs, otherwise select the text for input.
const FILL: &str = r#"function (value) {
    let element = this;
    if (element instanceof HTMLLabelElement && element.control) element = element.control;
    if (element instanceof HTMLInputElement) {
        const type = element.type.toLowerCase();
        const set = ['color', 'date', 'time', 'datetime-local', 'month', 'range', 'week'];
        const typed = ['', 'email', 'number', 'password', 'search', 'tel', 'text', 'url'];
        if (!set.includes(type) && !typed.includes(type)) throw new Error(`Input of type "${type}" cannot be filled`);
        if (type === 'number' && Number.isNaN(Number(value.trim()))) throw new Error('Cannot type text into input[type=number]');
        if (set.includes(type)) {
            value = value.trim();
            element.focus();
            element.value = value;
            if (element.value !== value) throw new Error('Malformed value');
            element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return 'done';
        }
        element.select();
        element.focus();
        return 'needsinput';
    }
    if (element instanceof HTMLTextAreaElement) {
        element.selectionStart = 0;
        element.selectionEnd = element.value.length;
        element.focus();
        return 'needsinput';
    }
    if (!element.isContentEditable) throw new Error('Element is not an <input>, <textarea> or [contenteditable] element');
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.focus();
    return 'needsinput';
}"#;
/// Playwright's retry intervals for actionability.
const RETRIES: &[u64] = &[0, 20, 100, 100, 500];

pub struct Page<'a> {
    pub cdp: &'a Cdp,
    pub session: String,
}

impl Page<'_> {
    pub async fn send(&self, method: &str, params: Value) -> Result<Value> {
        self.cdp.send(Some(&self.session), method, params).await
    }

    fn checked(result: Value) -> Result<Value> {
        match result.get("exceptionDetails") {
            Some(details) => Err(anyhow!("{}", exception_text(details))),
            None => Ok(result),
        }
    }

    /// Evaluate an expression, awaiting a returned promise, and return its JSON value.
    pub async fn evaluate(&self, expression: &str) -> Result<Value> {
        let result = self
            .send(
                "Runtime.evaluate",
                json!({ "expression": expression, "awaitPromise": true, "returnByValue": true }),
            )
            .await?;
        Ok(Self::checked(result)?
            .pointer("/result/value")
            .cloned()
            .unwrap_or(Value::Null))
    }

    async fn call(&self, object: &str, function: &str, args: Value) -> Result<Value> {
        let result = self
            .send(
                "Runtime.callFunctionOn",
                json!({ "objectId": object, "functionDeclaration": function, "arguments": args, "returnByValue": true, "awaitPromise": true }),
            )
            .await?;
        Ok(Self::checked(result)?
            .pointer("/result/value")
            .cloned()
            .unwrap_or(Value::Null))
    }

    pub async fn root_backend_id(&self) -> Result<i64> {
        let found = self
            .send(
                "Runtime.evaluate",
                json!({ "expression": "document.querySelector('#specimen-root')", "returnByValue": false }),
            )
            .await?;
        let object = Self::checked(found)?
            .pointer("/result/objectId")
            .and_then(Value::as_str)
            .map(String::from)
            .ok_or_else(|| anyhow!("The bench page has no #specimen-root"))?;
        let described = self
            .send("DOM.describeNode", json!({ "objectId": object }))
            .await?;
        described
            .pointer("/node/backendNodeId")
            .and_then(Value::as_i64)
            .ok_or_else(|| anyhow!("The bench page has no #specimen-root"))
    }

    /// Resolve a declared target to the one element it must identify.
    async fn target(&self, name: &str, target: &Value) -> Result<String> {
        let (count, object) = if let Some(selector) = target.get("selector").and_then(Value::as_str)
        {
            let found = self
                .send(
                    "Runtime.evaluate",
                    json!({ "expression": format!("window.__specimen.locate({})", serde_json::to_string(selector)?), "returnByValue": false }),
                )
                .await?;
            let list = Self::checked(found)?
                .pointer("/result/objectId")
                .and_then(Value::as_str)
                .map(String::from)
                .ok_or_else(|| anyhow!("Target query failed: {name}"))?;
            let count = self
                .call(&list, "function () { return this.length; }", json!([]))
                .await?;
            let first = self
                .send(
                    "Runtime.callFunctionOn",
                    json!({ "objectId": list, "functionDeclaration": "function () { return this[0]; }" }),
                )
                .await?;
            (
                count.as_u64().unwrap_or(0),
                first
                    .pointer("/result/objectId")
                    .and_then(Value::as_str)
                    .map(String::from),
            )
        } else {
            let role = target.get("role").and_then(Value::as_str).unwrap_or("");
            let root = self.root_backend_id().await?;
            let mut query = json!({ "backendNodeId": root, "role": role });
            if let Some(accessible) = target.get("name").and_then(Value::as_str) {
                query["accessibleName"] = Value::String(accessible.to_string());
            }
            let found = self.send("Accessibility.queryAXTree", query).await?;
            let nodes: Vec<Value> = found
                .get("nodes")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|node| {
                    !node
                        .get("ignored")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                })
                .filter(|node| node.get("backendDOMNodeId").and_then(Value::as_i64) != Some(root))
                .collect();
            let object = match nodes.first().and_then(|node| node.get("backendDOMNodeId")) {
                Some(backend) => self
                    .send("DOM.resolveNode", json!({ "backendNodeId": backend }))
                    .await?
                    .pointer("/object/objectId")
                    .and_then(Value::as_str)
                    .map(String::from),
                None => None,
            };
            (nodes.len() as u64, object)
        };
        match (count, object) {
            (1, Some(object)) => Ok(object),
            _ => Err(anyhow!("Target must identify exactly one element: {name}")),
        }
    }

    /// The point Playwright clicks: the center of the element's first content quad.
    async fn point(&self, object: &str) -> Result<Option<(f64, f64)>> {
        let _ = self
            .send("DOM.scrollIntoViewIfNeeded", json!({ "objectId": object }))
            .await;
        let quads = self
            .send("DOM.getContentQuads", json!({ "objectId": object }))
            .await?;
        let quad = quads
            .get("quads")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|quad| {
                let points: Vec<f64> = quad.as_array()?.iter().filter_map(Value::as_f64).collect();
                let area = ((points[0] * points[3] - points[2] * points[1])
                    + (points[2] * points[5] - points[4] * points[3])
                    + (points[4] * points[7] - points[6] * points[5])
                    + (points[6] * points[1] - points[0] * points[7]))
                    .abs()
                    / 2.0;
                (points.len() == 8 && area > 0.99).then_some(points)
            })
            .next();
        Ok(quad.map(|points| {
            (
                (points[0] + points[2] + points[4] + points[6]) / 4.0,
                (points[1] + points[3] + points[5] + points[7]) / 4.0,
            )
        }))
    }

    /// Wait, with Playwright's retry intervals, until the element can receive the action.
    async fn actionable(&self, object: &str, kind: &str) -> Result<(f64, f64)> {
        // Retried until the render deadline, which bounds every action.
        for attempt in 0.. {
            if let Some((x, y)) = self.point(object).await? {
                let verdict = self
                    .call(
                        object,
                        ACTIONABLE,
                        json!([{ "value": kind }, { "value": x }, { "value": y }]),
                    )
                    .await?;
                if verdict.as_str() == Some("ok") {
                    return Ok((x, y));
                }
            }
            sleep(Duration::from_millis(
                RETRIES[attempt.min(RETRIES.len() - 1)],
            ))
            .await;
        }
        unreachable!()
    }

    pub async fn mouse(&self, kind: &str, x: f64, y: f64) -> Result<()> {
        let event = match kind {
            "mouseMoved" => {
                json!({ "type": kind, "x": x, "y": y, "button": "none", "buttons": 0, "modifiers": 0 })
            }
            "mousePressed" => {
                json!({ "type": kind, "x": x, "y": y, "button": "left", "buttons": 1, "clickCount": 1, "modifiers": 0 })
            }
            _ => {
                json!({ "type": kind, "x": x, "y": y, "button": "left", "buttons": 0, "clickCount": 1, "modifiers": 0 })
            }
        };
        self.send("Input.dispatchMouseEvent", event)
            .await
            .map(|_| ())
    }

    async fn act(&self, action: &Value, targets: &Value) -> Result<()> {
        let (kind, name) = ["click", "focus", "hover", "fill"]
            .iter()
            .find_map(|kind| {
                action
                    .get(*kind)
                    .and_then(Value::as_str)
                    .map(|name| (*kind, name))
            })
            .ok_or_else(|| anyhow!("Unsupported scenario action"))?;
        let target = targets
            .get(name)
            .ok_or_else(|| anyhow!("Scenario action refers to an undeclared target"))?;
        let object = self.target(name, target).await?;
        match kind {
            "click" | "hover" => {
                let (x, y) = self.actionable(&object, kind).await?;
                self.mouse("mouseMoved", x, y).await?;
                if kind == "click" {
                    self.mouse("mousePressed", x, y).await?;
                    self.mouse("mouseReleased", x, y).await?;
                }
            }
            "focus" => {
                self.call(&object, "function () { this.focus(); }", json!([]))
                    .await?;
            }
            _ => {
                self.actionable(&object, "fill").await?;
                let value = action.get("value").and_then(Value::as_str).unwrap_or("");
                let state = self
                    .call(&object, FILL, json!([{ "value": value }]))
                    .await?;
                if state.as_str() == Some("needsinput") {
                    if value.is_empty() {
                        for kind in ["keyDown", "keyUp"] {
                            self.send(
                                "Input.dispatchKeyEvent",
                                json!({ "type": kind, "key": "Delete", "code": "Delete", "windowsVirtualKeyCode": 46, "nativeVirtualKeyCode": 46 }),
                            )
                            .await?;
                        }
                    } else {
                        self.send("Input.insertText", json!({ "text": value }))
                            .await?;
                    }
                }
            }
        }
        // Include callbacks already queued for the next frame and their microtasks.
        self.evaluate(FRAME).await?;
        Ok(())
    }

    pub async fn steps(&self, mounted: &Value, checkpoint: &str) -> Result<()> {
        if checkpoint == "mount" {
            return Ok(());
        }
        let steps = mounted
            .get("scenario")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let targets = mounted.get("targets").cloned().unwrap_or(json!({}));
        if checkpoint != "after-run"
            && !steps
                .iter()
                .any(|step| step.get("capture").and_then(Value::as_str) == Some(checkpoint))
        {
            return Err(anyhow!("Checkpoint not found: {checkpoint}"));
        }
        for step in steps {
            if let Some(capture) = step.get("capture").and_then(Value::as_str) {
                if capture == checkpoint {
                    return Ok(());
                }
                continue;
            }
            self.act(step.get("action").unwrap_or(&Value::Null), &targets)
                .await?;
        }
        Ok(())
    }
}

/// The page environment Playwright gives a new page in a context with these options.
pub async fn prepare(page: &Page<'_>, context: &Value) -> Result<Viewport> {
    let viewport: Viewport =
        serde_json::from_value(context.get("viewport").cloned().unwrap_or(Value::Null))
            .map_err(|error| anyhow!("Invalid viewport: {error}"))?;
    let locale = context
        .get("locale")
        .and_then(Value::as_str)
        .unwrap_or("en-US");
    let theme = context
        .get("theme")
        .and_then(Value::as_str)
        .unwrap_or("light");
    let motion = context
        .get("reducedMotion")
        .and_then(Value::as_str)
        .unwrap_or("no-preference");
    let commands = [
        ("Page.enable", json!({})),
        ("Log.enable", json!({})),
        ("Runtime.enable", json!({})),
        (
            "Emulation.setFocusEmulationEnabled",
            json!({ "enabled": true }),
        ),
        (
            "Emulation.setDeviceMetricsOverride",
            json!({ "mobile": false, "width": viewport.width, "height": viewport.height, "screenWidth": viewport.width, "screenHeight": viewport.height, "deviceScaleFactor": 1, "screenOrientation": { "angle": 0, "type": "landscapePrimary" } }),
        ),
        (
            "Emulation.setUserAgentOverride",
            json!({ "userAgent": "", "acceptLanguage": locale }),
        ),
        ("Emulation.setLocaleOverride", json!({ "locale": locale })),
        ("Page.setFontFamilies", font_families()),
        (
            "Emulation.setEmulatedMedia",
            json!({ "media": "", "features": [
                { "name": "prefers-color-scheme", "value": theme },
                { "name": "prefers-reduced-motion", "value": motion },
                { "name": "forced-colors", "value": "" },
                { "name": "prefers-contrast", "value": "" }
            ] }),
        ),
    ];
    // Sent together, as Playwright does; Chromium applies a session's commands in order.
    futures::future::try_join_all(
        commands
            .iter()
            .map(|(method, params)| page.send(method, params.clone())),
    )
    .await?;
    Ok(viewport)
}
