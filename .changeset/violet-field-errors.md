---
"@lushly-dev/violet-elements": minor
---

Add `error-text` field errors to `violet-text-field`, `violet-text-area`, `violet-checkbox`, `violet-switch` and `violet-radio` (#1385, #1586). An error message renders only while `invalid` is set (never before interaction from `required` alone, and not while disabled or readonly), showing `error-text` or—on the four form-associated controls—falling back to the browser's validation message when empty (`violet-radio` has no native input and displays only `error-text`). While shown, it replaces supporting text, exposes `part="error-message"` in the danger text colour, links to the control as its accessible description (or `aria-errormessage` on `violet-radio` when host `aria-describedby` is present) and announces with `role="alert"`.

**Migration:** `supporting-text` on `violet-text-field` and `violet-text-area` no longer turns the danger colour while `invalid`. Move error wording from `supporting-text` to `error-text` (and keep helper copy in `supporting-text`).
