import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    VIOLET_THEME_PRESET_ATTRIBUTE,
    VIOLET_THEME_ROOT_ATTRIBUTE,
    createVioletThemeCss,
    validateVioletThemeSet,
    type VioletThemeSet,
} from "./violet-theme-css";
import {
    VIOLET_THEME_DEFAULT_PRESET,
    applyVioletThemePreset,
    applyVioletThemeRoot,
    getVioletThemeDefaultPreset,
    getVioletThemePreset,
    getVioletThemePresets,
    installVioletTheme,
    installVioletThemeSet,
    isVioletThemePreset,
    normalizeVioletThemePreset,
    loadVioletBuiltInTheme,
    resetVioletThemeSet,
    violetThemePresets,
} from "./violet-theme-runtime";
import {
    violetThemeBuiltInSet,
    violetThemeCssText,
    violetThemeDeclarations,
    violetThemeDeclarationsByPreset,
} from "./violet-theme-builtin";
import runtimeSource from "./violet-theme-runtime.ts?raw";
import elementSource from "./violet-theme.ts?raw";
import "./violet-theme";

/** A product's own set: preset names the built-in set does not have, and an id it lacks. */
const productSet: VioletThemeSet = {
    defaultPreset: "meadow",
    presets: {
        meadow: [
            { id: "color.surface.page", value: "#f4f7ee" },
            { id: "color.text.primary", value: "#1f2a1c" },
            { id: "font.family.body", value: "Georgia, serif" },
            { id: "color.brand.leaf", value: "#2f6b3a" },
        ],
        "night-garden": [
            { id: "color.surface.page", value: "#101410" },
            { id: "color.text.primary", value: "#e6eee0" },
        ],
    },
};

function clearRuntimeTheme(): void {
    document.querySelectorAll('style[data-violet-theme="runtime"]').forEach(node => {
        node.remove();
    });
    document.documentElement.removeAttribute(VIOLET_THEME_PRESET_ATTRIBUTE);
    document.body.innerHTML = "";
}

function runtimeStyles(): HTMLStyleElement[] {
    return [...document.head.querySelectorAll<HTMLStyleElement>('style[data-violet-theme="runtime"]')];
}

