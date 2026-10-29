import { FASTElement, attr, css, html } from "@lushly-dev/fast-element";

import {
    VIOLET_THEME_DEFAULT_PRESET,
    applyVioletThemePreset,
    applyVioletThemeRoot,
    installVioletTheme,
    normalizeVioletThemePreset,
    type VioletThemePreset,
} from "./generated/violet-theme.generated";

const styles = css`
    :host {
        display: contents;
    }
`;

const template = html<VioletTheme>`
    <slot></slot>
`;

/**
 * Violet optional scoped theme host.
 *
 * @summary Applies the shared Violet runtime token layer to a subtree without requiring a global provider wrapper.
 * @slot - Descendant content that should inherit Violet token values from this scope.
 */
export class VioletTheme extends FASTElement {
    /**
     * Selects which Violet runtime theme preset this scoped host should expose.
     */
    @attr
    declare public preset: VioletThemePreset;

    public connectedCallback(): void {
        super.connectedCallback();
        const rootNode = this.getRootNode();
        installVioletTheme(rootNode instanceof ShadowRoot ? rootNode : this.ownerDocument);
        applyVioletThemeRoot(
            this,
            normalizeVioletThemePreset(this.getAttribute("preset") ?? this.preset ?? VIOLET_THEME_DEFAULT_PRESET),
        );
    }

    public presetChanged(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        applyVioletThemePreset(
            this,
            normalizeVioletThemePreset(this.getAttribute("preset") ?? this.preset ?? VIOLET_THEME_DEFAULT_PRESET),
        );
    }
}

if (!customElements.get("violet-theme")) {
    await FASTElement.define(VioletTheme, {
        name: "violet-theme",
        template,
        styles,
    });
}
