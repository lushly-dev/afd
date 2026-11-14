/**
 * Installs a Violet theme set and selects its presets on the document or a scoped
 * `[data-violet-theme-root]`.
 *
 * With nothing installed, the active set is the built-in default (`violetThemeBuiltInSet`), so
 * `installVioletTheme()` stays the zero-config route. A product that brings its own tree calls
 * `installVioletThemeSet()` instead: its set replaces the built-in one wherever this module has
 * installed a theme, and the built-in stylesheet is never written.
 */
import { violetThemeBuiltInSet } from "./generated/violet-theme.generated";
import {
    createVioletThemeCss,
    VIOLET_THEME_PRESET_ATTRIBUTE,
    VIOLET_THEME_ROOT_ATTRIBUTE,
    type VioletThemePreset,
    type VioletThemeSet,
    violetTokenProperty,
} from "./violet-theme-css";

export type { VioletBuiltInThemePreset } from "./generated/violet-theme.generated";
export { violetThemeBuiltInSet };

/** The built-in default set's default preset. */
export const VIOLET_THEME_DEFAULT_PRESET = violetThemeBuiltInSet.defaultPreset;

/** The built-in default set's presets. */
export const violetThemePresets: readonly VioletThemePreset[] = Object.keys(violetThemeBuiltInSet.presets);

/** The built-in default set's stylesheet. */
export const violetThemeCssText = createVioletThemeCss(violetThemeBuiltInSet);

/** The built-in default set's declarations, per preset, one `  --property: value;` per line. */
export const violetThemeDeclarationsByPreset: Readonly<Record<VioletThemePreset, string>> = Object.fromEntries(
    Object.entries(violetThemeBuiltInSet.presets).map(([name, tokens]) => [
        name,
        tokens.map(token => `  ${violetTokenProperty(token.id)}: ${token.value};`).join("\n"),
    ]),
);

/** The built-in default preset's declarations. */
export const violetThemeDeclarations = violetThemeDeclarationsByPreset[VIOLET_THEME_DEFAULT_PRESET];

interface ActiveThemeSet {
    readonly cssText: string;
    readonly presets: readonly VioletThemePreset[];
    readonly defaultPreset: VioletThemePreset;
}

const builtIn: ActiveThemeSet = {
    cssText: violetThemeCssText,
    presets: violetThemePresets,
    defaultPreset: VIOLET_THEME_DEFAULT_PRESET,
};

let active: ActiveThemeSet = builtIn;

/** Every runtime style element this module wrote, so a newly installed set reaches all of them. */
const installedStyles = new Set<HTMLStyleElement>();

function isShadowRoot(target: unknown): target is ShadowRoot {
    return typeof ShadowRoot !== "undefined" && target instanceof ShadowRoot;
}

function isDocument(target: unknown): target is Document {
    return typeof Document !== "undefined" && target instanceof Document;
}

function resolveStyleContainer(target: Document | ShadowRoot = document): ShadowRoot | HTMLElement {
    if (isShadowRoot(target)) {
        return target;
    }

    if (isDocument(target)) {
        return target.head ?? target.documentElement;
    }

    return document.head ?? document.documentElement;
}

function resolvePresetTarget(target: Document | HTMLElement = document): HTMLElement {
    if (isDocument(target)) {
        return target.documentElement;
    }

    return target;
}

function writeStyle(target: Document | ShadowRoot): HTMLStyleElement {
    const styleContainer = resolveStyleContainer(target);
    const existing = styleContainer.querySelector('style[data-violet-theme="runtime"]');
    const ownerDocument = isShadowRoot(target) ? target.ownerDocument : isDocument(target) ? target : document;
    const style = existing instanceof HTMLStyleElement ? existing : ownerDocument.createElement("style");

    style.dataset.violetTheme = "runtime";
    style.textContent = active.cssText;
    if (!style.isConnected) {
        styleContainer.append(style);
    }
    installedStyles.add(style);
    return style;
}

function refreshInstalledStyles(): void {
    for (const style of installedStyles) {
        if (style.isConnected) {
            style.textContent = active.cssText;
        } else {
            installedStyles.delete(style);
        }
    }
}

