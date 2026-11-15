import { FASTElement, attr, css, html } from "@lushly-dev/fast-element";

import { VIOLET_THEME_PRESET_ATTRIBUTE, VIOLET_THEME_ROOT_ATTRIBUTE, type VioletThemePreset } from "./violet-theme-css";
import { getVioletThemeDefaultPreset, getVioletThemePresets, installVioletTheme, isVioletThemePreset } from "./violet-theme-runtime";

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
     * Selects which preset of the installed Violet theme set this scoped host exposes. Any name the
     * set has works; the built-in set has light, dark and high-contrast.
     */
    @attr
    declare public preset: VioletThemePreset;

    public connectedCallback(): void {
        super.connectedCallback();
        const rootNode = this.getRootNode();
        installVioletTheme(rootNode instanceof ShadowRoot ? rootNode : this.ownerDocument);
        this.setAttribute(VIOLET_THEME_ROOT_ATTRIBUTE, "");
        this.applyPreset();
    }

    public presetChanged(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        this.applyPreset();
    }

    /**
     * Writes the preset as given: a name the installed set lacks is kept, not mapped to the default,
     * so it applies as soon as a set that has it is installed, and a warning names the known ones.
     */
    private applyPreset(): void {
        const preset = this.getAttribute("preset") || this.preset || getVioletThemeDefaultPreset();
        if (!isVioletThemePreset(preset)) {
            console.warn(
                `violet-theme: the preset '${preset}' is not in the installed theme set (${getVioletThemePresets().join(", ")})`,
            );
        }
        this.setAttribute(VIOLET_THEME_PRESET_ATTRIBUTE, preset);
    }
}

if (!customElements.get("violet-theme")) {
    await FASTElement.define(VioletTheme, {
        name: "violet-theme",
        template,
        styles,
    });
}
