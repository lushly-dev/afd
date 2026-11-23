//! Page-level pointing helpers (`specimen-point`, `specimen-point-move`, `specimen-point-check`):
//! positional element ref resolution and bounded visible-text / slotted-parent extraction.

use crate::page::{Page, TargetError, describe_target};
use anyhow::Result;
use serde_json::{Value, json};

/// Compute the positional Specimen element ref for `this` relative to `#specimen-root`,
/// matching `captureDocument` in `src/browser/capture.ts`.
const ELEMENT_REF_FN: &str = r#"function () {
    if (!this || this.nodeType !== 1) return null;
    const root = document.querySelector('#specimen-root');
    if (!root) return null;
    if (this === root) return 'root';
    const segments = [];
    let current = this;
    while (current && current !== root) {
        const parent = current.parentNode;
        if (!parent) return null;
        let index = 0;
        for (const sibling of parent.children) {
            if (sibling.localName === current.localName) index++;
            if (sibling === current) break;
        }
        segments.push(`${current.localName}:${index}`);
        if (parent.nodeType === 11 && parent.host) {
            segments.push('shadow');
            current = parent.host;
        } else if (parent.nodeType === 1) {
            current = parent;
        } else {
            return null;
        }
    }
    if (current !== root) return null;
    segments.push('root');
    return segments.reverse().join('/');
}"#;

/// Collect normalized visible text (truncated to 200 code points, skipping hidden subtrees and
/// piercing open shadow roots/slots, memoized per element) and slotted composed parents keyed by
/// positional Specimen element ref under `#specimen-root`.
const ELEMENT_POINT_META_EXPR: &str = r#"(() => {
    const root = document.querySelector('#specimen-root');
    if (!root) return { texts: {}, slottedParents: {} };
    const refs = new Map();
    const visitRefs = (parent, prefix) => {
        const counts = new Map();
        for (const child of parent.children) {
            const count = (counts.get(child.localName) || 0) + 1;
            counts.set(child.localName, count);
            const ref = `${prefix}/${child.localName}:${count}`;
            refs.set(child, ref);
            if (child.shadowRoot) visitRefs(child.shadowRoot, `${ref}/shadow`);
            visitRefs(child, ref);
        }
    };
    if (root.shadowRoot) visitRefs(root.shadowRoot, 'root/shadow');
    visitRefs(root, 'root');

    const slottedParents = {};
    for (const [el, ref] of refs) {
        if (el.assignedSlot) {
            const slotRef = refs.get(el.assignedSlot);
            if (slotRef) slottedParents[ref] = slotRef;
        }
    }

    const clamp = (raw) => {
        const normalized = raw.replace(/\s+/g, ' ').trim();
        const chars = Array.from(normalized);
        return chars.length <= 200 ? normalized : chars.slice(0, 200).join('');
    };
    const memo = new Map();
    const textOf = (el) => {
        const cached = memo.get(el);
        if (cached !== undefined) return cached;
        if (
            el.getAttribute('aria-hidden') === 'true' ||
            el.hasAttribute('hidden') ||
            el.localName === 'style' ||
            el.localName === 'script'
        ) {
            memo.set(el, '');
            return '';
        }
        const style = getComputedStyle(el);
        if (style.display === 'none') {
            memo.set(el, '');
            return '';
        }
        const selfHidden = style.visibility === 'hidden';
        const parts = [];
        let approxChars = 0;
        const pushPart = (text) => {
            if (!text || approxChars > 220) return;
            const normalized = text.replace(/\s+/g, ' ').trim();
            if (!normalized) return;
            parts.push(normalized);
            approxChars += normalized.length;
        };
        const children =
            el.localName === 'slot'
                ? el.assignedNodes({ flatten: true })
                : el.shadowRoot
                    ? el.shadowRoot.childNodes
                    : el.childNodes;
        for (const child of children) {
            if (approxChars > 220) break;
            if (child.nodeType === 3) {
                if (!selfHidden) pushPart(child.textContent || '');
            } else if (child.nodeType === 1) {
                pushPart(textOf(child));
            }
        }
        const result = clamp(parts.join(' '));
        memo.set(el, result);
        return result;
    };

    const texts = {};
    for (const [el, ref] of refs) {
        texts[ref] = textOf(el);
    }
    return { texts, slottedParents };
})()"#;

impl Page<'_> {
    /// Resolve an anonymous point target (`{ selector }` or `{ role, name? }`) to its positional
    /// Specimen ref under `#specimen-root`, surfacing `TARGET_NOT_FOUND` or `TARGET_AMBIGUOUS`.
    pub async fn target_ref(&self, target: &Value) -> Result<String> {
        let object = self.target("", target).await?;
        let reference = self.call(&object, ELEMENT_REF_FN, json!([])).await?;
        match reference.as_str() {
            Some(ref_str) if ref_str != "root" => Ok(ref_str.to_string()),
            _ => Err(TargetError::NotFound {
                name: String::new(),
                target: describe_target(target),
            }
            .into()),
        }
    }

    /// Collect normalized visible text (capped at 200 code points) and slotted composed parents
    /// keyed by positional ref under `#specimen-root`.
    pub async fn point_meta(&self) -> Result<(Value, Value)> {
        let value = self.evaluate(ELEMENT_POINT_META_EXPR).await?;
        let texts = value.get("texts").cloned().unwrap_or_else(|| json!({}));
        let slotted = value
            .get("slottedParents")
            .cloned()
            .unwrap_or_else(|| json!({}));
        Ok((texts, slotted))
    }
}
