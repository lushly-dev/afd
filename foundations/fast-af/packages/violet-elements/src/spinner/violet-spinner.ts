import { FASTElement, Observable, attr, css, html } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

export type VioletSpinnerSize = "sm" | "md" | "lg";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: inline-flex;
        --_spinner-size: var(--_target-size-compact, 24px);
        --_spinner-track: color-mix(in srgb, var(--_border-subtle) 65%, transparent);
        --_spinner-stroke: 2px;
    }

    :host([size="sm"]) {
        --_spinner-size: var(--_target-size-compact, 24px);
    }

    :host([size="md"]) {
        --_spinner-size: var(--_target-size-natural, 32px);
    }

    :host([size="lg"]) {
        --_spinner-size: var(--_target-size-comfortable, 44px);
        --_spinner-stroke: 3px;
    }

    .spinner {
        box-sizing: border-box;
        inline-size: var(--_spinner-size);
        block-size: var(--_spinner-size);
        border-radius: var(--_radius-round);
        border: var(--_spinner-stroke) solid var(--_spinner-track);
        border-block-start-color: currentColor;
        animation: spin 0.8s linear infinite;
        color: var(--_text-secondary);
    }

    @keyframes spin {
        from {
            transform: rotate(0deg);
        }

        to {
            transform: rotate(360deg);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .spinner {
            animation-duration: 1.6s;
        }
    }

    @media (forced-colors: active) {
        .spinner {
            forced-color-adjust: none;
            color: Highlight;
            border-color: GrayText;
            border-block-start-color: Highlight;
        }
    }
`;

const template = html<VioletSpinner>`
    <span
        class="spinner"
        part="spinner"
        role="${x => (x.decorative ? "presentation" : "img")}"
        aria-hidden="${x => (x.decorative ? "true" : "false")}"
        aria-label="${x => (x.decorative ? null : x.accessibleLabel)}"
    ></span>
`;

/**
 * Compact indeterminate loading indicator.
 *
 * @summary Token-driven spinner for local loading and waiting states.
 * @csspart spinner - The animated circular indicator.
 */
export class VioletSpinner extends FASTElement {
    declare public label: string;
    declare public decorative: boolean;
    declare public size: "sm" | "md" | "lg";

    public constructor() {
        super();
        this.label = "";
        this.decorative = false;
        this.size = "md";
    }

    public get accessibleLabel(): string {
        Observable.trackVolatile();
        return this.label || "Loading";
    }
}

attr(VioletSpinner.prototype, "label");
attr({ mode: "boolean" })(VioletSpinner.prototype, "decorative");
attr(VioletSpinner.prototype, "size");

if (!customElements.get("violet-spinner")) {
    await FASTElement.define(VioletSpinner, {
        name: "violet-spinner",
        template,
        styles,
    });
}