/**
 * Writes the active theme set's stylesheet into `target` (the document's head by default, or a
 * shadow root), reusing the runtime style element already there. The active set is the built-in
 * default unless `installVioletThemeSet()` installed another.
 */
export function installVioletTheme(target: Document | ShadowRoot = document): HTMLStyleElement {
    return writeStyle(target);
}

/**
 * Makes `themeSet` the active theme set, replacing the built-in default, and writes it into
 * `target` and every runtime style element installed before, so scoped `violet-theme` hosts in
 * shadow roots switch too. Preset names are the set's own. Throws a `TypeError` when the set is not
 * sound (see `validateVioletThemeSet`); completeness against `tokens/interface.json` is a build-time
 * check (`findVioletThemeSetGaps`).
 *
 * @example
 * ```ts
 * import { applyVioletThemePreset, installVioletThemeSet } from "@lushly-dev/violet-elements";
 *
 * installVioletThemeSet({
 *     defaultPreset: "light",
 *     presets: { light: lightTokens, dark: darkTokens, sepia: sepiaTokens },
 * });
 * applyVioletThemePreset(document, "sepia");
 * ```
 */
export function installVioletThemeSet(
    themeSet: VioletThemeSet,
    target: Document | ShadowRoot = document,
): HTMLStyleElement {
    active = {
        cssText: createVioletThemeCss(themeSet),
        presets: Object.keys(themeSet.presets),
        defaultPreset: themeSet.defaultPreset,
    };
    refreshInstalledStyles();
    return writeStyle(target);
}

/** Makes the built-in default the active set again and rewrites every installed runtime style. */
export function resetVioletThemeSet(): void {
    active = builtIn;
    refreshInstalledStyles();
}

/** The active set's preset names. */
export function getVioletThemePresets(): readonly VioletThemePreset[] {
    return active.presets;
}

/** The active set's default preset. */
export function getVioletThemeDefaultPreset(): VioletThemePreset {
    return active.defaultPreset;
}

/** Whether `value` names a preset of the active set. */
export function isVioletThemePreset(value: string | null | undefined): value is VioletThemePreset {
    return typeof value === "string" && active.presets.includes(value);
}

/**
 * The active set's preset `value` names: the default preset for `null`, `undefined` or an empty
 * string, `value` itself when the active set has it. Throws a `RangeError` for any other name; it
 * is never mapped to the default.
 */
export function normalizeVioletThemePreset(value: string | null | undefined): VioletThemePreset {
    if (value === null || value === undefined || value === "") {
        return active.defaultPreset;
    }
    if (isVioletThemePreset(value)) {
        return value;
    }
    throw new RangeError(`Unknown Violet theme preset '${value}'; the installed presets are ${active.presets.join(", ")}`);
}

/**
 * Selects a preset of the active set on the document root or an element. Throws a `RangeError` for
 * a name the active set does not have, so install a product's set before selecting its presets.
 */
export function applyVioletThemePreset<T extends Document | HTMLElement>(target: T, preset?: VioletThemePreset): T {
    resolvePresetTarget(target).setAttribute(VIOLET_THEME_PRESET_ATTRIBUTE, normalizeVioletThemePreset(preset));
    return target;
}

/**
 * The preset selected on the document root or an element: its `data-violet-theme` attribute as
 * written, or the active set's default when it has none.
 */
export function getVioletThemePreset(target: Document | HTMLElement = document): VioletThemePreset {
    return resolvePresetTarget(target).getAttribute(VIOLET_THEME_PRESET_ATTRIBUTE) || active.defaultPreset;
}

/** Marks an element as a scoped theme root and selects a preset of the active set on it. */
export function applyVioletThemeRoot<T extends HTMLElement>(element: T, preset?: VioletThemePreset): T {
    const resolved = normalizeVioletThemePreset(preset);
    element.setAttribute(VIOLET_THEME_ROOT_ATTRIBUTE, "");
    element.setAttribute(VIOLET_THEME_PRESET_ATTRIBUTE, resolved);
    return element;
}
