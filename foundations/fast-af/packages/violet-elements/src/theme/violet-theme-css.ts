/**
 * Violet theme sets as data, and the stylesheet that applies one. No DOM access: this module is
 * shared by the runtime installer and the build-time checks a product runs against
 * `tokens/interface.json`.
 */

export const VIOLET_THEME_ROOT_ATTRIBUTE = "data-violet-theme-root";
export const VIOLET_THEME_PRESET_ATTRIBUTE = "data-violet-theme";

/** A preset name: open, so a product may name its presets as it likes (`sepia`, `brand-dark`). */
export type VioletThemePreset = string;

/** One resolved token: a Violet token id (`color.surface.page`) and its CSS value. */
export interface VioletThemeToken {
    readonly id: string;
    readonly value: string;
}

/**
 * A complete theme set: every preset a page can select, as resolved tokens, and the preset that
 * applies when none is selected. The default preset must supply every id of
 * `tokens/interface.json`; another preset lists what it sets and inherits the rest from the
 * default. This is the shape `@lushly-dev/violet-core`'s resolved tokens map to.
 */
export interface VioletThemeSet {
    readonly defaultPreset: VioletThemePreset;
    readonly presets: Readonly<Record<VioletThemePreset, readonly VioletThemeToken[]>>;
}

/** `tokens/interface.json`: the custom properties the components read, per token id. */
export interface VioletTokenInterface {
    readonly contractVersion: number;
    readonly tokens: Readonly<
        Record<string, { readonly property: string; readonly type: string; readonly reserved?: boolean }>
    >;
}

const PRESET_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const TOKEN_ID = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
// A value is one declaration's value: nothing that could end the declaration, the rule or the
// style element it is written into.
const UNSAFE_VALUE = /[;{}<>]|\/\*|\\|[\r\n]/;

/** `--` and the id with `.` replaced by `-`: `color.surface.page` gives `--color-surface-page`. */
export function violetTokenProperty(id: string): string {
    return `--${id.replace(/\./g, "-")}`;
}

/** Every problem with a theme set's shape, preset names, ids and values; empty when it is sound. */
export function validateVioletThemeSet(themeSet: VioletThemeSet): string[] {
    const problems: string[] = [];
    const presets = themeSet?.presets;
    if (typeof presets !== "object" || presets === null || Array.isArray(presets)) {
        return ["the theme set has no presets object"];
    }
    const names = Object.keys(presets);
    if (names.length === 0) {
        problems.push("the theme set has no presets");
    }
    if (typeof themeSet.defaultPreset !== "string" || !names.includes(themeSet.defaultPreset)) {
        problems.push(`the default preset '${String(themeSet.defaultPreset)}' is not one of the presets (${names.join(", ")})`);
    }
    for (const name of names) {
        if (!PRESET_NAME.test(name)) {
            problems.push(`the preset name '${name}' must be letters, digits, '-' and '_', starting with a letter or digit`);
        }
        const tokens = presets[name];
        if (!Array.isArray(tokens)) {
            problems.push(`the preset '${name}' is not a list of { id, value } tokens`);
            continue;
        }
        const seen = new Set<string>();
        for (const token of tokens) {
            const id = token?.id;
            if (typeof id !== "string" || !TOKEN_ID.test(id)) {
                problems.push(`the preset '${name}' has a token with an invalid id ${JSON.stringify(id)}`);
                continue;
            }
            if (seen.has(id)) {
                problems.push(`the preset '${name}' lists '${id}' more than once`);
            }
            seen.add(id);
            const value = token.value;
            if (typeof value !== "string" || value.trim() === "" || UNSAFE_VALUE.test(value)) {
                problems.push(`the preset '${name}' has an empty or unsafe value for '${id}': ${JSON.stringify(value)}`);
            }
        }
    }
    return problems;
}

function declarations(tokens: readonly VioletThemeToken[]): string {
    return tokens.map(token => `  ${violetTokenProperty(token.id)}: ${token.value};`).join("\n");
}

/**
 * The stylesheet for a theme set: the default preset on `:root` and on every
 * `[data-violet-theme-root]`, then each other preset on the same selectors with
 * `[data-violet-theme="<preset>"]`. Throws a `TypeError` listing every problem when the set is not
 * sound.
 */
export function createVioletThemeCss(themeSet: VioletThemeSet): string {
    const problems = validateVioletThemeSet(themeSet);
    if (problems.length > 0) {
        throw new TypeError(`Invalid Violet theme set: ${problems.join("; ")}`);
    }
    const blocks = [
        ":root,",
        `[${VIOLET_THEME_ROOT_ATTRIBUTE}]`,
        "{",
        declarations(themeSet.presets[themeSet.defaultPreset]),
        "}",
    ];
    for (const [name, tokens] of Object.entries(themeSet.presets)) {
        if (name === themeSet.defaultPreset) {
            continue;
        }
        blocks.push(
            `:root[${VIOLET_THEME_PRESET_ATTRIBUTE}="${name}"],`,
            `[${VIOLET_THEME_ROOT_ATTRIBUTE}][${VIOLET_THEME_PRESET_ATTRIBUTE}="${name}"]`,
            "{",
            declarations(tokens),
            "}",
        );
    }
    return blocks.join("\n");
}

/**
 * What a theme set lacks against the components' token interface: per preset, every interface id
 * it does not supply, counting what a non-default preset inherits from the default. A product runs
 * this at build time with the interface its installed `violet-elements` ships
 * (`@lushly-dev/violet-elements/tokens/interface.json`); an empty list means the set is complete.
 * Ids the interface does not list are allowed: a product's tree may hold more than the components
 * read.
 */
export function findVioletThemeSetGaps(themeSet: VioletThemeSet, tokenInterface: VioletTokenInterface): string[] {
    const problems = validateVioletThemeSet(themeSet);
    if (problems.length > 0) {
        return problems;
    }
    const gaps: string[] = [];
    const defaults = new Set(themeSet.presets[themeSet.defaultPreset].map(token => token.id));
    for (const [name, tokens] of Object.entries(themeSet.presets)) {
        const supplied = new Set([...defaults, ...tokens.map(token => token.id)]);
        for (const id of Object.keys(tokenInterface.tokens)) {
            if (!supplied.has(id)) {
                gaps.push(`the preset '${name}' has no value for '${id}' (${tokenInterface.tokens[id].property})`);
            }
        }
    }
    return gaps;
}
