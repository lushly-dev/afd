/**
 * The built-in default theme set, AFD's default shared with Loam, and its stylesheet. The runtime
 * loads this module only when it installs the built-in set (`installVioletTheme()` with no product
 * set installed), through a dynamic import, so a product that installs its own set never loads it.
 */
import { violetThemeBuiltInSet } from "./generated/violet-theme.generated";
import { VIOLET_THEME_DEFAULT_PRESET, type VioletBuiltInThemePreset } from "./generated/violet-theme-presets.generated";
import { createVioletThemeCss, violetTokenProperty } from "./violet-theme-css";

export { violetThemeBuiltInSet };

/** The built-in default set's stylesheet. */
export const violetThemeCssText = createVioletThemeCss(violetThemeBuiltInSet);

/** The built-in default set's declarations, per preset, one `  --property: value;` per line. */
export const violetThemeDeclarationsByPreset = Object.fromEntries(
    Object.entries(violetThemeBuiltInSet.presets).map(([name, tokens]) => [
        name,
        tokens.map(token => `  ${violetTokenProperty(token.id)}: ${token.value};`).join("\n"),
    ]),
) as Readonly<Record<VioletBuiltInThemePreset, string>>;

/** The built-in default preset's declarations. */
export const violetThemeDeclarations = violetThemeDeclarationsByPreset[VIOLET_THEME_DEFAULT_PRESET];
