import {
  attr,
  css,
  FASTElement,
  html,
  Observable,
  type PartialFASTElementDefinition,
} from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

export type VioletSpinnerSize = "sm" | "md" | "lg";

const styles = css`
    ${violetSurfaceTokenDefaults}

    /* The sizes follow the scale: a mark (16px), the default (24px) and a control (32px). */
    :host {
        display: inline-flex;
        --_spinner-size: 24px;
    }

    :host([size="sm"]) {
        --_spinner-size: 16px;
    }

    :host([size="lg"]) {
        --_spinner-size: 32px;
    }

    .spinner {
        display: inline-flex;
        inline-size: var(--_spinner-size);
        block-size: var(--_spinner-size);
        color: var(--_text-secondary);
    }

    /* Trace: a run travels the edge of a rounded square, the ring redrawn in the shape of a control. */
    .mark {
        display: block;
        inline-size: 100%;
        block-size: 100%;
        fill: none;
        stroke: currentColor;
        stroke-width: 2.5;
    }

    .rest {
        opacity: 0.2;
    }

    .run {
        stroke-dasharray: 28 72;
        animation: trace 1s linear infinite;
    }

    @keyframes trace {
        from {
            stroke-dashoffset: 0;
        }

        to {
            stroke-dashoffset: -100;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .run {
            animation-duration: 3s;
        }
    }

    @media (forced-colors: active) {
        .spinner {
            forced-color-adjust: none;
            color: Highlight;
        }

        .rest {
            stroke: GrayText;
            opacity: 1;
        }
    }
`;

const template = html<VioletSpinner>`
    <span
        class="spinner"
        part="spinner"
        role="${(x) => (x.decorative ? "presentation" : "img")}"
        aria-hidden="${(x) => (x.decorative ? "true" : "false")}"
        aria-label="${(x) => (x.decorative ? null : x.accessibleLabel)}"
    >
        <svg class="mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect class="rest" x="3" y="3" width="18" height="18" rx="3"></rect>
            <rect class="run" x="3" y="3" width="18" height="18" rx="3" pathLength="100"></rect>
        </svg>
    </span>
`;

/**
 * Compact indeterminate loading indicator.
 *
 * @summary Token-driven spinner for local loading and waiting states.
 * @csspart spinner - The animated indicator: a run that travels the edge of a rounded square.
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

/** The FAST definition of `<violet-spinner>`; `defineVioletSpinner` in `./violet-spinner.define` registers it. */
export const violetSpinnerDefinition = {
  name: "violet-spinner",
  template,
  styles,
} satisfies PartialFASTElementDefinition;
