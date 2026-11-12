# violet-elements pack: gaps

Written by `node scripts/pack-gaps.mjs` from the committed records in this directory; do not edit.
This is the backlog of guidance and evidence the pack does not have yet. `pnpm test:stories`
fails when it is not the report the records give.

- **Components:** 77, 46 with a guide.
- **Statements:** 226 in component guides, 2 verified by a claim's check.

| Gap | Components |
| --- | --- |
| No summary | 31 |
| No usage statement | 31 |
| No accessibility statement | 31 |
| No role, observed or authored | 64 |
| No example that mounts again on its own | 3 |
| An attribute no case showed set | 28 |
| A slot no case showed filled or empty | 0 |

## By component

| Component | Missing | Attributes no case showed | Slots no case showed |
| --- | --- | --- | --- |
| `violet-accordion-item` | - | `heading-level` | - |
| `violet-accordion` | role | - | - |
| `violet-alert` | role | - | - |
| `violet-approval-card` | summary, usage, a11y-statement, role | - | - |
| `violet-badge` | role | - | - |
| `violet-breadcrumb` | role | - | - |
| `violet-button` | role | `aria-pressed` | - |
| `violet-calendar` | summary, usage, a11y-statement, role | - | - |
| `violet-card` | role | - | - |
| `violet-carousel` | summary, usage, a11y-statement, role | - | - |
| `violet-chat-composer` | summary, usage, a11y-statement, role | `label` | - |
| `violet-chat-suggestions` | summary, usage, a11y-statement, role | - | - |
| `violet-checkbox` | role | - | - |
| `violet-color-picker` | - | `invalid`, `size` | - |
| `violet-color-swatch` | summary, usage, a11y-statement, role | - | - |
| `violet-combobox` | - | `value` | - |
| `violet-conversation-thread` | summary, usage, a11y-statement, role | - | - |
| `violet-data-grid-attachment-cell` | summary, usage, a11y-statement, role | - | - |
| `violet-data-grid-multi-picker` | summary, usage, a11y-statement, role | - | - |
| `violet-data-grid-persona-picker` | summary, usage, a11y-statement, role, example | - | - |
| `violet-data-grid-pill-select` | summary, usage, a11y-statement, role | `error-announcement`, `invalid` | - |
| `violet-data-grid-rating` | summary, usage, a11y-statement, role | - | - |
| `violet-data-grid-reference-picker` | summary, usage, a11y-statement, role | - | - |
| `violet-data-grid` | summary, usage, a11y-statement, role | `selection-label`, `sort-mode` | - |
| `violet-date-picker` | - | `open` | - |
| `violet-date-range-picker` | summary, usage, a11y-statement, role | `open` | - |
| `violet-dialog` | - | `no-backdrop`, `open`, `padding` | - |
| `violet-divider` | role | - | - |
| `violet-empty-state` | role | - | - |
| `violet-file-explorer` | summary, usage, a11y-statement, role, example | `load-error` | - |
| `violet-file-upload` | - | `invalid`, `required`, `size` | - |
| `violet-gantt` | summary, usage, a11y-statement, role | `aria-label`, `locale` | - |
| `violet-icon-button` | role | `type` | - |
| `violet-icon` | role | - | - |
| `violet-image` | summary, usage, a11y-statement, role | `loading` | - |
| `violet-listbox` | role | - | - |
| `violet-menu-item` | role | - | - |
| `violet-message-media` | summary, usage, a11y-statement, role | - | - |
| `violet-message-status` | summary, usage, a11y-statement, role | - | - |
| `violet-message-text` | summary, usage, a11y-statement, role | - | - |
| `violet-message` | summary, usage, a11y-statement, role | - | - |
| `violet-pagination` | summary, usage, a11y-statement, role | `boundary-count` | - |
| `violet-persona` | summary, usage, a11y-statement, role | - | - |
| `violet-popover` | role | - | - |
| `violet-progress` | role | - | - |
| `violet-radio-group` | role | `error-text`, `required` | - |
| `violet-radio` | role | - | - |
| `violet-range-slider` | role | `max`, `min`, `required` | - |
| `violet-reasoning-block` | summary, usage, a11y-statement, role | - | - |
| `violet-segment` | role | - | - |
| `violet-segmented-control` | role | - | - |
| `violet-skeleton` | role | - | - |
| `violet-slider` | role | `min`, `required` | - |
| `violet-snackbar` | summary, usage, a11y-statement, role | `announcement` | - |
| `violet-source-citation` | summary, usage, a11y-statement, role | `source-id` | - |
| `violet-spinner` | role | - | - |
| `violet-switch` | role | - | - |
| `violet-tab-panel` | role | - | - |
| `violet-tabs` | role, example | - | - |
| `violet-teaching-tip` | summary, usage, a11y-statement, role | - | - |
| `violet-text-area` | role | `maxlength` | - |
| `violet-text-field` | role | `autocomplete`, `inputmode`, `max`, `maxlength`, `min`, `minlength`, `pattern`, `step` | - |
| `violet-text` | summary, usage, a11y-statement, role | - | - |
| `violet-theme` | role | - | - |
| `violet-time-picker` | role | `size` | - |
| `violet-toast` | role | `announcement`, `dismissible` | - |
| `violet-tool-call-card` | summary, usage, a11y-statement, role | `tool-call-id` | - |
| `violet-tool-result-card` | summary, usage, a11y-statement, role | - | - |
| `violet-tooltip` | - | `anchor`, `open` | - |
| `violet-tree-item` | role | - | - |
| `violet-tree` | role | `error-text` | - |
