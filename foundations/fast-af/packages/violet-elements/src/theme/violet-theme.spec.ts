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
import "./violet-theme.define";

/** The built-in light accent fill, read from the set so a palette change does not break these specs. */
const builtInAccentBackground = violetThemeBuiltInSet.presets.light.find(
    (token) => token.id === "color.accent.background",
)?.value;

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
    document.adoptedStyleSheets = [];
    document.documentElement.removeAttribute(VIOLET_THEME_PRESET_ATTRIBUTE);
    document.body.innerHTML = "";
}

function runtimeSheets(): CSSStyleSheet[] {
    return [...document.adoptedStyleSheets];
}

/** A sheet's rules as the browser serializes them. */
function sheetText(sheet: CSSStyleSheet): string {
    return [...sheet.cssRules].map(rule => rule.cssText).join("\n");
}

/** `cssText` serialized as a constructed sheet holding it would be, to compare with a runtime sheet. */
function parsed(cssText: string): string {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    return sheetText(sheet);
}

/** An iframe whose page forbids every style but adopted ones, loaded and attached. */
async function strictCspFrame(): Promise<HTMLIFrameElement> {
    const frame = document.createElement("iframe");
    frame.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'none'"></head><body></body></html>`;
    const loaded = new Promise(resolve => frame.addEventListener("load", resolve, { once: true }));
    document.body.append(frame);
    await loaded;
    return frame;
}

