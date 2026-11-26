import {
  attr,
  css,
  FASTElement,
  html,
  Observable,
  type PartialFASTElementDefinition,
  when,
} from "@lushly-dev/fast-element";

import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";

let violetProgressId = 0;

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        display: grid;
        gap: var(--_space-stack-xs);
        color: var(--_text-secondary);
        --_progress-track-size: 6px;
        --_progress-radius: var(--violet-radius-round, 9999px);
        --_progress-fill: var(--violet-color-control-selected-foreground, #1b5f80);
        /* The track is a well, filled to the value. */
        --_progress-track: color-mix(in srgb, var(--violet-color-text-primary, #181b1a) 10%, transparent);
    }

    .header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--_space-inline-md);
    }

    .label,
    .value-label {
        margin: 0;
        font-size: var(--_control-label-size);
        line-height: var(--_type-label-line);
    }

    .label {
        color: var(--_text-secondary);
        font-weight: var(--_type-label-weight);
    }

    .value-label {
        color: var(--_text-muted);
        font-size: var(--_control-caption-size);
        font-variant-numeric: tabular-nums;
    }

    .progress {
        inline-size: 100%;
        block-size: var(--_progress-track-size);
        overflow: hidden;
        border: none;
        border-radius: var(--_progress-radius);
        background: var(--_progress-track);
        appearance: none;
        -webkit-appearance: none;
    }

    .progress::-webkit-progress-bar {
        background: var(--_progress-track);
        border-radius: var(--_progress-radius);
    }

    .progress::-webkit-progress-value {
        border-radius: var(--_progress-radius);
        background: var(--_progress-fill);
    }

    .progress::-moz-progress-bar {
        border-radius: var(--_progress-radius);
        background: var(--_progress-fill);
    }

    :host([value=""]) .progress {
        position: relative;
        background: var(--_progress-track);
    }

    :host([value=""]) .progress::before {
        content: "";
        position: absolute;
        inset-block: 0;
        inline-size: 35%;
        border-radius: var(--_progress-radius);
        background: var(--_progress-fill);
        animation: indeterminate-slide 2.4s var(--_easing-standard) infinite;
    }

    @keyframes indeterminate-slide {
        0% {
            inset-inline-start: -35%;
        }

        100% {
            inset-inline-start: 100%;
        }
    }

    @keyframes indeterminate-pulse {
        0% {
            opacity: 1;
        }

        /* Not lower: a Highlight fill on Canvas keeps its contrast under forced colours. */
        100% {
            opacity: 0.75;
        }
    }

    /* Nothing slides under reduced motion: the whole track fills and its opacity eases. */
    @media (prefers-reduced-motion: reduce) {
        :host([value=""]) .progress::before {
            inset-inline-start: 0;
            inline-size: 100%;
            animation: indeterminate-pulse 1.6s ease-in-out infinite alternate;
        }
    }

    @media (forced-colors: active) {
        .progress {
            forced-color-adjust: none;
            background: Canvas;
            border: 1px solid ButtonText;
        }

        .progress::-webkit-progress-bar {
            background: Canvas;
        }

        .progress::-webkit-progress-value,
        .progress::-moz-progress-bar,
        :host([value=""]) .progress::before {
            background: Highlight;
        }
    }
`;

const template = html<VioletProgress>`
    ${when(
      (x) => Boolean((x.label ?? "").trim()) || x.showValueLabel,
      html<VioletProgress>`
            <div class="header" part="header">
                ${when(
                  (x) => Boolean((x.label ?? "").trim()),
                  html<VioletProgress>`
                        <p class="label" part="label" id="${(x) => x.labelId}">${(x) => x.label}</p>
                    `,
                )}
                ${when(
                  (x) => x.showValueLabel,
                  html<VioletProgress>`
                        <p class="value-label" part="value-label">${(x) => x.valueLabel}</p>
                    `,
                )}
            </div>
        `,
    )}
    <progress
        class="progress"
        part="progress"
        max="${(x) => x.normalizedMax}"
        value="${(x) => x.progressValueAttribute}"
        aria-labelledby="${(x) => ((x.label ?? "").trim() ? x.labelId : null)}"
        aria-label="${(x) => ((x.label ?? "").trim() ? null : "Progress")}"
        aria-valuetext="${(x) => x.valueText || null}"
    ></progress>
`;

/**
 * Native-first linear progress indicator.
 *
 * @summary Styled wrapper around the native HTML progress element for determinate and indeterminate loading.
 * @csspart header - Optional label and value row.
 * @csspart label - Optional visible progress label.
 * @csspart value-label - Optional visible percentage label.
 * @csspart progress - The styled native progress element.
 */
export class VioletProgress extends FASTElement {
  declare public label: string;
  declare public value: string;
  declare public max: string;
  declare public valueText: string;

  public readonly labelId: string;

  public constructor() {
    super();
    const id = violetProgressId;
    violetProgressId += 1;
    this.labelId = `violet-progress-label-${id}`;
    this.label = "";
    this.value = "0";
    this.max = "100";
    this.valueText = "";
  }

  public get normalizedMax(): string {
    Observable.trackVolatile();
    const max = Number.parseFloat(this.max);
    return Number.isFinite(max) && max > 0 ? String(max) : "100";
  }

  public get progressValueAttribute(): string | null {
    Observable.trackVolatile();
    if (this.value === "") {
      return null;
    }

    const value = Number.parseFloat(this.value);
    if (!Number.isFinite(value)) {
      return "0";
    }

    return String(Math.min(Math.max(value, 0), Number.parseFloat(this.normalizedMax)));
  }

  public get accessibleLabel(): string {
    Observable.trackVolatile();
    return this.label || "Progress";
  }

  public get showValueLabel(): boolean {
    Observable.trackVolatile();
    return this.value !== "";
  }

  public get valueLabel(): string {
    Observable.trackVolatile();
    if (!this.showValueLabel) {
      return "";
    }

    const value = Number.parseFloat(this.progressValueAttribute ?? "0");
    const max = Number.parseFloat(this.normalizedMax);
    const percent = max > 0 ? Math.round((value / max) * 100) : 0;
    return `${percent}%`;
  }
}

attr(VioletProgress.prototype, "label");
attr(VioletProgress.prototype, "value");
attr(VioletProgress.prototype, "max");
attr({ attribute: "value-text" })(VioletProgress.prototype, "valueText");

/** The FAST definition of `<violet-progress>`; `defineVioletProgress` in `./violet-progress.define` registers it. */
export const violetProgressDefinition = {
  name: "violet-progress",
  template,
  styles,
} satisfies PartialFASTElementDefinition;
