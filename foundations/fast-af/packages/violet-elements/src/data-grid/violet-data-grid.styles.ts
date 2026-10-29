import { css } from "@lushly-dev/fast-element";

export const styles = css`
    :host {
        display: block;
        container-type: inline-size;
        color: var(--color-text-primary, #18181b);
        font-family: var(--violet-data-grid-font-family, "IBM Plex Sans", "Segoe UI", sans-serif);

        --_surface-page: var(--color-surface-page, #fffefa);
        --_surface-card: var(--color-surface-card, #faf9f5);
        --_surface-subtle: var(--color-surface-subtle, #f7f6f1);
        --_surface-selected: var(--color-surface-selected, #dfe8e0);
        --_control-selected-background: var(--color-control-selected-background, #dfe8e0);
        --_control-selected-foreground: var(--color-control-selected-foreground, #244635);
        --_control-selected-border: var(--color-control-selected-border, rgba(36, 70, 53, 0.22));
        --_surface-floating: var(--color-surface-floating, #ffffff);
        --_text-primary: var(--color-text-primary, #18181b);
        --_text-secondary: var(--color-text-secondary, #414651);
        --_text-muted: var(--color-text-muted, #6b7280);
        --_border-subtle: var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        --_border-strong: var(--color-border-strong, rgba(28, 26, 13, 0.35));
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_error-background: var(--color-state-danger-background, #fef2f2);
        --_error-border: var(--color-state-danger-border, #dc2626);
        --_error-text: var(--color-state-danger-text, #991b1b);
        --_active-cell-ring: var(--violet-data-grid-active-cell-ring, color-mix(in srgb, var(--_focus-ring) 82%, transparent));
        --_active-cell-ring-width: var(--violet-data-grid-active-cell-ring-width, var(--size-focus-ring-width, 2px));
        --_space-inline-sm: var(--space-inline-sm, 8px);
        --_space-inline-md: var(--space-inline-md, 12px);
        --_space-stack-xs: var(--space-stack-xs, 4px);
        --_space-stack-sm: var(--space-stack-sm, 8px);
        --_radius-md: var(--radius-md, 8px);
        --_shadow-card: var(--shadow-card, 0 1px 2px rgba(16, 24, 40, 0.08));
        /* Stacking layers. Declared here rather than inherited: an undefined
           custom property makes the z-index declaration invalid at
           computed-value time, so it is dropped and the element falls back to
           z-index auto — a sticky header then scrolls behind the rows instead
           of above them. Values match violet-token-defaults. */
        --_layer-raised: var(--z-index-raised, 1);
        --_layer-sticky: var(--z-index-sticky, 10);
        --_focus-outline-offset: 2px;
        --_type-meta-size: 0.875rem;
        --_type-cell-size: 0.9375rem;
        --_target-size-compact: var(--size-target-compact, 24px);
        --_target-size-natural: var(--size-target-natural, 32px);
        --_target-size-comfortable: var(--size-target-comfortable, 44px);
        --_row-target-size: var(--_target-size-natural);
        --_column-resizer-target-size: var(--_target-size-compact);
        --_filter-max-inline: min(24rem, 100%);
        --_toolbar-primary-column: 20rem;
        --_selection-column-size: 3.25rem;
        --_selection-control-size: 1rem;
        --_loading-min-block-size: 10rem;
        --_overlay-blur: 4px;
        --_visually-hidden-size: 1px;
        --_row-padding-inline: var(--violet-data-grid-row-padding-inline, 0.875rem);
        --_virtualized-max-block-size: var(--violet-data-grid-virtualized-max-block-size, 32rem);
    }

    :host([density="compact"]) {
        --_row-target-size: var(--_target-size-compact);
        --_row-padding-inline: var(--violet-data-grid-row-padding-inline-compact, 0.875rem);
    }

    :host([density="comfortable"]) {
        --_row-target-size: var(--_target-size-comfortable);
        --_row-padding-inline: var(--violet-data-grid-row-padding-inline-comfortable, 1rem);
    }

    :host(:focus-visible) {
        outline: 2px solid var(--_focus-ring);
        outline-offset: var(--_focus-outline-offset);
    }

    :host([busy]) .table-scroll {
        cursor: progress;
    }

    .grid-shell {
        display: grid;
        gap: var(--_space-stack-sm);
        min-inline-size: 0;
        min-block-size: 0;
        block-size: 100%;
    }

    .toolbar {
        display: grid;
        gap: var(--_space-inline-sm);
        align-items: start;
    }

    .toolbar-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--_space-inline-sm);
        color: var(--_text-secondary);
        font-size: var(--_type-meta-size);
    }

    .toolbar-slot {
        display: flex;
        flex-wrap: wrap;
        gap: var(--_space-inline-sm);
    }

    .filter-shell {
        display: grid;
        max-inline-size: var(--_filter-max-inline);
    }

    .filter-field {
        inline-size: 100%;
    }

    .table-region {
        position: relative;
        min-inline-size: 0;
        min-block-size: 0;
    }

    .edit-status {
        position: absolute;
        z-index: var(--_layer-sticky);
        inset-block-start: var(--_space-stack-xs);
        inset-inline-end: var(--_space-inline-sm);
        max-inline-size: min(24rem, calc(100% - (var(--_space-inline-sm) * 2)));
        padding: var(--_space-stack-xs) var(--_space-inline-sm);
        border: 1px solid var(--_error-border);
        border-radius: calc(var(--_radius-md) / 2);
        background: var(--_error-background);
        color: var(--_error-text);
        box-shadow: var(--_shadow-card);
        font-size: 0.8125rem;
        line-height: 1.35;
        pointer-events: none;
    }

    .edit-status:empty {
        display: none;
    }

    .table-scroll {
        box-sizing: border-box;
        max-inline-size: 100%;
        min-inline-size: 0;
        overflow: auto;
        border: 1px solid var(--_border-subtle);
        border-radius: calc(var(--_radius-md) - 2px);
        background: var(--_surface-card);
        scrollbar-color: color-mix(in srgb, var(--_border-strong) 65%, transparent) transparent;
        outline: none;
    }

    .table-scroll:focus-visible {
        box-shadow: 0 0 0 2px var(--_focus-ring);
    }

    :host([virtualize]) .table-scroll {
        block-size: 100%;
        max-block-size: var(--_virtualized-max-block-size);
        overflow-anchor: none;
    }

    .table-canvas {
        min-inline-size: 100%;
        overflow: visible;
    }

    :host([virtualize]) .table-canvas {
        min-block-size: calc(var(--_virtual-total-size, 0px) + var(--_row-target-size));
    }

    .table-scroll::-webkit-scrollbar {
        inline-size: 0.625rem;
        block-size: 0.625rem;
    }

    .table-scroll::-webkit-scrollbar-track {
        background: transparent;
    }

    .table-scroll::-webkit-scrollbar-thumb {
        background: color-mix(in srgb, var(--_border-strong) 72%, transparent);
        border-radius: 999px;
        border: 2px solid transparent;
        background-clip: padding-box;
    }

    .table-scroll::-webkit-scrollbar-corner {
        background: transparent;
    }

    .table-full-table {
        min-inline-size: 100%;
        inline-size: max-content;
        border-collapse: separate;
        border-spacing: 0;
        table-layout: fixed;
    }

    thead {
        background: var(--_surface-subtle);
    }

    :host([sticky-header]) .table-full-table thead th {
        position: sticky;
        inset-block-start: 0;
        z-index: var(--_layer-raised);
        background: var(--_surface-subtle);
    }

    th,
    td {
        box-sizing: border-box;
        block-size: var(--_row-target-size);
        border-block-end: 1px solid var(--_border-subtle);
        padding-inline: var(--_row-padding-inline);
        padding-block: 0;
        text-align: start;
        vertical-align: middle;
    }

    tbody tr:last-of-type td {
        border-block-end: none;
    }

    .virtual-spacer-row,
    .virtual-spacer-row td {
        padding: 0;
        border: 0;
        background: transparent;
        overflow-anchor: none;
    }

    .virtual-spacer-row td {
        min-block-size: 0;
    }

    th {
        color: var(--_text-secondary);
        font-size: var(--_type-meta-size);
        font-weight: 600;
        position: relative;
    }

    th[data-column-id] {
        padding-inline-end: var(--_column-resizer-target-size);
    }

    th:not(:last-child),
    td:not(:last-child) {
        border-inline-end: 1px solid var(--_border-subtle);
    }

    .header-button {
        display: inline-flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--_space-inline-sm);
        inline-size: 100%;
        block-size: 100%;
        padding: 0;
        padding-inline-end: calc(var(--_space-inline-sm) + 0.5rem);
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: inherit;
        cursor: pointer;
    }

    .header-button:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: var(--_focus-outline-offset);
        border-radius: calc(var(--_radius-md) / 2);
    }

    th[tabindex]:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: -2px;
    }

    .header-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .sort-indicator {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: var(--_selection-control-size);
        block-size: var(--_selection-control-size);
        color: var(--_text-muted);
        flex: 0 0 auto;
        transition:
            opacity 120ms ease,
            color 120ms ease;
    }

    .sort-indicator[data-sorted="false"] {
        opacity: 0;
        color: color-mix(in srgb, var(--_text-muted) 72%, var(--_surface-card));
    }

    th:hover .sort-indicator[data-sorted="false"],
    .header-button:hover .sort-indicator[data-sorted="false"],
    .header-button:focus-visible .sort-indicator[data-sorted="false"] {
        opacity: 1;
    }

    .column-resizer {
        position: absolute;
        inset-block: 0;
        inset-inline-end: 0;
        box-sizing: border-box;
        inline-size: var(--_column-resizer-target-size);
        padding: 0;
        border: none;
        background: transparent;
        cursor: col-resize;
        touch-action: none;
        z-index: var(--_layer-sticky);
    }

    .column-resizer::before {
        content: "";
        position: absolute;
        inset-block: 0;
        inset-inline-end: 0;
        inline-size: 1px;
        background: color-mix(in srgb, var(--_border-strong) 58%, transparent);
        opacity: 0;
        transition: opacity 120ms ease;
    }

    th:hover .column-resizer::before,
    .column-resizer:focus-visible::before {
        opacity: 1;
    }

    .column-resizer:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: 1px;
        border-radius: 999px;
    }

    td {
        background: var(--_surface-page);
        color: var(--_text-primary);
        font-size: var(--_type-cell-size);
        position: relative;
        user-select: text;
        -webkit-user-select: text;
    }

    :host([focus-mode="cell"]) td {
        user-select: none;
        -webkit-user-select: none;
    }

    td[data-selected="true"] {
        background: color-mix(in srgb, var(--_surface-selected) 48%, var(--_surface-page));
    }

    td[data-fill-preview="true"] {
        background: color-mix(in srgb, var(--_surface-selected) 62%, var(--_surface-page));
    }

    td[data-active="true"]::after {
        content: "";
        position: absolute;
        inset: calc(-1 * var(--_active-cell-ring-width));
        pointer-events: none;
        z-index: var(--_layer-raised);
        border: var(--_active-cell-ring-width) solid var(--_active-cell-ring);
        box-sizing: border-box;
    }

    td[data-active="true"] {
        background: color-mix(in srgb, var(--_surface-selected) 70%, var(--_surface-page));
    }

    .fill-handle {
        position: absolute;
        inset-inline-end: -3px;
        inset-block-end: -3px;
        inline-size: 6px;
        block-size: 6px;
        border: 1px solid var(--_active-cell-ring);
        border-radius: 2px;
        background: var(--_surface-card);
        cursor: crosshair;
        box-shadow: 0 0 0 1px var(--_surface-card);
        z-index: var(--_layer-sticky);
    }

    .cell-content {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .cell-widget {
        display: inline-grid;
        align-items: center;
        justify-items: start;
        inline-size: 100%;
        min-inline-size: 0;
    }

    .cell-sizing-content {
        display: block;
        visibility: hidden;
        pointer-events: none;
    }

    .cell-widget[data-align="center"] {
        justify-items: center;
    }

    .cell-checkbox {
        display: inline-grid;
        inline-size: var(--_selection-control-size);
        block-size: var(--_selection-control-size);
        line-height: 0;
        --violet-checkbox-inline-target-size: var(--_selection-control-size);
    }

    .cell-radio {
        display: inline-grid;
        inline-size: var(--_selection-control-size);
        block-size: var(--_selection-control-size);
        line-height: 0;
        --violet-radio-inline-target-size: var(--_selection-control-size);
        --violet-radio-inline-gap: 0;
    }

    .cell-editor {
        position: absolute;
        inset-inline-start: var(--_row-padding-inline);
        inset-inline-end: var(--_row-padding-inline);
        inset-block-start: 50%;
        transform: translateY(-50%);
        display: block;
        box-sizing: border-box;
        inline-size: auto;
        min-inline-size: 0;
        max-inline-size: calc(100% - (var(--_row-padding-inline) * 2));
        padding: 0;
        border: none;
        background: transparent;
        color: var(--_text-primary);
        font: inherit;
        line-height: inherit;
        text-align: inherit;
        outline: none;
        appearance: none;
    }

    violet-data-grid-pill-select.cell-editor {
        inset-inline-start: var(--_row-padding-inline);
        inset-inline-end: auto;
        inset-block-start: 50%;
        transform: translateY(-50%);
        display: inline-grid;
        inline-size: fit-content;
        max-inline-size: calc(100% - (var(--_row-padding-inline) * 2));
        justify-self: start;
        z-index: var(--_layer-raised);
    }

    input.cell-editor[type="number"] {
        appearance: textfield;
        -moz-appearance: textfield;
    }

    input.cell-editor[type="number"]::-webkit-outer-spin-button,
    input.cell-editor[type="number"]::-webkit-inner-spin-button {
        margin: 0;
        -webkit-appearance: none;
    }

    .cell-editor:focus {
        outline: none;
    }

    .cell-editor-error {
        position: absolute;
        z-index: var(--_layer-sticky);
        inset-inline-start: var(--_row-padding-inline);
        inset-block-start: calc(100% - var(--_space-stack-xs));
        max-inline-size: calc(100% - (var(--_row-padding-inline) * 2));
        padding: 2px var(--_space-stack-xs);
        border: 1px solid var(--_error-border);
        border-radius: calc(var(--_radius-md) / 2);
        background: var(--_error-background);
        color: var(--_error-text);
        box-shadow: var(--_shadow-card);
        font-size: 0.75rem;
        line-height: 1.25;
        white-space: normal;
    }

    .selection-cell,
    .selection-header {
        inline-size: var(--_selection-column-size);
        padding-inline: 0;
        line-height: 0;
        text-align: center;
    }

    .selection-control {
        inline-size: var(--_selection-control-size);
        block-size: var(--_selection-control-size);
        accent-color: var(--_control-selected-foreground);
        user-select: auto;
        -webkit-user-select: auto;
    }

    .selection-checkbox {
        display: block;
        inline-size: var(--_selection-control-size);
        block-size: var(--_selection-control-size);
        line-height: 0;
        justify-self: center;
        --violet-checkbox-inline-target-size: var(--_selection-control-size);
        user-select: auto;
        -webkit-user-select: auto;
    }

    .selection-radio {
        display: block;
        inline-size: var(--_selection-control-size);
        block-size: var(--_selection-control-size);
        line-height: 0;
        justify-self: center;
        --violet-radio-inline-target-size: var(--_selection-control-size);
        --violet-radio-inline-gap: 0;
        user-select: auto;
        -webkit-user-select: auto;
    }

    tbody tr[data-selected="true"] {
        background: var(--_surface-selected);
    }

    tbody tr[data-selected="true"] td {
        color: var(--_text-primary);
    }

    .loading-state,
    .empty-state {
        display: grid;
        place-items: center;
        gap: var(--_space-stack-xs);
        min-block-size: var(--_loading-min-block-size);
        padding: calc(var(--_row-padding-inline) * 1.5);
        text-align: center;
        color: var(--_text-secondary);
        background: var(--_surface-card);
    }

    .loading-overlay {
        position: absolute;
        inset: 1px;
        display: grid;
        place-items: center;
        padding: var(--_space-inline-md);
        border-radius: calc(var(--_radius-md) - 2px);
        background: var(--violet-data-grid-loading-overlay-background, rgba(250, 249, 245, 0.58));
        color: var(--_text-secondary);
        backdrop-filter: blur(calc(var(--_overlay-blur) * 1.75));
        -webkit-backdrop-filter: blur(calc(var(--_overlay-blur) * 1.75));
    }

    .default-slot {
        display: contents;
    }

    .visually-hidden {
        position: absolute;
        inline-size: var(--_visually-hidden-size);
        block-size: var(--_visually-hidden-size);
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }

    th[data-align="center"],
    td[data-align="center"] {
        text-align: center;
    }

    th[data-align="end"],
    td[data-align="end"] {
        text-align: end;
    }

    @container (min-width: 48rem) {
        .toolbar {
            grid-template-columns: minmax(0, var(--_toolbar-primary-column)) minmax(0, 1fr);
            align-items: end;
        }

        .toolbar-meta {
            justify-content: flex-end;
        }
    }
`;