describe("violet runtime theme", () => {
    beforeEach(async () => {
        resetVioletThemeSet();
        clearRuntimeTheme();
        await loadVioletBuiltInTheme();
    });

    it("reuses the same runtime style element for repeated document installs", () => {
        const first = installVioletTheme(document);
        first.textContent = "stale";

        const second = installVioletTheme(document);

        expect(second).toBe(first);
        expect(second.textContent).toBe(violetThemeCssText);
        expect(runtimeStyles()).toHaveLength(1);
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
        expect(getVioletThemePreset(document)).toBe(VIOLET_THEME_DEFAULT_PRESET);
        expect(applyVioletThemePreset(document, "dark")).toBe(document);
        expect(getVioletThemePreset(document)).toBe("dark");
        expect(applyVioletThemePreset(document)).toBe(document);
        expect(getVioletThemePreset(document)).toBe("light");
    });

    it("never maps an unknown preset name to the default", () => {
        expect(normalizeVioletThemePreset(undefined)).toBe("light");
        expect(normalizeVioletThemePreset("")).toBe("light");
        expect(normalizeVioletThemePreset("high-contrast")).toBe("high-contrast");
        expect(() => normalizeVioletThemePreset("unknown")).toThrow(RangeError);
        expect(() => applyVioletThemePreset(document, "sepia")).toThrow(/Unknown Violet theme preset 'sepia'/);
        expect(() => applyVioletThemeRoot(document.createElement("div"), "sepia")).toThrow(RangeError);
        expect(isVioletThemePreset("sepia")).toBe(false);

        document.documentElement.setAttribute(VIOLET_THEME_PRESET_ATTRIBUTE, "sepia");
        expect(getVioletThemePreset(document)).toBe("sepia");
    });

    it("derives the built-in exports from the built-in set", () => {
        expect(violetThemePresets).toEqual(["light", "dark", "high-contrast"]);
        expect(violetThemeBuiltInSet.defaultPreset).toBe(VIOLET_THEME_DEFAULT_PRESET);
        expect(violetThemeCssText).toBe(createVioletThemeCss(violetThemeBuiltInSet));
        expect(violetThemeCssText.startsWith(":root,\n[data-violet-theme-root]\n{\n  --color-action-danger-background: #B42318;")).toBe(true);
        expect(violetThemeCssText).toContain(':root[data-violet-theme="dark"],\n[data-violet-theme-root][data-violet-theme="dark"]\n{');
        expect(violetThemeDeclarations).toBe(violetThemeDeclarationsByPreset.light);
        expect(violetThemeDeclarations).toContain('  --font-family-body: "Montserrat", "Segoe UI", sans-serif;');
        expect(VIOLET_THEME_DEFAULT_PRESET).toBe("light");
    });

    it("loads the built-in set only on demand, never statically", async () => {
        expect(runtimeSource).not.toContain('from "./violet-theme-builtin"');
        expect(runtimeSource).not.toContain('from "./generated/violet-theme.generated"');
        expect(runtimeSource).toContain('import("./violet-theme-builtin")');
        expect(elementSource).not.toContain("violet-theme-builtin");
        expect(elementSource).not.toContain("generated/violet-theme.generated");
        await expect(loadVioletBuiltInTheme()).resolves.toBe(violetThemeCssText);
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

describe("a product's replacement theme set", () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        resetVioletThemeSet();
        clearRuntimeTheme();
        await loadVioletBuiltInTheme();
        warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        warn.mockRestore();
        resetVioletThemeSet();
        clearRuntimeTheme();
    });

    it("installs as data without the built-in default ever being written", () => {
        const style = installVioletThemeSet(productSet);

        expect(runtimeStyles()).toEqual([style]);
        expect(style.textContent).toBe(createVioletThemeCss(productSet));
        expect(style.textContent).not.toContain("--color-action-danger-background");
        expect(style.textContent).toContain('[data-violet-theme-root][data-violet-theme="night-garden"]');
        expect(getComputedStyle(document.documentElement).getPropertyValue("--color-brand-leaf").trim()).toBe("#2f6b3a");
        expect(getVioletThemePresets()).toEqual(["meadow", "night-garden"]);
        expect(getVioletThemeDefaultPreset()).toBe("meadow");
        expect(getVioletThemePreset(document)).toBe("meadow");

        // Later installs, by violet-theme hosts among them, write the product's set, not the built-in one.
        expect(installVioletTheme(document)).toBe(style);
        expect(style.textContent).toBe(createVioletThemeCss(productSet));
    });

    it("selects a non-default preset on the document", () => {
        installVioletThemeSet(productSet);

        applyVioletThemePreset(document, "night-garden");

        const root = getComputedStyle(document.documentElement);
        expect(getVioletThemePreset(document)).toBe("night-garden");
        expect(root.getPropertyValue("--color-surface-page").trim()).toBe("#101410");
        // A preset inherits what it does not set from the default.
        expect(root.getPropertyValue("--font-family-body").trim()).toBe("Georgia, serif");
        expect(() => applyVioletThemePreset(document, "dark")).toThrow(/installed presets are meadow, night-garden/);
    });

    it("selects presets on scoped roots, through the element and the function", () => {
        installVioletThemeSet(productSet);
        const section = applyVioletThemeRoot(document.createElement("section"), "night-garden");
        const scope = document.createElement("violet-theme");
        scope.setAttribute("preset", "night-garden");
        const plain = document.createElement("div");
        applyVioletThemeRoot(plain);
        document.body.append(section, scope, plain);

        expect(getComputedStyle(section).getPropertyValue("--color-text-primary").trim()).toBe("#e6eee0");
        expect(getComputedStyle(scope).getPropertyValue("--color-text-primary").trim()).toBe("#e6eee0");
        expect(plain.getAttribute(VIOLET_THEME_PRESET_ATTRIBUTE)).toBe("meadow");
        expect(getComputedStyle(plain).getPropertyValue("--color-text-primary").trim()).toBe("#1f2a1c");
        expect(warn).not.toHaveBeenCalled();
    });

    it("replaces the built-in set in shadow roots installed before it", () => {
        const host = document.createElement("div");
        const shadowRoot = host.attachShadow({ mode: "open" });
        document.body.append(host);
        shadowRoot.append(document.createElement("violet-theme"));
        const scoped = shadowRoot.querySelector<HTMLStyleElement>('style[data-violet-theme="runtime"]');
        expect(scoped?.textContent).toBe(violetThemeCssText);

        installVioletThemeSet(productSet);

        expect(scoped?.textContent).toBe(createVioletThemeCss(productSet));
    });

    it("reaches a shadow root that was detached when the set changed, once it is attached again", () => {
        const host = document.createElement("div");
        const shadowRoot = host.attachShadow({ mode: "open" });
        document.body.append(host);
        const scoped = installVioletTheme(shadowRoot);
        host.remove();
        expect(scoped.isConnected).toBe(false);

        installVioletThemeSet(productSet);
        document.body.append(host);

        expect(scoped.textContent).toBe(createVioletThemeCss(productSet));
        resetVioletThemeSet();
        expect(scoped.textContent).toBe(violetThemeCssText);
    });

    it("keeps a violet-theme host's unknown preset as written and warns", () => {
        installVioletThemeSet(productSet);
        const scope = document.createElement("violet-theme");
        scope.setAttribute("preset", "dark");

        document.body.append(scope);

        expect(scope.getAttribute(VIOLET_THEME_PRESET_ATTRIBUTE)).toBe("dark");
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/'dark' is not in the installed theme set \(meadow, night-garden\)/));
    });

    it("goes back to the built-in set on reset", () => {
        const style = installVioletThemeSet(productSet);

        resetVioletThemeSet();

        expect(style.textContent).toBe(violetThemeCssText);
        expect(getVioletThemePresets()).toEqual(["light", "dark", "high-contrast"]);
    });

    it("refuses an unsound set before installing anything", () => {
        const unsound = {
            defaultPreset: "noon",
            presets: {
                "bad name": [],
                meadow: [
                    { id: "color..page", value: "#fff" },
                    { id: "color.text.primary", value: "red; } body { display: none" },
                    { id: "color.text.primary", value: "red" },
                ],
            },
        } as VioletThemeSet;

        expect(validateVioletThemeSet(unsound)).toEqual([
            "the default preset 'noon' is not one of the presets (bad name, meadow)",
            "the preset name 'bad name' must be letters, digits, '-' and '_', starting with a letter or digit",
            'the preset \'meadow\' has a token with an invalid id "color..page"',
            "the preset 'meadow' has an empty or unsafe value for 'color.text.primary': \"red; } body { display: none\"",
            "the preset 'meadow' lists 'color.text.primary' more than once",
        ]);
        expect(() => installVioletThemeSet(unsound)).toThrow(TypeError);
        expect(runtimeStyles()).toEqual([]);
        expect(getVioletThemePresets()).toEqual(["light", "dark", "high-contrast"]);
        // An open bracket or quote would swallow the rest of the stylesheet, so each is refused.
        for (const value of ["rgb(0 0 0", "var(--x", '"Montserrat', "'Segoe UI", "attr(x]", "a)b", "[x"]) {
            expect(
                validateVioletThemeSet({ defaultPreset: "a", presets: { a: [{ id: "x", value }] } }),
                value,
            ).toEqual([`the preset 'a' has an empty or unsafe value for 'x': ${JSON.stringify(value)}`]);
        }
        for (const value of ["rgb(0 0 0 / 50%)", 'local("a)b"), sans-serif', "calc((1px + 2px) * 2)", "'a(' serif"]) {
            expect(validateVioletThemeSet({ defaultPreset: "a", presets: { a: [{ id: "x", value }] } }), value).toEqual([]);
        }
        expect(validateVioletThemeSet({ defaultPreset: "x", presets: null } as unknown as VioletThemeSet)).toEqual([
            "the theme set has no presets object",
        ]);
    });
});
