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
/// Helpers from Playwright's injected script, prefixed to the functions run on a target.
const HELPERS: &str = r#"
    const tagName = (element) => typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
    const parentOrHost = (element) => element.parentElement || (element.parentNode && element.parentNode.nodeType === 11 && element.parentNode.host) || null;
    const retarget = (node, behavior) => {
        let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        if (!element) return null;
        if (behavior === 'none') return element;
        if (!element.matches('input, textarea, select') && !element.isContentEditable)
            element = element.closest('button, [role=button], [role=checkbox], [role=radio]') || element;
        if (behavior === 'follow-label' && !element.matches('a, input, textarea, button, select, [role=link], [role=button], [role=checkbox], [role=switch], [role=radio]') && !element.isContentEditable) {
            const label = element.closest('label');
            if (label && label.control) element = label.control;
        }
        return element;
    };
    const visibleText = (node) => {
        const range = node.ownerDocument.createRange();
        range.selectNode(node);
        const rect = range.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };
    const visible = (element) => {
        const style = getComputedStyle(element);
        if (style.display === 'contents') {
            for (let child = element.firstChild; child; child = child.nextSibling) {
                if (child.nodeType === 1 && visible(child)) return true;
                if (child.nodeType === 3 && visibleText(child)) return true;
            }
            return false;
        }
        if (!element.checkVisibility() || style.visibility !== 'visible') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };
    const disabledRoles = ['application', 'button', 'composite', 'gridcell', 'group', 'input', 'link', 'menuitem', 'scrollbar', 'separator', 'tab', 'checkbox', 'columnheader', 'combobox', 'grid', 'listbox', 'menu', 'menubar', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'radiogroup', 'row', 'rowheader', 'searchbox', 'select', 'slider', 'spinbutton', 'switch', 'tablist', 'textbox', 'toolbar', 'tree', 'treegrid', 'treeitem'];
    const ariaDisabledInChain = (element) => {
        const value = (element.getAttribute('aria-disabled') || '').toLowerCase();
        if (value === 'true') return true;
        if (value === 'false') return false;
        const parent = parentOrHost(element);
        return parent ? ariaDisabledInChain(parent) : false;
    };
    const nativelyDisabled = (element) => {
        if (!['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'OPTGROUP'].includes(tagName(element))) return false;
        if (element.hasAttribute('disabled')) return true;
        if (tagName(element) === 'OPTION' && element.closest('OPTGROUP[DISABLED]')) return true;
        const fieldset = element.closest('FIELDSET[DISABLED]');
        if (!fieldset) return false;
        const legend = fieldset.querySelector(':scope > LEGEND');
        return !legend || !legend.contains(element);
    };
    const disabled = (element, role) => nativelyDisabled(element) || (disabledRoles.includes(role) && ariaDisabledInChain(element));
    const readonlyRoles = ['checkbox', 'combobox', 'grid', 'gridcell', 'listbox', 'radiogroup', 'slider', 'spinbutton', 'textbox', 'columnheader', 'rowheader', 'searchbox', 'switch', 'treegrid'];
    const readonly = (element, role) => {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName(element))) return element.hasAttribute('readonly');
        if (readonlyRoles.includes(role)) return element.getAttribute('aria-readonly') === 'true';
        if (element.isContentEditable) return false;
        return 'error';
    };
