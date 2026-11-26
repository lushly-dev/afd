/**
 * Installs a Violet theme set and selects its presets on the document or a scoped
 * `[data-violet-theme-root]`.
 *
 * With nothing installed, the active set is the built-in default, so `installVioletTheme()` stays
 * the zero-config route. A product that brings its own tree calls `installVioletThemeSet()`
 * instead: its set replaces the built-in one wherever this module has installed a theme.
 *
 * The built-in set's values live in `violet-theme-builtin`, which this module never imports
 * statically: `installVioletTheme()` loads it on first use, with a dynamic import, and writes it
 * into the adopted sheets once it arrives (the components' literal fallbacks are its light values
 * meanwhile). A product that installs its own set first never loads it, and a bundler keeps it in a
 * chunk of its own.
 */
import {
  VIOLET_THEME_DEFAULT_PRESET,
  violetThemePresets,
} from "./generated/violet-theme-presets.generated";
import {
  createVioletThemeCss,
  VIOLET_THEME_PRESET_ATTRIBUTE,
  VIOLET_THEME_ROOT_ATTRIBUTE,
  type VioletThemePreset,
  type VioletThemeSet,
} from "./violet-theme-css";
import { isDocument, isShadowRoot } from "./violet-theme-nodes";

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
 * The runtime stylesheet of each owner document. A constructed sheet can be adopted only by the
 * document it was constructed for and that document's shadow roots, so a document and its shadow
 * roots share one sheet and an iframe's document gets its own. Held weakly by document.
 */
const sheetsByDocument = new WeakMap<Document, CSSStyleSheet>();
/**
 * Every runtime sheet, held weakly so a dropped document's sheet can be collected, and rewritten on
 * every change, so every root that adopted it, connected or not, is current at once.
 */
const installedSheets = new Set<WeakRef<CSSStyleSheet>>();
/** The document each runtime sheet was made for, to forget it when it can no longer be written. */
const documentBySheet = new WeakMap<CSSStyleSheet, Document>();
/** The text this module last wrote into each sheet, so a repeated install does not re-parse it. */
const writtenText = new WeakMap<CSSStyleSheet, string>();

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
    loadVioletBuiltInTheme().catch((error: unknown) => {
      console.error(
        "violet-theme: the built-in theme failed to load; the next install retries",
        error,
      );
    });
    return "";
  }
  return builtInCssText;
}

/**
 * Loads the built-in default set's stylesheet, writing it into every runtime sheet if no product
 * set is active by then. `installVioletTheme()` calls it; await it to know the built-in
 * theme is applied. A failed load (a chunk that did not arrive) rejects and is not cached, so the
 * next call, or the next install, tries again.
 */
export function loadVioletBuiltInTheme(): Promise<string> {
  // Defer the dynamic import by a microtask so single-file bundles finish initializing
  // `violet-theme-builtin` when a pre-existing `<violet-theme>` upgrades synchronously during
  // `FASTElement.define`. When a single-file bundle also awaits further element registrations
  // before the inlined built-in module runs, its hoisted `var` namespace is still `undefined`
  // (or its `const` bindings are still in TDZ) after one microtask; yield one macrotask so all
  // registration microtasks drain, then retry once (#2072).
  const load = async (): Promise<string> => {
    await Promise.resolve();
    let cssText: string | undefined;
    try {
      const module = await importBuiltIn();
      cssText = module?.violetThemeCssText;
    } catch (error) {
      if (!(error instanceof ReferenceError)) {
        throw error;
      }
    }
    if (cssText === undefined) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const module = await importBuiltIn();
      if (module?.violetThemeCssText === undefined) {
        throw new TypeError(
          "violet-theme: built-in theme module did not export violetThemeCssText",
        );
      }
      cssText = module.violetThemeCssText;
    }
    builtInCssText = cssText;
    if (product === null) {
      refreshInstalledSheets();
    }
    return cssText;
  };
  builtInLoad ??= load().catch((error: unknown) => {
    builtInLoad = undefined;
    throw error;
  });
  return builtInLoad;
}

type BuiltInImporter = () => Promise<{ violetThemeCssText: string }>;

let importBuiltIn: BuiltInImporter = () => import("./violet-theme-builtin");

/**
 * Replaces how the built-in set's module is imported, for this package's specs: a browser caches a
 * module that failed, so a spec cannot make the real chunk fail once and then load. Not exported
 * from the package root; the `./theme-runtime` entry exports the whole module, so it is reachable
 * there, but it is not part of the supported API and may change without notice.
 *
 * @internal
 */
export function setVioletBuiltInThemeImporterForTesting(importer: BuiltInImporter): void {
  importBuiltIn = importer;
  builtInLoad = undefined;
  builtInCssText = undefined;
}

function resolvePresetTarget(target: Document | HTMLElement = document): HTMLElement {
  if (isDocument(target)) {
    return target.documentElement;
  }

  return target;
}

/**
 * The document `target` belongs to, which must have a window: a constructed sheet is made by a
 * window's `CSSStyleSheet` and can be adopted only within the document it was made for.
 */
function ownerDocumentOf(
  target: Document | ShadowRoot,
): Document & { defaultView: Window & typeof globalThis } {
  let ownerDocument: Document;
  if (isDocument(target)) {
    ownerDocument = target;
  } else if (isShadowRoot(target)) {
    ownerDocument = target.ownerDocument;
  } else {
    throw new TypeError("violet-theme: the target must be a Document or a ShadowRoot");
  }
  if (ownerDocument.defaultView === null) {
    throw new TypeError(
      "violet-theme: this document has no window; a constructed stylesheet cannot be adopted into it",
    );
  }
  return ownerDocument as Document & { defaultView: Window & typeof globalThis };
}

