import {
  css,
  FASTElement,
  html,
  type PartialFASTElementDefinition,
} from "@lushly-dev/fast-element";

import {
  violetFieldTokenDefaults,
  violetSurfaceTokenDefaults,
} from "../theme/violet-token-defaults";

const styles = css`
    ${violetFieldTokenDefaults}
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        color: var(--_text-primary);
        font-family: inherit;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        outline: none;
    }

    /* violet-tabs makes each panel a tab stop, so a focused panel shows the theme's ring. */
    :host(:focus-visible) {
        outline: var(--violet-size-focus-ring-width, 2px) solid var(--_focus-ring);
        outline-offset: 2px;
    }

    :host([hidden]) {
        display: none;
    }

    @media (forced-colors: active) {
        :host(:focus-visible) {
            outline-color: Highlight;
        }
    }

    .content {
        display: grid;
        gap: var(--_space-md);
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

/** The FAST definition of `<violet-tab-panel>`; `defineVioletTabPanel` in `./violet-tab-panel.define` registers it. */
export const violetTabPanelDefinition = {
  name: "violet-tab-panel",
  template,
  styles,
} satisfies PartialFASTElementDefinition;
