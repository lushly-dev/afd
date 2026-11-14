/**
 * Installs a Violet theme set and selects its presets on the document or a scoped
 * `[data-violet-theme-root]`.
 *
 * With nothing installed, the active set is the built-in default, so `installVioletTheme()` stays
 * the zero-config route. A product that brings its own tree calls `installVioletThemeSet()`
 * instead: its set replaces the built-in one wherever this module has installed a theme.
 *
 * The built-in set's values live in `violet-theme-builtin`, which this module never imports
 * statically: `installVioletTheme()` loads it on first use, with a dynamic import, and writes its
 * stylesheet once it arrives (the components' literal fallbacks are its light values meanwhile). A
 * product that installs its own set first never loads it, and a bundler keeps it in a chunk of its
 * own.
 */
import { VIOLET_THEME_DEFAULT_PRESET, violetThemePresets } from "./generated/violet-theme-presets.generated";
import {
    createVioletThemeCss,
    VIOLET_THEME_PRESET_ATTRIBUTE,
    VIOLET_THEME_ROOT_ATTRIBUTE,
    type VioletThemePreset,
    type VioletThemeSet,
} from "./violet-theme-css";

export {
    VIOLET_THEME_DEFAULT_PRESET,
    type VioletBuiltInThemePreset,
    violetThemePresets,
} from "./generated/violet-theme-presets.generated";

interface ProductThemeSet {
    readonly cssText: string;
    readonly presets: readonly VioletThemePreset[];
    readonly defaultPreset: VioletThemePreset;
}

/** The product's set; `null` while the built-in default is active. */
let product: ProductThemeSet | null = null;
/** The built-in stylesheet, once its module has loaded. */
let builtInCssText: string | undefined;
let builtInLoad: Promise<string> | undefined;

/**
 * Every runtime style element this module wrote, held weakly so a removed shadow root's style can
 * be collected, and written on every change, connected or not, so one reattached later is current.
 */
const installedStyles = new Set<WeakRef<HTMLStyleElement>>();
const trackedStyles = new WeakSet<HTMLStyleElement>();

function activePresets(): readonly VioletThemePreset[] {
    return product?.presets ?? violetThemePresets;
}

function activeDefaultPreset(): VioletThemePreset {
    return product?.defaultPreset ?? VIOLET_THEME_DEFAULT_PRESET;
}

/** The active stylesheet; empty while the built-in one is still loading. */
function activeCssText(): string {
    if (product !== null) {
        return product.cssText;
    }
    if (builtInCssText === undefined) {
        void loadVioletBuiltInTheme();
        return "";
    }
    return builtInCssText;
}

/**
 * Loads the built-in default set's stylesheet, writing it into every installed runtime style if no
 * product set is active by then. `installVioletTheme()` calls it; await it to know the built-in
 * theme is applied.
 */
export function loadVioletBuiltInTheme(): Promise<string> {
    builtInLoad ??= import("./violet-theme-builtin").then(module => {
        builtInCssText = module.violetThemeCssText;
        if (product === null) {
            refreshInstalledStyles();
        }
        return builtInCssText;
    });
    return builtInLoad;
}

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
    style.textContent = activeCssText();
    if (!style.isConnected) {
        styleContainer.append(style);
    }
    if (!trackedStyles.has(style)) {
        trackedStyles.add(style);
        installedStyles.add(new WeakRef(style));
    }
    return style;
}

function refreshInstalledStyles(): void {
    const cssText = activeCssText();
    for (const ref of installedStyles) {
        const style = ref.deref();
        if (style === undefined) {
            installedStyles.delete(ref);
        } else {
            style.textContent = cssText;
        }
    }
}

/**
 * Writes the active theme set's stylesheet into `target` (the document's head by default, or a
 * shadow root), reusing the runtime style element already there. The active set is the built-in
 * default unless `installVioletThemeSet()` installed another; the built-in stylesheet is written
 * when its module has loaded (`loadVioletBuiltInTheme()`).
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
    product = {
        cssText: createVioletThemeCss(themeSet),
        presets: Object.keys(themeSet.presets),
        defaultPreset: themeSet.defaultPreset,
    };
    refreshInstalledStyles();
    return writeStyle(target);
}

/** Makes the built-in default the active set again and rewrites every installed runtime style. */
export function resetVioletThemeSet(): void {
    product = null;
    refreshInstalledStyles();
}

/** The active set's preset names. */
export function getVioletThemePresets(): readonly VioletThemePreset[] {
    return activePresets();
}

/** The active set's default preset. */
export function getVioletThemeDefaultPreset(): VioletThemePreset {
    return activeDefaultPreset();
}

/** Whether `value` names a preset of the active set. */
export function isVioletThemePreset(value: string | null | undefined): value is VioletThemePreset {
    return typeof value === "string" && activePresets().includes(value);
}

/**
 * The active set's preset `value` names: the default preset for `null`, `undefined` or an empty
 * string, `value` itself when the active set has it. Throws a `RangeError` for any other name; it
 * is never mapped to the default.
 */
export function normalizeVioletThemePreset(value: string | null | undefined): VioletThemePreset {
    if (value === null || value === undefined || value === "") {
        return activeDefaultPreset();
    }
    if (isVioletThemePreset(value)) {
        return value;
    }
    throw new RangeError(`Unknown Violet theme preset '${value}'; the installed presets are ${activePresets().join(", ")}`);
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
    return resolvePresetTarget(target).getAttribute(VIOLET_THEME_PRESET_ATTRIBUTE) || activeDefaultPreset();
}

/** Marks an element as a scoped theme root and selects a preset of the active set on it. */
export function applyVioletThemeRoot<T extends HTMLElement>(element: T, preset?: VioletThemePreset): T {
    const resolved = normalizeVioletThemePreset(preset);
    element.setAttribute(VIOLET_THEME_ROOT_ATTRIBUTE, "");
    element.setAttribute(VIOLET_THEME_PRESET_ATTRIBUTE, resolved);
    return element;
}