function writeSheet(sheet: CSSStyleSheet, cssText: string): void {
  if (writtenText.get(sheet) !== cssText) {
    sheet.replaceSync(cssText);
    writtenText.set(sheet, cssText);
  }
}

/** Drops the references to sheets that have been collected. */
function pruneInstalledSheets(): void {
  for (const ref of installedSheets) {
    if (ref.deref() === undefined) {
      installedSheets.delete(ref);
    }
  }
}

/**
 * Adopts the owner document's runtime sheet into `target`, constructing it by that document's
 * window the first time. The sheet is recorded only once it is adopted, so a failed adoption
 * leaves nothing behind.
 */
function adoptSheet(target: Document | ShadowRoot): CSSStyleSheet {
  const ownerDocument = ownerDocumentOf(target);
  const existing = sheetsByDocument.get(ownerDocument);
  const sheet = existing ?? new ownerDocument.defaultView.CSSStyleSheet();
  writeSheet(sheet, activeCssText());
  if (!target.adoptedStyleSheets.includes(sheet)) {
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
  }
  if (existing === undefined) {
    sheetsByDocument.set(ownerDocument, sheet);
    documentBySheet.set(sheet, ownerDocument);
    pruneInstalledSheets();
    installedSheets.add(new WeakRef(sheet));
  }
  return sheet;
}

/**
 * Rewrites every runtime sheet with the active stylesheet. A sheet that cannot be written is logged
 * and dropped, so it does not stop the others, and its document's next install makes a new one.
 */
function refreshInstalledSheets(): void {
  const cssText = activeCssText();
  for (const ref of installedSheets) {
    const sheet = ref.deref();
    if (sheet === undefined) {
      installedSheets.delete(ref);
      continue;
    }
    try {
      writeSheet(sheet, cssText);
    } catch (error) {
      console.error(
        "violet-theme: a runtime sheet could not be rewritten and is no longer updated",
        error,
      );
      installedSheets.delete(ref);
      const ownerDocument = documentBySheet.get(sheet);
      if (ownerDocument !== undefined && sheetsByDocument.get(ownerDocument) === sheet) {
        sheetsByDocument.delete(ownerDocument);
      }
    }
  }
}

/**
 * Adopts the active theme set's stylesheet into `target` (the document by default, or a shadow
 * root) through `adoptedStyleSheets`, appending it once and never twice, and returns it. A document
 * and its shadow roots share one constructed sheet, so no `<style>` element is written and a page
 * whose Content Security Policy forbids inline styles needs no exception. The active set is the
 * built-in default unless `installVioletThemeSet()` installed another; the built-in stylesheet is
 * written when its module has loaded (`loadVioletBuiltInTheme()`).
 *
 * The returned sheet is the runtime's: it is rewritten whenever the active set changes, so an edit
 * made to it lasts only until then, and a repeated install does not undo one. Throws a `TypeError`
 * when `target` is neither a document nor a shadow root, or its document has no window (one made
 * by `createHTMLDocument` or `DOMParser`, or an iframe's once the iframe is removed).
 */
export function installVioletTheme(target: Document | ShadowRoot = document): CSSStyleSheet {
  return adoptSheet(target);
}

/**
 * Makes `themeSet` the active theme set, replacing the built-in default, rewrites every runtime
 * sheet with it, so every document and shadow root that adopted one, scoped `violet-theme` hosts
 * among them, switches at once, and adopts the sheet into `target` as `installVioletTheme()` does.
 * Preset names are the set's own. Throws a `TypeError` when the set is not sound (see
 * `validateVioletThemeSet`), or when `target` is not a document or shadow root that can take a
 * constructed sheet; both are checked before anything changes. A target that refuses the adoption
 * itself throws after the set has changed. Completeness against `tokens/interface.json` is a build-time check (`findVioletThemeSetGaps`).
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
): CSSStyleSheet {
  const cssText = createVioletThemeCss(themeSet);
  ownerDocumentOf(target);
  product = {
    cssText,
    presets: Object.keys(themeSet.presets),
    defaultPreset: themeSet.defaultPreset,
  };
  refreshInstalledSheets();
  return adoptSheet(target);
}

/** Makes the built-in default the active set again and rewrites every runtime sheet. */
export function resetVioletThemeSet(): void {
  product = null;
  refreshInstalledSheets();
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
  throw new RangeError(
    `Unknown Violet theme preset '${value}'; the installed presets are ${activePresets().join(", ")}`,
  );
}

/**
 * Selects a preset of the active set on the document root or an element. Throws a `RangeError` for
 * a name the active set does not have, so install a product's set before selecting its presets.
 */
export function applyVioletThemePreset<T extends Document | HTMLElement>(
  target: T,
  preset?: VioletThemePreset,
): T {
  resolvePresetTarget(target).setAttribute(
    VIOLET_THEME_PRESET_ATTRIBUTE,
    normalizeVioletThemePreset(preset),
  );
  return target;
}

/**
 * The preset selected on the document root or an element: its `data-violet-theme` attribute as
 * written, or the active set's default when it has none.
 */
export function getVioletThemePreset(target: Document | HTMLElement = document): VioletThemePreset {
  return (
    resolvePresetTarget(target).getAttribute(VIOLET_THEME_PRESET_ATTRIBUTE) || activeDefaultPreset()
  );
}

/** Marks an element as a scoped theme root and selects a preset of the active set on it. */
export function applyVioletThemeRoot<T extends HTMLElement>(
  element: T,
  preset?: VioletThemePreset,
): T {
  const resolved = normalizeVioletThemePreset(preset);
  element.setAttribute(VIOLET_THEME_ROOT_ATTRIBUTE, "");
  element.setAttribute(VIOLET_THEME_PRESET_ATTRIBUTE, resolved);
  return element;
}
