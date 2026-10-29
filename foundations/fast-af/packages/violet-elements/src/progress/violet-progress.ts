import { FASTElement, Observable, attr, css, html, when } from "@lushly-dev/fast-element";

import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        display: grid;
        gap: var(--_space-stack-xs);
        color: var(--_text-secondary);
        --_progress-track-size: 8px;
        --_progress-radius: var(--_radius-md);
        --_progress-fill: var(--color-control-selected-foreground);
        --_progress-track: color-mix(in srgb, var(--_surface-subtle) 84%, transparent);
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

    @media (prefers-reduced-motion: reduce) {
        :host([value=""]) .progress::before {
            animation-duration: 3.2s;
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
        x => Boolean(x.label) || x.showValueLabel,
        html<VioletProgress>`
            <div class="header" part="header">
                ${when(
                    x => Boolean(x.label),
                    html<VioletProgress>`
                        <p class="label" part="label">${x => x.label}</p>
                    `
                )}
                ${when(
                    x => x.showValueLabel,
                    html<VioletProgress>`
                        <p class="value-label" part="value-label">${x => x.valueLabel}</p>
                    `
                )}
            </div>
        `
    )}
    <progress
        class="progress"
        part="progress"
        max="${x => x.normalizedMax}"
        value="${x => x.progressValueAttribute}"
        aria-label="${x => x.accessibleLabel}"
        aria-valuetext="${x => x.valueText || null}"
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

    public constructor() {
        super();
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

if (!customElements.get("violet-progress")) {
    await FASTElement.define(VioletProgress, {
        name: "violet-progress",
        template,
        styles,
    });
}
