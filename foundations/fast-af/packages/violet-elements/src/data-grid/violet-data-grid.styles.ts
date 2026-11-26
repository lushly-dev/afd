import { css } from "@lushly-dev/fast-element";

export const styles = css`
    :host {
        display: block;
        container-type: inline-size;
        color: var(--violet-color-text-primary, #181b1a);
        font-family: var(--violet-data-grid-font-family, var(--violet-font-family, var(--violet-font-family-body)));

        --_surface-page: var(--violet-color-surface-page, #f4f0ea);
        --_surface-card: var(--violet-color-surface-card, #f8f9f3);
        --_surface-subtle: var(--violet-color-surface-subtle, #e9e5de);
        --_surface-selected: var(--violet-color-surface-selected, #dfecf4);
        --_control-selected-background: var(--violet-color-control-selected-background, #c0daeb);
        --_control-selected-foreground: var(--violet-color-control-selected-foreground, #1b5f80);
        --_control-selected-border: var(--violet-color-control-selected-border, rgba(27, 95, 128, 0.5));
        --_surface-floating: var(--violet-color-surface-floating, #ffffff);
        --_text-primary: var(--violet-color-text-primary, #181b1a);
        --_text-secondary: var(--violet-color-text-secondary, #48534b);
        --_text-muted: var(--violet-color-text-muted, #5e6460);
        --_border-subtle: var(--violet-color-border-subtle, rgba(24, 27, 26, 0.10));
        --_border-strong: var(--violet-color-border-strong, #6b7d6e);
        --_focus-ring: var(--violet-color-focus-ring, #28769e);
        --_error-background: var(--violet-color-state-danger-background, #f7e4df);
        --_error-border: var(--violet-color-state-danger-border, transparent);
        --_error-text: var(--violet-color-state-danger-text, #c42a1a);
        --_active-cell-ring: var(--violet-data-grid-active-cell-ring, color-mix(in srgb, var(--_focus-ring) 82%, transparent));
        --_active-cell-ring-width: var(--violet-data-grid-active-cell-ring-width, var(--violet-size-focus-ring-width, 2px));
        --_space-inline-sm: var(--violet-space-inline-tight, 4px);
        --_space-inline-md: var(--violet-space-inline-group, 8px);
        --_space-stack-xs: var(--violet-space-stack-tight, 4px);
        --_space-stack-sm: var(--violet-space-stack-group, 8px);
        --_radius-md: var(--violet-radius-control, 8px);
        --_shadow-card: var(--violet-shadow-card, 0 0 0 1px rgba(24, 27, 26, 0.06), 0 1px 2px rgba(24, 27, 26, 0.06), 0 4px 10px -2px rgba(24, 27, 26, 0.06));
        /* Stacking layers. Declared here rather than inherited: an undefined
           custom property makes the z-index declaration invalid at
           computed-value time, so it is dropped and the element falls back to
           z-index auto — a sticky header then scrolls behind the rows instead
           of above them. Values match violet-token-defaults. */
        --_layer-raised: var(--violet-z-index-raised, 1);
        --_layer-sticky: var(--violet-z-index-sticky, 10);
        --_focus-outline-offset: 2px;
        --_type-meta-size: 0.875rem;
        --_type-cell-size: 0.9375rem;
        --_target-size-compact: var(--violet-size-target-compact, 24px);
        --_target-size-natural: var(--violet-size-target-natural, 32px);
        --_target-size-comfortable: var(--violet-size-target-comfortable, 44px);
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

    .fill-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--_space-inline-sm);
    }

    .fill-status {
        align-self: center;
        color: var(--_text-secondary);
        font-size: var(--_type-meta-size);
    }

    .fill-action {
        min-inline-size: 24px;
        min-block-size: 32px;
        padding: var(--_space-stack-xs) var(--_space-inline-md);
        border: 1px solid var(--_border-strong);
        border-radius: var(--_radius-md);
        background: var(--_surface-card);
        color: var(--_text-primary);
        font: inherit;
        font-size: var(--_type-meta-size);
        cursor: pointer;
    }

    .fill-action:disabled {
        color: var(--_text-muted);
        cursor: default;
    }

    .fill-action:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: var(--_focus-outline-offset);
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
        --_virtual-total-size: 0px;
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

    td[tabindex]:focus {
        outline: none;
    }

    td[tabindex]:focus-visible::after {
        border-color: var(--_focus-ring);
    }

    td[data-active="true"] {
        background: color-mix(in srgb, var(--_surface-selected) 70%, var(--_surface-page));
    }

    /* Keep the 24px target inside the corner cell, including at scroll edges. */
    .fill-handle {
        position: absolute;
        inset-inline-end: 0;
        inset-block-end: 0;
        inline-size: 24px;
        block-size: 24px;
        touch-action: none;
        cursor: crosshair;
        z-index: var(--_layer-sticky);
    }

    .fill-handle::after {
        content: "";
        position: absolute;
        inset-inline-end: -3px;
        inset-block-end: -3px;
        inline-size: 6px;
        block-size: 6px;
        border: 1px solid var(--_active-cell-ring);
        border-radius: 2px;
        background: var(--_surface-card);
        pointer-events: none;
        box-shadow: 0 0 0 1px var(--_surface-card);
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

    .cell-editor-hint {
        box-sizing: border-box;
        position: absolute;
        /* Above the fill handle, which shares the sticky layer. */
        z-index: calc(var(--_layer-sticky) + 1);
        inset-inline-start: var(--_row-padding-inline);
        inset-block-start: calc(100% - var(--_space-stack-xs));
        /* A sentence rather than a word: wider than the edit error, still bounded. */
        inline-size: max-content;
        max-inline-size: 18rem;
        overflow-y: auto;
        padding: 2px var(--_space-stack-xs);
        border: 1px solid var(--_border-strong);
        border-radius: calc(var(--_radius-md) / 2);
        background: var(--_surface-floating);
        color: var(--_text-primary);
        box-shadow: var(--_shadow-card);
        font-size: 0.75rem;
        line-height: 1.25;
        white-space: normal;
    }

    .cell-editor-error {
        box-sizing: border-box;
        position: absolute;
        z-index: calc(var(--_layer-sticky) + 1);
        inset-inline-start: var(--_row-padding-inline);
        inset-block-start: calc(100% - var(--_space-stack-xs));
        max-inline-size: calc(100% - (var(--_row-padding-inline) * 2));
        overflow-y: auto;
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

    .cell-editor-hint[data-placement="above"],
    .cell-editor-error[data-placement="above"] {
        inset-block-start: auto;
        inset-block-end: calc(100% - var(--_space-stack-xs));
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
        background: var(
            --violet-data-grid-loading-overlay-background,
            color-mix(in srgb, var(--_surface-card) 58%, transparent)
        );
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

    /*
     * Forced colours drop background tints, so selection, the active cell and focus are drawn
     * with system colours: selected cells and rows take Highlight, the active cell keeps Canvas
     * inside a Highlight ring, and the focused cell adds an inner Highlight outline. This block
     * is last so it outranks the tinted rules above. A custom cell template that renders text in a
     * \`.cell-content\` element gets the same backplate opt-out as the default one.
     */
    @media (forced-colors: active) {
        td[data-selected="true"],
        td[data-fill-preview="true"],
        tbody tr[data-selected="true"] td {
            background-color: Highlight;
            color: HighlightText;
        }

        /*
         * Forced colours paint a Canvas backplate behind text, which would hide HighlightText on
         * Highlight, so the plain cell text opts out and inherits the cell's system colours.
         */
        td[data-selected="true"] .cell-content,
        td[data-fill-preview="true"] .cell-content,
        tbody tr[data-selected="true"] td .cell-content {
            forced-color-adjust: none;
        }

        tbody tr td[data-active="true"] {
            background-color: Canvas;
            color: CanvasText;
        }

        tbody tr td[data-active="true"] .cell-content {
            forced-color-adjust: auto;
        }

        /* The row's checkbox already shows it is selected; on Highlight, a checked box would lose its edge. */
        tbody tr[data-selected="true"] td.selection-cell {
            background-color: Canvas;
            color: CanvasText;
        }

        td[data-active="true"]::after,
        td[tabindex]:focus-visible::after {
            border-color: Highlight;
        }

        td[tabindex]:focus-visible {
            outline: 2px solid Highlight;
            outline-offset: -2px;
        }

        .column-resizer::before {
            background: CanvasText;
        }

        /* Its focus ring is a box-shadow, which forced colours drop. */
        .table-scroll:focus-visible {
            outline: 2px solid Highlight;
            outline-offset: -2px;
        }
    }
`;
