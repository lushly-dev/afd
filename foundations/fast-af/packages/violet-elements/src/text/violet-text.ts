import { FASTElement, attr, css, html, when } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

export type VioletTextAs = "span" | "p" | "small" | "strong" | "label" | "h1" | "h2" | "h3" | "h4";
export type VioletTextVariant = "body" | "label" | "caption" | "title-sm" | "title-md";
export type VioletTextTone = "default" | "secondary" | "muted" | "success" | "warning" | "danger";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: inline;
        --_text-font-size: var(--_body-size);
        --_text-line-height: var(--_body-line);
        --_text-font-weight: var(--type-body-md-weight, 400);
        --_text-color: var(--_text-primary);
    }

    :host([variant="label"]) {
        --_text-font-size: var(--type-label-sm-size, 12px);
        --_text-line-height: var(--type-label-sm-line, 16px);
        --_text-font-weight: var(--type-label-sm-weight, 500);
    }

    :host([variant="caption"]) {
        --_text-font-size: var(--_caption-size);
        --_text-line-height: var(--_caption-line);
        --_text-font-weight: var(--type-caption-xs-weight, 500);
    }

    :host([variant="title-sm"]) {
        --_text-font-size: var(--type-title-sm-size, 18px);
        --_text-line-height: var(--type-title-sm-line, 24px);
        --_text-font-weight: var(--type-title-sm-weight, 600);
    }

    :host([variant="title-md"]) {
        --_text-font-size: var(--type-title-md-size, 24px);
        --_text-line-height: var(--type-title-md-line, 32px);
        --_text-font-weight: var(--type-title-md-weight, 600);
    }

    :host([tone="secondary"]) {
        --_text-color: var(--_text-secondary);
    }

    :host([tone="muted"]) {
        --_text-color: var(--_text-muted);
    }

    :host([tone="success"]) {
        --_text-color: var(--color-state-success-text);
    }

    :host([tone="warning"]) {
        --_text-color: var(--color-state-warning-text);
    }

    :host([tone="danger"]) {
        --_text-color: var(--color-state-danger-text);
    }

    .root {
        margin: 0;
        color: var(--_text-color);
        font-family: inherit;
        font-size: var(--_text-font-size);
        font-weight: var(--_text-font-weight);
        line-height: var(--_text-line-height);
        letter-spacing: normal;
    }

    .root.truncate {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .inline {
        display: inline;
    }

    .block {
        display: block;
    }
`;

const textClass = (x: VioletText) => {
    const displayClass = x.as === "span" || x.as === "small" || x.as === "strong" || x.as === "label" ? "inline" : "block";
    return `root ${displayClass}${x.truncate ? " truncate" : ""}`;
};

const template = html<VioletText>`
    ${when(x => x.as === "p", html<VioletText>`<p class="${textClass}"><slot></slot></p>`)}
    ${when(x => x.as === "small", html<VioletText>`<small class="${textClass}"><slot></slot></small>`)}
    ${when(x => x.as === "strong", html<VioletText>`<strong class="${textClass}"><slot></slot></strong>`)}
    ${when(x => x.as === "label", html<VioletText>`<label class="${textClass}"><slot></slot></label>`)}
    ${when(x => x.as === "h1", html<VioletText>`<h1 class="${textClass}"><slot></slot></h1>`)}
    ${when(x => x.as === "h2", html<VioletText>`<h2 class="${textClass}"><slot></slot></h2>`)}
    ${when(x => x.as === "h3", html<VioletText>`<h3 class="${textClass}"><slot></slot></h3>`)}
    ${when(x => x.as === "h4", html<VioletText>`<h4 class="${textClass}"><slot></slot></h4>`)}
    ${when(x => x.as === "span", html<VioletText>`<span class="${textClass}"><slot></slot></span>`)}
`;

/**
 * Semantic Violet typography primitive.
 *
 * @summary Text wrapper that applies Violet type ramps and tones while preserving the underlying HTML semantics.
 * @slot - Text content.
 * @csspart root - The rendered semantic text element.
 */
export class VioletText extends FASTElement {
    declare public as: VioletTextAs;
    declare public variant: VioletTextVariant;
    declare public tone: VioletTextTone;
    declare public truncate: boolean;

    public constructor() {
        super();
        this.as = "span";
        this.variant = "body";
        this.tone = "default";
        this.truncate = false;
    }
}

attr(VioletText.prototype, "as");
attr(VioletText.prototype, "variant");
attr(VioletText.prototype, "tone");
attr({ mode: "boolean" })(VioletText.prototype, "truncate");

if (!customElements.get("violet-text")) {
    await FASTElement.define(VioletText, {
        name: "violet-text",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}
