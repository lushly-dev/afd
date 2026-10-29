import { beforeEach, describe, expect, it } from "vitest";

import {
    VIOLET_THEME_DEFAULT_PRESET,
    VIOLET_THEME_PRESET_ATTRIBUTE,
    VIOLET_THEME_ROOT_ATTRIBUTE,
    applyVioletThemePreset,
    applyVioletThemeRoot,
    getVioletThemePreset,
    installVioletTheme,
    normalizeVioletThemePreset,
    violetThemeCssText,
} from "./generated/violet-theme.generated";
import "./violet-theme";

function clearRuntimeTheme(): void {
    document.querySelectorAll('style[data-violet-theme="runtime"]').forEach(node => {
        node.remove();
    });
    document.body.innerHTML = "";
}

describe("violet runtime theme", () => {
    beforeEach(() => {
        clearRuntimeTheme();
    });

    it("reuses the same runtime style element for repeated document installs", () => {
        const first = installVioletTheme(document);
        first.textContent = "stale";

        const second = installVioletTheme(document);

        expect(second).toBe(first);
        expect(second.textContent).toBe(violetThemeCssText);
        expect(document.head.querySelectorAll('style[data-violet-theme="runtime"]')).toHaveLength(1);
    });

    it("installs the runtime style inside a shadow root when requested", () => {
        const host = document.createElement("div");
        const shadowRoot = host.attachShadow({ mode: "open" });

        const style = installVioletTheme(shadowRoot);

        expect(shadowRoot.querySelector('style[data-violet-theme="runtime"]')).toBe(style);
        expect(style.textContent).toBe(violetThemeCssText);
        expect(document.head.querySelector('style[data-violet-theme="runtime"]')).toBeNull();
    });

    it("marks arbitrary elements as scoped Violet theme roots", () => {
        const scope = document.createElement("section");

        expect(applyVioletThemeRoot(scope, "dark")).toBe(scope);
        expect(scope.hasAttribute(VIOLET_THEME_ROOT_ATTRIBUTE)).toBe(true);
        expect(scope.getAttribute(VIOLET_THEME_PRESET_ATTRIBUTE)).toBe("dark");
    });

    it("applies and reads theme presets on the document root", () => {
        expect(applyVioletThemePreset(document, "dark")).toBe(document);
        expect(getVioletThemePreset(document)).toBe("dark");
        expect(normalizeVioletThemePreset("unknown")).toBe(VIOLET_THEME_DEFAULT_PRESET);
    });

    it("connects violet-theme hosts as scoped roots and ensures the runtime style exists", () => {
        const scope = document.createElement("violet-theme");

        document.body.append(scope);

        expect(scope.hasAttribute(VIOLET_THEME_ROOT_ATTRIBUTE)).toBe(true);
        expect(scope.getAttribute(VIOLET_THEME_PRESET_ATTRIBUTE)).toBe(VIOLET_THEME_DEFAULT_PRESET);
        expect(document.head.querySelector('style[data-violet-theme="runtime"]')).toBeTruthy();
    });

    it("installs the runtime style into a shadow root when violet-theme is used inside one", () => {
        const host = document.createElement("div");
        const shadowRoot = host.attachShadow({ mode: "open" });
        const scope = document.createElement("violet-theme");

        document.body.append(host);
        shadowRoot.append(scope);

        expect(scope.hasAttribute(VIOLET_THEME_ROOT_ATTRIBUTE)).toBe(true);
        expect(shadowRoot.querySelector('style[data-violet-theme="runtime"]')).toBeTruthy();
    });

    it("reflects preset changes on violet-theme hosts", () => {
        const scope = document.createElement("violet-theme");
        scope.setAttribute("preset", "dark");

        document.body.append(scope);

        expect(scope.getAttribute(VIOLET_THEME_PRESET_ATTRIBUTE)).toBe("dark");
    });
});
