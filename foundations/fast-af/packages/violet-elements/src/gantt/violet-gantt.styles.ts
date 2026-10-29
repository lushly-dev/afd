import { css } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

export const violetGanttStyles = css`
  ${violetSurfaceTokenDefaults}

  :host {
    display: block;
    min-block-size: 0;
    block-size: 100%;
    container-type: inline-size;

    --_gantt-name-width: var(--violet-gantt-name-column-width, 16rem);
    --_gantt-row-height: 64px;
    --_gantt-header-height: 52px;
    --_gantt-work: var(--violet-gantt-work-background, #526b4e);
    --_gantt-work-text: var(--violet-gantt-work-foreground, #ffffff);
    --_gantt-window: var(--violet-gantt-window-background, #dde7da);
    --_gantt-window-text: var(--violet-gantt-window-foreground, #253823);
    --_gantt-actual: var(--violet-gantt-actual-border, #186f83);
    --_gantt-advisory: var(--violet-gantt-advisory-border, #9a6700);
    --_gantt-selection: var(--violet-gantt-selection-ring, #4b67b0);
    --_gantt-axis-size: var(--type-label-sm-size, 12px);
    --_gantt-axis-line: var(--type-label-sm-line, 16px);
    --_gantt-content-size: var(--violet-control-type-size, 13px);
    --_gantt-content-line: var(--type-label-sm-line, 16px);
    --_gantt-type-weight: var(--type-label-sm-weight, 500);
    --_gantt-expander-width: 24px;
    --_gantt-tree-gap: calc(var(--_space-sm) / 2);
  }

  :host([density="compact"]) {
    --_gantt-row-height: 36px;
  }

  :host([density="comfortable"]) {
    --_gantt-row-height: 76px;
  }

  .root {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    block-size: 100%;
    min-block-size: 0;
    overflow: hidden;
    border: 1px solid var(--_border-subtle);
    border-radius: var(--_radius-md);
    background: var(--_surface-card);
    color: var(--_text-primary);
    --_gantt-name-width: var(--violet-gantt-name-column-width, 16rem);
  }

  .toolbar[hidden] {
    display: none;
  }

  .toolbar {
    padding: var(--_space-sm);
    border-block-end: 1px solid var(--_border-subtle);
    background: var(--_surface-card);
  }

  .viewport {
    grid-row: 2;
    position: relative;
    min-block-size: 0;
    overflow: auto;
    overscroll-behavior: contain;
    background: var(--_surface-page);
    scrollbar-gutter: stable;
    direction: ltr;
  }

  .grid {
    position: relative;
    min-inline-size: 100%;
  }

  .header,
  .row {
    display: grid;
    grid-template-columns: var(--_gantt-name-width) minmax(0, 1fr);
    min-inline-size: max-content;
  }

  .header {
    position: sticky;
    inset-block-start: 0;
    z-index: var(--_layer-sticky);
    block-size: var(--_gantt-header-height);
    background: var(--_surface-card);
    border-block-end: 1px solid var(--_border-subtle);
  }

  .name-header,
  .row-header {
    position: sticky;
    left: 0;
    z-index: var(--_layer-raised);
    box-sizing: border-box;
    inline-size: var(--_gantt-name-width);
    background: var(--_surface-card);
    border-inline-end: 1px solid var(--_border-subtle);
  }

  .name-header {
    display: flex;
    align-items: center;
    padding-inline: calc(
        var(--_space-sm) + var(--_gantt-expander-width) + var(--_gantt-tree-gap)
      )
      var(--_space-sm);
    font-size: var(--_gantt-axis-size);
    font-weight: var(--_gantt-type-weight);
    line-height: var(--_gantt-axis-line);
    color: var(--_text-secondary);
  }

  .time-header,
  .chart {
    position: relative;
    direction: ltr;
    inline-size: var(--_gantt-chart-width);
    min-inline-size: var(--_gantt-chart-width);
  }

  .axis-context {
    position: absolute;
    inset-block-start: 4px;
    inset-inline-start: var(--_axis-context-left);
    z-index: 1;
    min-inline-size: 10rem;
    color: var(--_text-secondary);
    font-size: var(--_gantt-axis-size);
    font-weight: var(--_gantt-type-weight);
    line-height: var(--_gantt-axis-line);
    white-space: nowrap;
    pointer-events: none;
  }

  .day {
    position: absolute;
    inset-block: 26px 0;
    inset-inline-start: var(--_day-left);
    box-sizing: border-box;
    inline-size: var(--_day-width);
    overflow: visible;
    color: var(--_text-primary);
    font-size: var(--_gantt-axis-size);
    font-weight: var(--_gantt-type-weight);
    line-height: var(--_gantt-axis-line);
    white-space: nowrap;
  }

  .day.grid-boundary {
    box-shadow: inset 1px 0 0 var(--_border-subtle);
  }

  .day-label {
    display: block;
    box-sizing: border-box;
    inline-size: var(--_day-label-width);
    overflow: hidden;
    padding: 3px min(4px, calc(var(--_day-label-width) / 2));
    text-overflow: ellipsis;
  }

  .day-label:empty {
    display: none;
  }

  .body {
    position: relative;
    block-size: var(--_gantt-body-height);
    min-inline-size: max-content;
  }

  .body-grid {
    position: absolute;
    inset-block: 0;
    inset-inline-start: var(--_gantt-name-width);
    inline-size: var(--_gantt-chart-width);
    overflow: hidden;
    pointer-events: none;
  }

  .grid-line {
    position: absolute;
    inset-block: 0;
    inset-inline-start: var(--_grid-left);
    border-inline-start: 1px solid var(--_border-subtle);
  }

  .grid-line[hidden] {
    display: none;
  }

  .row {
    position: absolute;
    inset-block-start: var(--_row-top);
    inset-inline-start: 0;
    box-sizing: border-box;
    block-size: var(--_row-height, var(--_gantt-row-height));
    inline-size: calc(var(--_gantt-name-width) + var(--_gantt-chart-width));
    border-block-end: 1px solid var(--_border-subtle);
    outline: none;
  }

  .row:focus-visible {
    z-index: var(--_layer-raised);
    box-shadow: inset 0 0 0 2px var(--_focus-ring);
  }

  .row-header {
    display: grid;
    grid-template-columns: var(--_gantt-expander-width) minmax(0, 1fr) auto;
    grid-template-rows: minmax(24px, 1fr) auto;
    align-items: center;
    column-gap: var(--_gantt-tree-gap);
    block-size: 100%;
    padding-inline: calc(var(--_space-sm) + var(--_row-indent)) var(--_space-sm);
    overflow: hidden;
    font-size: var(--_gantt-content-size);
    font-weight: var(--_gantt-type-weight);
    line-height: var(--_gantt-content-line);
  }

  :host(:dir(rtl)) .name-header,
  :host(:dir(rtl)) .row-header {
    direction: rtl;
  }

  .expander,
  .row-label {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
  }

  .expander {
    display: grid;
    grid-column: 1;
    grid-row: 1;
    place-items: center;
    flex: 0 0 var(--_gantt-expander-width);
    block-size: var(--_gantt-expander-width);
    padding: 0;
    border-radius: var(--_radius-sm);
    cursor: pointer;
  }

  .expander:hover {
    background: var(--_surface-hover);
  }

  .expander-placeholder {
    grid-column: 1;
    grid-row: 1;
    inline-size: var(--_gantt-expander-width);
  }

  .row-label {
    grid-column: 2;
    grid-row: 1;
    min-inline-size: 0;
    padding: 0;
    overflow: hidden;
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .chart {
    block-size: 100%;
    overflow: hidden;
  }

  .item {
    position: absolute;
    display: flex;
    align-items: center;
    inset-block-start: var(--_item-top);
    inset-inline-start: var(--_item-left);
    box-sizing: border-box;
    block-size: var(--_item-height);
    min-block-size: 24px;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: var(--_radius-sm);
    background: var(--_gantt-work);
    color: var(--_gantt-work-text);
    font-size: var(--_gantt-content-size);
    font-weight: var(--_gantt-type-weight);
    line-height: var(--_gantt-content-line);
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .item-label {
    display: block;
    min-inline-size: 0;
    overflow: hidden;
    padding-inline: 4px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item[data-presentation="window"] {
    background: var(--_gantt-window);
    color: var(--_gantt-window-text);
    border-block-start: 1px dashed
      color-mix(in srgb, currentColor 35%, transparent);
  }

  .item-geometry {
    display: none;
  }

  .narrow-interval {
    overflow: visible;
    padding-inline-start: calc(var(--_item-geometry-width) + 4px);
    border: 0;
    background: transparent;
    color: var(--_text-primary);
  }

  .item.narrow-interval[data-presentation="window"] {
    border-block-start: 0;
    background: transparent;
    color: var(--_text-primary);
  }

  .narrow-interval .item-geometry {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    display: block;
    box-sizing: border-box;
    inline-size: var(--_item-geometry-width);
    border: 1px solid transparent;
    border-radius: var(--_radius-sm);
    background: var(--_gantt-work);
  }

  .narrow-interval .item-label {
    flex: 0 0 auto;
    max-inline-size: 12rem;
    background: var(--_surface-page);
    color: var(--_text-primary);
  }

  .narrow-interval[data-presentation="window"] .item-geometry {
    background: var(--_gantt-window);
    border-block-start: 1px dashed
      color-mix(in srgb, currentColor 35%, transparent);
  }

  .narrow-interval[data-provenance="actual"] .item-geometry {
    border-block-end: 3px solid var(--_gantt-actual);
  }

  .item[data-provenance="actual"] {
    border-block-end: 3px solid var(--_gantt-actual);
  }

  .item.narrow-interval[data-provenance="actual"] {
    border-block-end: 0;
  }

  .item[data-provenance="planned"]::before,
  .item[data-provenance="derived"]::before,
  .item[data-provenance="advisory"]::before {
    content: "≈";
    flex: 0 0 auto;
    padding-inline-start: 3px;
    font-size: 1em;
  }

  .item[data-provenance="planned"]::before {
    content: "○";
  }

  .item[data-provenance="advisory"]::before {
    content: "!";
    font-weight: 700;
  }

  .item[data-provenance="advisory"]:not(.milestone):not(.narrow-interval) {
    border-inline-start: 3px solid var(--_gantt-advisory);
  }

  .narrow-interval[data-provenance="advisory"] {
    border-inline-start: 0;
  }

  .narrow-interval[data-provenance="advisory"] .item-geometry {
    border-inline-start: 3px solid var(--_gantt-advisory);
  }

  .item[aria-pressed="true"] {
    box-shadow: 0 0 0 2px var(--_surface-page),
      0 0 0 4px var(--_gantt-selection);
  }

  .item[data-active="true"] {
    outline: 2px solid var(--_focus-ring);
    outline-offset: 1px;
  }

  .milestone {
    overflow: hidden;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--_text-primary);
  }

  .item.milestone::before {
    content: "◆";
    display: block;
    flex: 0 0 12px;
    inline-size: 12px;
    padding: 0;
    margin-inline-end: 4px;
    color: var(--_gantt-work);
    text-align: center;
  }

  .milestone.label-before {
    flex-direction: row-reverse;
  }

  .milestone.label-before::before {
    margin-inline: 4px 0;
  }

  .unscheduled {
    border-style: dotted;
    background: var(--_surface-subtle);
    color: var(--_text-secondary);
  }

  .unscheduled::before {
    content: "Unscheduled · ";
    font-weight: 600;
  }

  .overflow-controls {
    display: flex;
    grid-column: 2;
    grid-row: 2;
    align-items: center;
    justify-self: start;
    gap: 2px;
    margin-block-start: 2px;
  }

  .single-item-overflow {
    grid-column: 3;
    grid-row: 1;
  }

  .overflow-step,
  .item-overflow {
    display: inline-grid;
    place-items: center;
    box-sizing: border-box;
    min-inline-size: 24px;
    min-block-size: 24px;
    border: 1px solid var(--_border-subtle);
    background: var(--_surface-subtle);
    color: var(--_text-secondary);
    font-size: var(--_gantt-axis-size);
    font-weight: var(--_gantt-type-weight);
    line-height: var(--_gantt-axis-line);
  }

  .overflow-step {
    padding: 0;
    border-radius: var(--_radius-md);
    font: inherit;
    cursor: pointer;
  }

  .overflow-step:hover,
  .overflow-step:focus-visible {
    background: var(--_surface-hover);
    outline: 2px solid var(--_focus-ring);
    outline-offset: 1px;
  }

  .item-overflow {
    padding-inline: 4px;
    border-radius: var(--_radius-sm);
  }

  .sr-only {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .clipped-start {
    border-start-start-radius: 0;
    border-end-start-radius: 0;
  }

  .clipped-end {
    border-start-end-radius: 0;
    border-end-end-radius: 0;
  }

  .status {
    position: sticky;
    inset-inline-start: 0;
    box-sizing: border-box;
    inline-size: min(100%, 34rem);
    margin: var(--_space-md);
    padding: var(--_space-sm) var(--_space-md);
    border: 1px solid var(--_border-subtle);
    border-radius: var(--_radius-md);
    background: var(--_surface-card);
    color: var(--_text-secondary);
    font-size: var(--_body-size);
  }

  .status[data-kind="error"] {
    border-color: var(--_danger-border);
  }

  @container (inline-size < 34rem) {
    .root {
      --_gantt-name-width: var(--violet-gantt-name-column-width-narrow, 10rem);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .viewport {
      scroll-behavior: auto;
    }
  }

  @media (forced-colors: active) {
    .item[data-presentation="window"],
    .narrow-interval[data-presentation="window"] .item-geometry {
      border-block-start-color: CanvasText;
    }

    .root,
    .header,
    .name-header,
    .row-header,
    .status,
    .item,
    .item-geometry,
    .item-overflow,
    .overflow-step {
      forced-color-adjust: none;
      border-color: CanvasText;
      background: Canvas;
      color: CanvasText;
    }

    .item[aria-pressed="true"],
    .item[data-active="true"],
    .row:focus-visible {
      outline: 2px solid Highlight;
      box-shadow: none;
    }
  }
`;
