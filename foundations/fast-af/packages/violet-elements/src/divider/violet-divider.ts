import { FASTElement, attr, css, html, when } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

export type VioletDividerAppearance = "subtle" | "strong";
export type VioletDividerOrientation = "horizontal" | "vertical";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        --_divider-color: var(--_border-subtle);
        --_divider-thickness: 1px;
        --_divider-min-block-size: 1.5rem;
    }

    :host([appearance="strong"]) {
        --_divider-color: color-mix(in srgb, var(--_border-subtle) 45%, var(--_text-secondary));
    }

    :host([orientation="vertical"]) {
        display: inline-flex;
        align-self: stretch;
    }

    .rule {
        margin: 0;
        border: 0;
        background: var(--_divider-color);
        color: inherit;
        flex: none;
    }

    .rule.horizontal {
        display: block;
        inline-size: 100%;
        block-size: var(--_divider-thickness);
    }

    .rule.vertical {
        display: block;
        inline-size: var(--_divider-thickness);
        min-block-size: var(--_divider-min-block-size);
        block-size: 100%;
    }

    @media (forced-colors: active) {
        .rule {
            forced-color-adjust: none;
            background: ButtonText;
        }
    }
`;

const template = html<VioletDivider>`
    ${when(
        x => x.orientation === "vertical",
        html<VioletDivider>`
            <div
                class="rule vertical"
                part="rule"
                role="${x => (x.decorative ? "presentation" : "separator")}"
                aria-hidden="${x => (x.decorative ? "true" : "false")}"
                aria-orientation="${x => (x.decorative ? null : "vertical")}"
            ></div>
        `,
    )}
    ${when(
        x => x.orientation !== "vertical",
        html<VioletDivider>`
            <hr class="rule horizontal" part="rule" aria-hidden="${x => (x.decorative ? "true" : "false")}" />
        `,
    )}
`;

/**
 * Structural Violet divider for subtle or strong boundaries between regions.
 *
 * @summary Token-driven horizontal or vertical separator with optional decorative mode.
 * @csspart rule - The rendered divider rule.
 */
export class VioletDivider extends FASTElement {
    declare public appearance: VioletDividerAppearance;
    declare public orientation: VioletDividerOrientation;
    declare public decorative: boolean;

    public constructor() {
        super();
        this.appearance = "subtle";
        this.orientation = "horizontal";
        this.decorative = false;
    }
}

attr(VioletDivider.prototype, "appearance");
attr(VioletDivider.prototype, "orientation");
attr({ mode: "boolean" })(VioletDivider.prototype, "decorative");

if (!customElements.get("violet-divider")) {
    await FASTElement.define(VioletDivider, {
        name: "violet-divider",
        template,
        styles,
    });
}