"#;
/// Returns the element Playwright checks `enabled` and `editable` on.
const FOLLOW_LABEL: &str = "function () { HELPERS; return retarget(this, 'follow-label'); }";
/// Playwright's `checkElementStates`: `"ok"`, the first missing state, or a thrown error.
/// `role` is the ARIA role of the follow-label target.
const STATES: &str = r#"async function (states, role) {
    HELPERS;
    if (!this.isConnected) throw new Error('Element is not attached to the DOM');
    if (states.includes('stable')) {
        const element = retarget(this, 'no-follow-label');
        const rect = () => { const box = element.getBoundingClientRect(); return [box.top, box.left, box.width, box.height].join(); };
        const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(rect())));
        if ((await frame()) !== (await frame())) return 'stable';
    }
    for (const state of states) {
        if (state === 'stable') continue;
        const element = retarget(this, state === 'visible' ? 'none' : 'follow-label');
        if (!element || !element.isConnected) throw new Error('Element is not attached to the DOM');
        if (state === 'visible' && !visible(element)) return 'visible';
        if (state === 'enabled' && disabled(element, role)) return 'enabled';
        if (state === 'editable') {
            const value = readonly(element, role);
            if (value === 'error') throw new Error('Element is not an <input>, <textarea>, <select> or [contenteditable] and does not have a role allowing [aria-readonly]');
            if (disabled(element, role) || value) return 'editable';
        }
    }
    return 'ok';
}"#;
/// Playwright's `expectHitTarget`: whether the element under the point is the target or inside
/// it, across shadow roots and slots.
const HIT_TARGET: &str = r#"function (x, y) {
    HELPERS;
    const enclosingRoot = (element) => { let node = element; while (node.parentNode) node = node.parentNode; return node.nodeType === 11 || node.nodeType === 9 ? node : undefined; };
    const roots = [];
    for (let parent = this; parent; ) {
        const root = enclosingRoot(parent);
        if (!root) break;
        roots.push(root);
        if (root.nodeType === 9) break;
        parent = root.host;
    }
    let hit;
    for (let index = roots.length - 1; index >= 0; index--) {
        const root = roots[index];
        const elements = root.elementsFromPoint(x, y);
        const single = root.elementFromPoint(x, y);
        if (single && elements[0] && parentOrHost(single) === elements[0] && getComputedStyle(single).display === 'contents') elements.unshift(single);
        if (elements[0] && elements[1] === single && roots.slice(index).some((candidate) => candidate.host === elements[0])) elements.shift();
        const inner = elements[0];
        if (!inner) break;
        hit = inner;
        if (index && inner !== roots[index - 1].host) break;
    }
    while (hit && hit !== this) hit = hit.assignedSlot || parentOrHost(hit);
    return hit === this;
}"#;
/// Playwright's fill: set the value of value-typed inputs, otherwise select the text for input.
const FILL: &str = r#"function (value) {
    HELPERS;
    const element = retarget(this, 'follow-label');
    if (!element) throw new Error('Element is not attached to the DOM');
    if (tagName(element) === 'INPUT') {
        const type = element.type.toLowerCase();
        const set = ['color', 'date', 'time', 'datetime-local', 'month', 'range', 'week'];
        const typed = ['', 'email', 'number', 'password', 'search', 'tel', 'text', 'url'];
        if (!set.includes(type) && !typed.includes(type)) throw new Error(`Input of type "${type}" cannot be filled`);
        if (type === 'number') {
            value = value.trim();
            if (Number.isNaN(Number(value))) throw new Error('Cannot type text into input[type=number]');
        }
        if (type === 'color') value = value.toLowerCase();
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
    if (tagName(element) === 'TEXTAREA') {
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

    /// Call a function with `this` bound to the object, its `HELPERS;` replaced by the helpers.
    async fn call_on(
        &self,
        object: &str,
        function: &str,
        args: Value,
        by_value: bool,
    ) -> Result<Value> {
        let function = function.replacen("HELPERS;", HELPERS, 1);
        let result = self
            .send(
                "Runtime.callFunctionOn",
                json!({ "objectId": object, "functionDeclaration": function, "arguments": args, "returnByValue": by_value, "awaitPromise": true }),
            )
            .await?;
        Self::checked(result)
    }

    async fn call(&self, object: &str, function: &str, args: Value) -> Result<Value> {
        Ok(self
            .call_on(object, function, args, true)
            .await?
            .pointer("/result/value")
            .cloned()
            .unwrap_or(Value::Null))
    }

    /// The ARIA role Chromium computes for an element: its accessibility tree's, with `image`
    /// written as ARIA's `img`.
    async fn role(&self, object: &str) -> Result<String> {
        let tree = self
            .send(
                "Accessibility.getPartialAXTree",
                json!({ "objectId": object, "fetchRelatives": false }),
            )
            .await?;
        let role = tree
            .pointer("/nodes/0/role/value")
            .and_then(Value::as_str)
            .unwrap_or("");
        Ok(if role == "image" {
            "img".into()
        } else {
            role.to_string()
        })
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
            // Chromium names ARIA's `img` role `image`. Names compare as Playwright's role
            // engine compares them, after whitespace normalization.
            let role = target
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_ascii_lowercase();
            let role = if role == "img" {
                "image".to_string()
            } else {
                role
            };
            let wanted = target
                .get("name")
                .and_then(Value::as_str)
                .map(normalize_name);
            let root = self.root_backend_id().await?;
            let found = self
                .send(
                    "Accessibility.queryAXTree",
                    json!({ "backendNodeId": root, "role": role }),
                )
                .await?;
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
                .filter(|node| {
                    wanted.as_ref().is_none_or(|wanted| {
                        let name = node
                            .pointer("/name/value")
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        normalize_name(name) == *wanted
                    })
                })
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

    /// The point Playwright clicks: the middle of the element's first content quad that keeps
    /// an area after clipping to the viewport.
    async fn point(&self, object: &str) -> Result<Option<(f64, f64)>> {
        let quads = self
            .send("DOM.getContentQuads", json!({ "objectId": object }))
            .await?;
        let viewport = self
            .evaluate("({ width: innerWidth, height: innerHeight })")
            .await?;
        let limit = |key: &str| viewport.get(key).and_then(Value::as_f64).unwrap_or(0.0);
        let (width, height) = (limit("width"), limit("height"));
        let quad = quads
            .get("quads")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|quad| {
                let values: Vec<f64> = quad.as_array()?.iter().filter_map(Value::as_f64).collect();
                if values.len() != 8 {
                    return None;
                }
                let points: Vec<(f64, f64)> = values
                    .chunks(2)
                    .map(|point| (point[0].clamp(0.0, width), point[1].clamp(0.0, height)))
                    .collect();
                let area = (0..4)
                    .map(|index| {
                        let (a, b) = (points[index], points[(index + 1) % 4]);
                        (a.0 * b.1 - b.0 * a.1) / 2.0
                    })
                    .sum::<f64>()
                    .abs();
                (area > 0.99).then_some(points)
            })
            .next();
        Ok(quad.map(|points| {
            (
                points.iter().map(|point| point.0).sum::<f64>() / 4.0,
                points.iter().map(|point| point.1).sum::<f64>() / 4.0,
            )
        }))
    }

    /// Wait, with Playwright's retry intervals, until the element has the action's states
    /// (and, for pointer actions, receives the pointer). Bounded by the render deadline.
    async fn actionable(
        &self,
        name: &str,
        target: &Value,
        kind: &str,
    ) -> Result<(String, Option<(f64, f64)>)> {
        let states: &[&str] = match kind {
            "click" => &["visible", "enabled", "stable"],
            "hover" => &["visible", "stable"],
            _ => &["visible", "enabled", "editable"],
        };
        let mut object = self.target(name, target).await?;
        for attempt in 0.. {
            if attempt > 0 {
                sleep(Duration::from_millis(
                    RETRIES[(attempt - 1).min(RETRIES.len() - 1)],
                ))
                .await;
            }
            let labelled = self
                .call_on(&object, FOLLOW_LABEL, json!([]), false)
                .await?
                .pointer("/result/objectId")
                .and_then(Value::as_str)
                .map(String::from);
            let role = match &labelled {
                Some(labelled) => self.role(labelled).await?,
                None => String::new(),
            };
            let verdict = match self
                .call(
                    &object,
                    STATES,
                    json!([{ "value": states }, { "value": role }]),
                )
                .await
            {
                Ok(verdict) => verdict,
                // Playwright resolves the target again when it was replaced.
                Err(error) if format!("{error:#}").contains("not attached") => {
                    object = self.target(name, target).await?;
                    continue;
                }
                Err(error) => return Err(error),
            };
            if verdict.as_str() != Some("ok") {
                continue;
            }
            if kind == "fill" {
                return Ok((object, None));
            }
            let _ = self
                .send("DOM.scrollIntoViewIfNeeded", json!({ "objectId": object }))
                .await;
            let Some((x, y)) = self.point(&object).await? else {
                continue;
            };
            let hit = self
                .call(&object, HIT_TARGET, json!([{ "value": x }, { "value": y }]))
                .await?;
            if hit.as_bool() == Some(true) {
                return Ok((object, Some((x, y))));
            }
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
        match kind {
            "click" | "hover" => {
                let (_, point) = self.actionable(name, target, kind).await?;
                let (x, y) = point.unwrap_or_default();
                self.mouse("mouseMoved", x, y).await?;
                if kind == "click" {
                    self.mouse("mousePressed", x, y).await?;
                    self.mouse("mouseReleased", x, y).await?;
                }
            }
            "focus" => {
                let object = self.target(name, target).await?;
                self.call(&object, "function () { this.focus(); }", json!([]))
                    .await?;
            }
            _ => {
                let (object, _) = self.actionable(name, target, "fill").await?;
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

/// The color scheme and `prefers-contrast` a theme emulates: high contrast is Playwright's
/// `colorScheme: 'light'` with `contrast: 'more'`.
fn theme_media(theme: &str) -> (&'static str, &'static str) {
    match theme {
        "dark" => ("dark", "no-preference"),
        "high-contrast" => ("light", "more"),
        _ => ("light", "no-preference"),
    }
}

/// The page environment Playwright gives a new page in a context with these options.
pub async fn prepare(page: &Page<'_>, context: &Value) -> Result<Viewport> {
    let locale = context
        .get("locale")
        .and_then(Value::as_str)
        .unwrap_or("en-US");
    // Chromium accepts these once per page.
    let once = [
        ("Page.enable", json!({})),
        ("Log.enable", json!({})),
        ("Runtime.enable", json!({})),
        (
            "Emulation.setFocusEmulationEnabled",
            json!({ "enabled": true }),
        ),
        (
            "Emulation.setUserAgentOverride",
            json!({ "userAgent": "", "acceptLanguage": locale }),
        ),
        ("Emulation.setLocaleOverride", json!({ "locale": locale })),
        ("Page.setFontFamilies", font_families()),
    ];
    // Sent together, as Playwright does; Chromium applies a session's commands in order.
    futures::future::try_join_all(
        once.iter()
            .map(|(method, params)| page.send(method, params.clone())),
    )
    .await?;
    emulate(page, context).await
}

/// The viewport and media emulation. A retained story's own context is applied again with
/// this once the page has settled it; its locale is the request's.
pub async fn emulate(page: &Page<'_>, context: &Value) -> Result<Viewport> {
    let viewport: Viewport =
        serde_json::from_value(context.get("viewport").cloned().unwrap_or(Value::Null))
            .map_err(|error| anyhow!("Invalid viewport: {error}"))?;
    let theme = context
        .get("theme")
        .and_then(Value::as_str)
        .unwrap_or("light");
    // A retained story's theme is applied by its own decorators; media keep the defaults.
    let browser_default =
        context.get("themeMedia").and_then(Value::as_str) == Some("browser-default");
    let (scheme, contrast) = theme_media(if browser_default { "light" } else { theme });
    let motion = context
        .get("reducedMotion")
        .and_then(Value::as_str)
        .unwrap_or("no-preference");
    let commands = [
        (
            "Emulation.setDeviceMetricsOverride",
            json!({ "mobile": false, "width": viewport.width, "height": viewport.height, "screenWidth": viewport.width, "screenHeight": viewport.height, "deviceScaleFactor": 1, "screenOrientation": { "angle": 0, "type": "landscapePrimary" } }),
        ),
        (
            "Emulation.setEmulatedMedia",
            json!({ "media": "", "features": [
                { "name": "prefers-color-scheme", "value": scheme },
                { "name": "prefers-reduced-motion", "value": motion },
                { "name": "forced-colors", "value": "" },
                { "name": "prefers-contrast", "value": contrast }
            ] }),
        ),
    ];
    futures::future::try_join_all(
        commands
            .iter()
            .map(|(method, params)| page.send(method, params.clone())),
    )
    .await?;
    Ok(viewport)
}

/// Playwright's `normalizeWhiteSpace`: no zero-width spaces or soft hyphens, trimmed, inner
/// whitespace collapsed to one space.
fn normalize_name(name: &str) -> String {
    let stripped: String = name
        .chars()
        .filter(|c| !matches!(c, '\u{200b}' | '\u{ad}'))
        .collect();
    stripped.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::theme_media;

    #[test]
    fn high_contrast_is_the_light_scheme_with_more_contrast() {
        assert_eq!(theme_media("light"), ("light", "no-preference"));
        assert_eq!(theme_media("dark"), ("dark", "no-preference"));
        assert_eq!(theme_media("high-contrast"), ("light", "more"));
    }
}
