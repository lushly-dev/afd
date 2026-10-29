import { FASTElement, css, html } from "@lushly-dev/fast-element";

import { violetFieldTokenDefaults, violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

const styles = css`
    ${violetFieldTokenDefaults}
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        color: var(--_text-primary, var(--color-text-primary, #18181b));
        font-family: inherit;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        outline: none;
    }

    :host([hidden]) {
        display: none;
    }

    .content {
        display: grid;
        gap: var(--_space-md, 12px);
    }
`;

const template = html<VioletTabPanel>`
    <div class="content" part="root">
        <slot></slot>
    </div>
`;

/**
 * Violet reusable tab panel primitive.
 *
 * @summary Panel region paired to a violet-tab by violet-tabs.
 * @slot - Tab panel content.
 * @csspart root - Panel content wrapper.
 */
export class VioletTabPanel extends FASTElement {}

if (!customElements.get("violet-tab-panel")) {
    await FASTElement.define(VioletTabPanel, {
        name: "violet-tab-panel",
        template,
        styles,
    });
}