describe("violet runtime theme", () => {
    beforeEach(async () => {
        resetVioletThemeSet();
        clearRuntimeTheme();
        await loadVioletBuiltInTheme();
    });

    it("adopts one runtime sheet for repeated document installs, without re-parsing it", () => {
        const first = installVioletTheme(document);
        const replaceSync = vi.spyOn(first, "replaceSync");

        const second = installVioletTheme(document);

        expect(second).toBe(first);
        expect(second).toBeInstanceOf(CSSStyleSheet);
        expect(sheetText(second)).toBe(parsed(violetThemeCssText));
        expect(replaceSync).not.toHaveBeenCalled();
        expect(runtimeSheets()).toEqual([first]);
        replaceSync.mockRestore();
    });

    it("appends to the sheets a page adopted itself and writes no style element", () => {
        const own = new CSSStyleSheet();
        document.adoptedStyleSheets = [own];

        const sheet = installVioletTheme(document);

        expect(runtimeSheets()).toEqual([own, sheet]);
        expect(document.querySelectorAll("style[data-violet-theme]")).toHaveLength(0);
        expect(getComputedStyle(document.documentElement).getPropertyValue("--violet-color-accent-background").trim()).toBe(builtInAccentBackground);
    });

    it("adopts the runtime sheet into a shadow root when requested, shared with its document", () => {
        const host = document.createElement("div");
        const shadowRoot = host.attachShadow({ mode: "open" });

        const sheet = installVioletTheme(shadowRoot);

        expect([...shadowRoot.adoptedStyleSheets]).toEqual([sheet]);
        expect(sheetText(sheet)).toBe(parsed(violetThemeCssText));
        expect(shadowRoot.querySelector("style")).toBeNull();
        expect(runtimeSheets()).toEqual([]);
        expect(installVioletTheme(document)).toBe(sheet);
        expect(installVioletTheme(shadowRoot)).toBe(sheet);
        expect([...shadowRoot.adoptedStyleSheets]).toEqual([sheet]);
    });

    it("keeps a sheet per owner document, and themes a page whose policy forbids inline styles", async () => {
        const frame = await strictCspFrame();
        const frameDocument = frame.contentDocument!;
        const frameWindow = frame.contentWindow!;
        // The policy is live: an inline style element is refused.
        const inline = frameDocument.createElement("style");
        inline.textContent = ":root { --inline-probe: 1px; }";
        frameDocument.head.append(inline);
        expect(frameWindow.getComputedStyle(frameDocument.documentElement).getPropertyValue("--inline-probe")).toBe("");

        // A sheet constructed for this document cannot be adopted by the frame's.
        const pageSheet = installVioletTheme(document);
        expect(() => {
            frameDocument.adoptedStyleSheets = [pageSheet];
        }).toThrow();

        const frameSheet = installVioletTheme(frameDocument);

        expect(frameSheet).not.toBe(pageSheet);
        expect([...frameDocument.adoptedStyleSheets]).toEqual([frameSheet]);
        const frameRoot = () => frameWindow.getComputedStyle(frameDocument.documentElement);
        expect(frameRoot().getPropertyValue("--violet-color-accent-background").trim()).toBe(builtInAccentBackground);
        applyVioletThemePreset(frameDocument, "dark");
        expect(frameRoot().getPropertyValue("--violet-color-accent-background").trim()).not.toBe(builtInAccentBackground);

        // A shadow root in the frame's document adopts the frame's sheet, and a set change reaches both documents.
        const host = frameDocument.createElement("div");
        frameDocument.body.append(host);
        const shadowRoot = host.attachShadow({ mode: "open" });
        expect(installVioletTheme(shadowRoot)).toBe(frameSheet);
        installVioletThemeSet(productSet);
        expect(sheetText(frameSheet)).toBe(parsed(createVioletThemeCss(productSet)));
        expect(sheetText(pageSheet)).toBe(parsed(createVioletThemeCss(productSet)));
        applyVioletThemePreset(frameDocument, "meadow");
        expect(frameRoot().getPropertyValue("--violet-color-brand-leaf").trim()).toBe("#2f6b3a");
        resetVioletThemeSet();
        expect(sheetText(frameSheet)).toBe(parsed(violetThemeCssText));
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
        expect(builtInAccentBackground).toMatch(/^#[0-9a-f]{6}$/);
        expect(violetThemeCssText).toBe(createVioletThemeCss(violetThemeBuiltInSet));
        expect(violetThemeCssText.startsWith(":root,\n[data-violet-theme-root]\n{\n  --violet-color-accent-background: #dfecf4;")).toBe(true);
        expect(violetThemeCssText).toContain(':root[data-violet-theme="dark"],\n[data-violet-theme-root][data-violet-theme="dark"]\n{');
        expect(violetThemeDeclarations).toBe(violetThemeDeclarationsByPreset.light);
        expect(violetThemeDeclarations).toContain('  --violet-font-family-body: "Inter", system-ui, sans-serif;');
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

    it("connects violet-theme hosts as scoped roots and ensures the runtime sheet is adopted", () => {
        const scope = document.createElement("violet-theme");

        document.body.append(scope);

        expect(scope.hasAttribute(VIOLET_THEME_ROOT_ATTRIBUTE)).toBe(true);
        expect(scope.getAttribute(VIOLET_THEME_PRESET_ATTRIBUTE)).toBe(VIOLET_THEME_DEFAULT_PRESET);
        expect(runtimeSheets()).toHaveLength(1);
        expect(sheetText(runtimeSheets()[0]!)).toBe(parsed(violetThemeCssText));
    });

    it("adopts the runtime sheet into a shadow root when violet-theme is used inside one", () => {
        const host = document.createElement("div");
        const shadowRoot = host.attachShadow({ mode: "open" });
        const scope = document.createElement("violet-theme");
        scope.setAttribute("preset", "dark");

        document.body.append(host);
        shadowRoot.append(scope);

        expect(scope.hasAttribute(VIOLET_THEME_ROOT_ATTRIBUTE)).toBe(true);
        expect(shadowRoot.adoptedStyleSheets).toHaveLength(1);
        expect(sheetText(shadowRoot.adoptedStyleSheets[0]!)).toBe(parsed(violetThemeCssText));
        expect(runtimeSheets()).toEqual([]);
        expect(getComputedStyle(scope).getPropertyValue("--violet-color-accent-background").trim()).not.toBe(builtInAccentBackground);
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
        const sheet = installVioletThemeSet(productSet);

        expect(runtimeSheets()).toEqual([sheet]);
        expect(sheetText(sheet)).toBe(parsed(createVioletThemeCss(productSet)));
        expect(sheetText(sheet)).not.toContain("--violet-color-action-danger-background");
        expect(sheetText(sheet)).toContain('[data-violet-theme-root][data-violet-theme="night-garden"]');
        expect(getComputedStyle(document.documentElement).getPropertyValue("--violet-color-brand-leaf").trim()).toBe("#2f6b3a");
        expect(getVioletThemePresets()).toEqual(["meadow", "night-garden"]);
        expect(getVioletThemeDefaultPreset()).toBe("meadow");
        expect(getVioletThemePreset(document)).toBe("meadow");

        // Later installs, by violet-theme hosts among them, write the product's set, not the built-in one.
        expect(installVioletTheme(document)).toBe(sheet);
        expect(runtimeSheets()).toEqual([sheet]);
        expect(sheetText(sheet)).toBe(parsed(createVioletThemeCss(productSet)));
    });

    it("selects a non-default preset on the document", () => {
        installVioletThemeSet(productSet);

        applyVioletThemePreset(document, "night-garden");

        const root = getComputedStyle(document.documentElement);
        expect(getVioletThemePreset(document)).toBe("night-garden");
        expect(root.getPropertyValue("--violet-color-surface-page").trim()).toBe("#101410");
        // A preset inherits what it does not set from the default.
        expect(root.getPropertyValue("--violet-font-family-body").trim()).toBe("Georgia, serif");
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

        expect(getComputedStyle(section).getPropertyValue("--violet-color-text-primary").trim()).toBe("#e6eee0");
        expect(getComputedStyle(scope).getPropertyValue("--violet-color-text-primary").trim()).toBe("#e6eee0");
        expect(plain.getAttribute(VIOLET_THEME_PRESET_ATTRIBUTE)).toBe("meadow");
        expect(getComputedStyle(plain).getPropertyValue("--violet-color-text-primary").trim()).toBe("#1f2a1c");
        expect(warn).not.toHaveBeenCalled();
    });

    it("replaces the built-in set in shadow roots installed before it", () => {
        const host = document.createElement("div");
        const shadowRoot = host.attachShadow({ mode: "open" });
        document.body.append(host);
        shadowRoot.append(document.createElement("violet-theme"));
        const [scoped] = shadowRoot.adoptedStyleSheets;
        expect(sheetText(scoped!)).toBe(parsed(violetThemeCssText));

        installVioletThemeSet(productSet);

        expect([...shadowRoot.adoptedStyleSheets]).toEqual([scoped]);
        expect(sheetText(scoped!)).toBe(parsed(createVioletThemeCss(productSet)));
    });

    it("reaches a shadow root that was detached when the set changed, once it is attached again", () => {
        const host = document.createElement("div");
        const shadowRoot = host.attachShadow({ mode: "open" });
        document.body.append(host);
        const scoped = installVioletTheme(shadowRoot);
        const scope = applyVioletThemeRoot(document.createElement("div"));
        shadowRoot.append(scope);
        host.remove();
        expect(host.isConnected).toBe(false);

        installVioletThemeSet(productSet);
        document.body.append(host);

        expect([...shadowRoot.adoptedStyleSheets]).toEqual([scoped]);
        expect(sheetText(scoped)).toBe(parsed(createVioletThemeCss(productSet)));
        expect(getComputedStyle(scope).getPropertyValue("--violet-color-brand-leaf").trim()).toBe("#2f6b3a");
        resetVioletThemeSet();
        expect(sheetText(scoped)).toBe(parsed(violetThemeCssText));
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
        const sheet = installVioletThemeSet(productSet);

        resetVioletThemeSet();

        expect(sheetText(sheet)).toBe(parsed(violetThemeCssText));
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
        expect(runtimeSheets()).toEqual([]);
        expect(getVioletThemePresets()).toEqual(["light", "dark", "high-contrast"]);
        // An open bracket or quote would swallow the rest of the stylesheet, so each is refused.
        for (const value of ["rgb(0 0 0", "var(--x", '"Inter', "'Segoe UI", "attr(x]", "a)b", "[x"]) {
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

describe("the runtime sheet's targets", () => {
    let error: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        resetVioletThemeSet();
        clearRuntimeTheme();
        await loadVioletBuiltInTheme();
        error = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        error.mockRestore();
        resetVioletThemeSet();
        clearRuntimeTheme();
    });

    it("refuses a document with no window, and a target that is not a document or shadow root", async () => {
        const noWindow = /this document has no window; a constructed stylesheet cannot be adopted into it/;
        const created = document.implementation.createHTMLDocument("created");
        const parsedDocument = new DOMParser().parseFromString("<!doctype html><p>parsed</p>", "text/html");
        const frame = await strictCspFrame();
        const frameDocument = frame.contentDocument!;
        frame.remove();
        expect(frameDocument.defaultView).toBeNull();

        for (const windowless of [created, parsedDocument, frameDocument]) {
            expect(() => installVioletTheme(windowless)).toThrow(TypeError);
            expect(() => installVioletTheme(windowless)).toThrow(noWindow);
            expect([...windowless.adoptedStyleSheets]).toEqual([]);
        }
        const notATarget = document.createElement("div") as unknown as Document;
        expect(() => installVioletTheme(notATarget)).toThrow(TypeError);
        expect(() => installVioletTheme(notATarget)).toThrow(/must be a Document or a ShadowRoot/);

        // A set refused for its target is not installed either.
        expect(() => installVioletThemeSet(productSet, created)).toThrow(noWindow);
        expect(getVioletThemePresets()).toEqual(["light", "dark", "high-contrast"]);
        expect(runtimeSheets()).toEqual([]);
    });

    it("records no sheet when the target refuses it", async () => {
        const frame = await strictCspFrame();
        const frameDocument = frame.contentDocument!;
        const constructed: CSSStyleSheet[] = [];
        // The frame's document refuses an adoption, recording the sheet it was offered.
        Object.defineProperty(frameDocument, "adoptedStyleSheets", {
            configurable: true,
            get: () => [],
            set: (sheets: CSSStyleSheet[]) => {
                constructed.push(...sheets);
                throw new DOMException("refused", "NotAllowedError");
            },
        });

        expect(() => installVioletTheme(frameDocument)).toThrow("refused");
        delete (frameDocument as { adoptedStyleSheets?: unknown }).adoptedStyleSheets;
        const [orphan] = constructed;
        expect(orphan).toBeDefined();

        // The refused sheet is not the frame's: the next install makes another, and a set change skips it.
        const sheet = installVioletTheme(frameDocument);
        expect(sheet).not.toBe(orphan);
        expect([...frameDocument.adoptedStyleSheets]).toEqual([sheet]);
        installVioletThemeSet(productSet);
        expect(sheetText(sheet)).toBe(parsed(createVioletThemeCss(productSet)));
        expect(sheetText(orphan!)).toBe(parsed(violetThemeCssText));
    });

    it("still rewrites the document's sheet after an adopted iframe is removed", async () => {
        const pageSheet = installVioletTheme(document);
        const frame = await strictCspFrame();
        const frameSheet = installVioletTheme(frame.contentDocument!);
        expect(frameSheet).not.toBe(pageSheet);

        frame.remove();
        installVioletThemeSet(productSet);

        expect(runtimeSheets()).toEqual([pageSheet]);
        expect(sheetText(pageSheet)).toBe(parsed(createVioletThemeCss(productSet)));
        expect(getComputedStyle(document.documentElement).getPropertyValue("--violet-color-brand-leaf").trim()).toBe("#2f6b3a");
        // Chromium still writes a removed iframe's sheet, so its removal is no failure to report.
        expect(error).not.toHaveBeenCalled();
    });

    it("keeps rewriting the other sheets when one cannot be written, and drops that one", async () => {
        const frame = await strictCspFrame();
        const frameSheet = installVioletTheme(frame.contentDocument!);
        const pageSheet = installVioletTheme(document);
        const broken = vi.spyOn(frameSheet, "replaceSync").mockImplementation(() => {
            throw new DOMException("gone", "NotAllowedError");
        });

        installVioletThemeSet(productSet);

        expect(sheetText(pageSheet)).toBe(parsed(createVioletThemeCss(productSet)));
        expect(error).toHaveBeenCalledWith(expect.stringMatching(/could not be rewritten/), expect.any(DOMException));
        expect(broken).toHaveBeenCalledTimes(1);

        // Dropped: later changes no longer try it, and the frame's next install makes a new sheet.
        resetVioletThemeSet();
        expect(broken).toHaveBeenCalledTimes(1);
        expect(sheetText(pageSheet)).toBe(parsed(violetThemeCssText));
        const replacement = installVioletTheme(frame.contentDocument!);
        expect(replacement).not.toBe(frameSheet);
        expect(sheetText(replacement)).toBe(parsed(violetThemeCssText));
        broken.mockRestore();
    });
});

// The alias block (#1786, phase 4) names the properties before contract version 4 on purpose, so
// these lines are marked for the codemod to leave. Removed with the block in the next release.
describe("the deprecated alias block", () => {
    const OLD_PAGE = "--color-surface-page"; // violet-prefix: keep
    const OLD_LEAF = "--color-brand-leaf"; // violet-prefix: keep

    afterEach(() => {
        resetVioletThemeSet();
        clearRuntimeTheme();
    });

    it("ends the sheet with each id of every preset once, under its old name, on the default selectors", () => {
        const css = createVioletThemeCss(productSet);
        const block = css.slice(css.lastIndexOf(":root,\n[data-violet-theme-root]\n{"));
        expect(block.split("\n").slice(3, -1)).toEqual([
            "  --color-surface-page: var(--violet-color-surface-page);", // violet-prefix: keep
            "  --color-text-primary: var(--violet-color-text-primary);", // violet-prefix: keep
            "  --font-family-body: var(--violet-font-family-body);", // violet-prefix: keep
            "  --color-brand-leaf: var(--violet-color-brand-leaf);", // violet-prefix: keep
        ]);
        expect(css.indexOf(block)).toBeGreaterThan(css.indexOf('[data-violet-theme="night-garden"]'));
        expect(violetThemeCssText).toContain("  --color-action-danger-background: var(--violet-color-action-danger-background);"); // violet-prefix: keep
    });

    it("resolves an old name to its preset's value on the document and in each scoped root", () => {
        installVioletThemeSet(productSet);
        const root = () => getComputedStyle(document.documentElement);
        expect(root().getPropertyValue(OLD_PAGE).trim()).toBe("#f4f7ee");
        expect(root().getPropertyValue(OLD_LEAF).trim()).toBe("#2f6b3a");

        const scope = document.createElement("section");
        document.body.append(scope);
        applyVioletThemeRoot(scope, "night-garden");
        // Declared on the scoped root too, so it computes from that root's own preset, not the page's.
        expect(getComputedStyle(scope).getPropertyValue(OLD_PAGE).trim()).toBe("#101410");
        const child = document.createElement("p");
        scope.append(child);
        expect(getComputedStyle(child).getPropertyValue(OLD_PAGE).trim()).toBe("#101410");

        applyVioletThemePreset(document, "night-garden");
        expect(root().getPropertyValue(OLD_PAGE).trim()).toBe("#101410");
        // An id only the default preset sets is inherited, under either name.
        expect(root().getPropertyValue(OLD_LEAF).trim()).toBe("#2f6b3a");
    });
});
