import { describe, expect, it } from "vitest";

import { violetThemeBuiltInSet } from "./generated/violet-theme.generated";
import { violetTokenProperty } from "./violet-theme-css";

// Every source file the package ships: specs, stories and the generated theme data set no styles.
const sources = import.meta.glob(["../**/*.ts", "!../**/*.spec.ts", "!../**/*.stories.ts", "!./generated/**"], {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;

// Stories also carry CSS with token fallbacks; keep them free of drifted theme literals too.
const storySources = import.meta.glob(["../**/*.stories.ts"], {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;

const TOKEN_DEFAULTS = "./violet-token-defaults.ts";

/**
 * Private properties read with a fallback, `var(--_x, <fallback>)`, that the reading file does
 * not define, each with the files that read it and why. Such a read renders its fallback unless
 * an ancestor sets the property, so it is a hook, not a dropped declaration; this list keeps each
 * one a decision. A hook or a reader that is not listed fails the spec, as does an entry or a
 * reader nothing needs any more.
 */
const HOOKS: Readonly<Record<string, { readers: readonly string[]; why: string; token?: string }>> = {
    // Inherited on purpose: a violet-card sets it on its host, so what sits inside a card draws
    // its rules at the card's border width. These take 1px anywhere else.
    "--_card-border-width": {
        readers: [
            "../conversation/violet-chat-composer.ts",
            "../conversation/violet-chat-suggestions.ts",
            "../conversation/violet-message-media.ts",
            "../conversation/violet-message.ts",
            "../conversation/violet-reasoning-block.ts",
            "../conversation/violet-tool-call-card.ts",
            "../conversation/violet-tool-result-card.ts",
            "../dialog/violet-dialog.ts",
            "../teaching-tip/violet-teaching-tip.ts",
            "../tooltip/violet-tooltip.ts",
        ],
        why: "inherited from a violet-card ancestor; 1px without one",
    },
    // A popup's width, for script to set from its trigger. Nothing sets it yet, so the popup
    // takes its content's width.
    "--_panel-inline-size": {
        readers: [
            "../combobox/violet-combobox.ts",
            "../date-picker/violet-date-picker.ts",
            "../date-range-picker/violet-date-range-picker.ts",
            "../select/violet-select.ts",
        ],
        why: "a popup width for script to set; auto until then",
    },
    // Inherited from an open select/combobox listbox or focused listbox so active rows draw a ring
    // only while keyboard navigation is active without clobbering author --violet-option-active-ring.
    "--_option-active-ring": {
        readers: ["../option/violet-option.ts"],
        why: "inherited from an open select/combobox or focused listbox; transparent at rest",
    },
    // The interface has no link colour, so the citation falls back to --violet-color-accent-text (#1b5f80 in light) until it does (#2237).
    "--_text-link": {
        readers: ["../conversation/violet-source-citation.ts"],
        why: "the citation's link colour override hook: falls back to --violet-color-accent-text (#1b5f80 in light) while the interface has no link colour",
        token: "--violet-color-accent-text",
    },
};

/**
 * Reads with no fallback that are known to be dropped and are left so, each with why and the
 * issue that tracks it. An entry the scan no longer finds fails the spec.
 */
const KNOWN_DROPPED: Readonly<Record<string, string>> = {
    // The gantt includes the surface block, which has no page surface. Its viewport and a narrow
    // item's label therefore take no background, and a selected item's ring is not drawn.
    // Defining the alias paints the page surface over the card the gantt's body shows today,
    // which is a change of design the Refined port did not make.
    "../gantt/violet-gantt.styles.ts: var(--_surface-page)": "repaints the gantt's body; needs a design decision (#2237)",
};

const DECLARED = /(--_[a-z0-9-]+)\s*:/g;
const SET_FROM_SCRIPT = /setProperty\(\s*["'`](--_[a-z0-9-]+)["'`]/g;
const READ = /var\(\s*(--_[a-z0-9-]+)\s*([,)])/g;
const BLOCK = /export const (\w+): ElementStyles = css`([\s\S]*?)`;/g;
const VALUE_IMPORT = /import\s+(?!type\b)[^"';]+?\s+from\s+"\.\/([\w.-]+)"/g;
const VAR_WITH_FALLBACK = /var\(\s*(--[A-Za-z0-9_-]+)\s*,/g;
const PRIVATE_ALIAS_TARGET = /(--_[A-Za-z0-9_-]+)\s*:\s*var\(\s*(--[A-Za-z0-9_-]+)/g;
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/i;

interface PrivateRead {
    path: string;
    property: string;
    /** Whether every read of the property in the file carries a fallback. */
    fallback: boolean;
}

interface LiteralFallback {
    property: string;
    literal: string;
    line: number;
}

interface FallbackViolation {
    path: string;
    line: number;
    property: string;
    literal: string;
    expected: string;
}

const withoutComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, " ")).replace(/^[ \t]*\/\/.*$/gm, "");

const normalizeLiteral = (value: string): string =>
    value
        .trim()
        .replace(/\s+/g, " ")
        .replace(/#[0-9a-fA-F]{3,8}\b/g, hex => hex.toLowerCase());

const lightValuesByProperty: ReadonlyMap<string, string> = new Map(
    violetThemeBuiltInSet.presets.light.map(token => [violetTokenProperty(token.id), token.value]),
);

function findLiteralFallbacks(text: string): LiteralFallback[] {
    const found: LiteralFallback[] = [];
    for (const match of text.matchAll(VAR_WITH_FALLBACK)) {
        const property = match[1] as string;
        const start = match.index + match[0].length;
        let depth = 0;
        let end = -1;
        for (let index = start; index < text.length; index++) {
            const char = text[index];
            if (char === "(") depth++;
            else if (char === ")") {
                if (depth === 0) {
                    end = index;
                    break;
                }
                depth--;
            }
        }
        if (end < 0) continue;
        const raw = text.slice(start, end);
        if (raw.includes("var(") || raw.includes("${")) continue;
        const leading = raw.length - raw.trimStart().length;
        const literal = raw.trim();
        found.push({
            property,
            literal,
            line: text.slice(0, start + leading).split("\n").length,
        });
    }
    return found;
}

function addAliasTarget(map: Map<string, Set<string>>, alias: string, target: string): void {
    let targets = map.get(alias);
    if (!targets) {
        targets = new Set<string>();
        map.set(alias, targets);
    }
    targets.add(target);
}

function aliasTargets(text: string): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const match of text.matchAll(PRIVATE_ALIAS_TARGET)) {
        addAliasTarget(map, match[1] as string, match[2] as string);
    }
    return map;
}

function resolveLightValues(
    property: string,
    aliases: ReadonlyMap<string, ReadonlySet<string>>,
    lightValues: ReadonlyMap<string, string>,
): Set<string> {
    const resolved = new Set<string>();
    const seen = new Set<string>();
    const queue = [property];
    while (queue.length > 0) {
        const current = queue.shift() as string;
        if (seen.has(current)) continue;
        seen.add(current);
        const direct = lightValues.get(current);
        if (direct !== undefined) {
            resolved.add(direct);
            continue;
        }
        for (const next of aliases.get(current) ?? []) {
            if (!seen.has(next)) queue.push(next);
        }
    }
    return resolved;
}

/**
 * Every literal fallback in `files` that disagrees with the light preset of the built-in export:
 * - any `var(--<token>, <literal>)` where `<token>` is in the export and `<literal>` differs;
 * - any `var(--_<alias>, <literal>)` where `--_<alias>` resolves to one or more export tokens
 *   (from an included token-default block, the file itself, its `.styles.ts`, or a `HOOKS` token
 *   target) and `<literal>` matches none of their light values;
 * - any `var(--_<alias>, <literal>)` whose `<literal>` is a color not present in the light export.
 */
function driftedLiteralFallbacks(
    files: Readonly<Record<string, string>>,
    lightValues: ReadonlyMap<string, string> = lightValuesByProperty,
    tokenDefaults = TOKEN_DEFAULTS,
): FallbackViolation[] {
    const code = new Map(Object.entries(files).map(([path, text]) => [path, withoutComments(text)]));
    const exportLightSet = new Set([...lightValues.values()].map(normalizeLiteral));

    const blockAliases = new Map<string, Map<string, Set<string>>>();
    for (const match of (code.get(tokenDefaults) ?? "").matchAll(BLOCK)) {
        blockAliases.set(match[1] as string, aliasTargets(match[2] as string));
    }

    const ownAliases = new Map<string, Map<string, Set<string>>>();
    const imports = new Map<string, string[]>();
    for (const [path, text] of code) {
        const map = new Map<string, Set<string>>();
        for (const [blockName, targets] of blockAliases) {
            if (text.includes(`\${${blockName}}`)) {
                for (const [alias, refs] of targets) {
                    for (const ref of refs) addAliasTarget(map, alias, ref);
                }
            }
        }
        for (const [alias, refs] of aliasTargets(text)) {
            for (const ref of refs) addAliasTarget(map, alias, ref);
        }
        ownAliases.set(path, map);
        imports.set(
            path,
            [...text.matchAll(VALUE_IMPORT)].map(match => `${directory(path)}/${match[1]}.ts`).filter(target => code.has(target)),
        );
    }

    const violations: FallbackViolation[] = [];
    for (const [path, text] of code) {
        const aliases = new Map<string, Set<string>>();
        for (const [alias, refs] of ownAliases.get(path) ?? []) {
            aliases.set(alias, new Set(refs));
        }
        for (const target of imports.get(path) ?? []) {
            if (target.endsWith(".styles.ts")) {
                for (const [alias, refs] of ownAliases.get(target) ?? []) {
                    for (const ref of refs) addAliasTarget(aliases, alias, ref);
                }
            }
        }
        for (const fallback of findLiteralFallbacks(text)) {
            const directExpected = lightValues.get(fallback.property);
            if (directExpected !== undefined) {
                if (normalizeLiteral(fallback.literal) !== normalizeLiteral(directExpected)) {
                    violations.push({ path, ...fallback, expected: directExpected });
                }
                continue;
            }
            if (!fallback.property.startsWith("--_")) continue;
            const expectedSet = resolveLightValues(fallback.property, aliases, lightValues);
            if (expectedSet.size === 0) {
                const hookToken = HOOKS[fallback.property]?.token;
                const hookValue = hookToken ? lightValues.get(hookToken) : undefined;
                if (hookValue !== undefined) expectedSet.add(hookValue);
            }
            if (expectedSet.size > 0) {
                const normalized = normalizeLiteral(fallback.literal);
                const matchesAny = [...expectedSet].some(value => normalizeLiteral(value) === normalized);
                if (!matchesAny) {
                    violations.push({ path, ...fallback, expected: [...expectedSet].join(" | ") });
                }
                continue;
            }
            if (COLOR_LITERAL.test(fallback.literal) && !exportLightSet.has(normalizeLiteral(fallback.literal))) {
                violations.push({
                    path,
                    ...fallback,
                    expected: "a light value from tokens/violet-theme.export.json",
                });
            }
        }
    }
    return violations;
}

/** Every `--_x:` declaration (in a rule or an inline style) and every `setProperty("--_x"`. */
function declarations(text: string): Set<string> {
    return new Set([...text.matchAll(DECLARED), ...text.matchAll(SET_FROM_SCRIPT)].map(match => match[1] as string));
}

const directory = (path: string): string => path.slice(0, path.lastIndexOf("/"));

/**
 * Every private property (`--_x`) a file reads through `var()` that it cannot have, one entry per
 * file and property. A file has a property when:
 *
 * - it declares it, in a rule, in an inline style its template writes, or with `setProperty`;
 * - a token-default block it includes (`${violetFieldTokenDefaults}`) declares it;
 * - its own `*.styles` module, which it imports, has it;
 * - every module of its directory that imports a value from it has it, since a styles module or
 *   a style helper renders inside the components that import it.
 *
 * The scan reads files, not selectors: a property declared on one rule and read under another
 * passes. It exists for the fault that came back twice, a component reading an alias of a block
 * it does not include (#1436), where a `var()` with no fallback drops the whole declaration.
 */
function undefinedPrivateReads(files: Readonly<Record<string, string>>, tokenDefaults = TOKEN_DEFAULTS): PrivateRead[] {
    const code = new Map(Object.entries(files).map(([path, text]) => [path, withoutComments(text)]));
    const blocks = new Map<string, Set<string>>();
    for (const match of (code.get(tokenDefaults) ?? "").matchAll(BLOCK)) {
        blocks.set(match[1] as string, declarations(match[2] as string));
    }

    const own = new Map<string, Set<string>>();
    const imports = new Map<string, string[]>();
    for (const [path, text] of code) {
        const has = declarations(text);
        for (const [name, properties] of blocks) {
            if (text.includes(`\${${name}}`)) {
                for (const property of properties) has.add(property);
            }
        }
        own.set(path, has);
        imports.set(
            path,
            [...text.matchAll(VALUE_IMPORT)].map(match => `${directory(path)}/${match[1]}.ts`).filter(target => code.has(target)),
        );
    }
    const importers = new Map<string, string[]>();
    for (const [path, targets] of imports) {
        for (const target of targets) importers.set(target, [...(importers.get(target) ?? []), path]);
    }

    // What a file has without its importers: its own declarations and its styles module's.
    const has = new Map<string, Set<string>>();
    for (const path of code.keys()) {
        const properties = new Set(own.get(path));
        for (const target of imports.get(path) ?? []) {
            if (target.endsWith(".styles.ts")) {
                for (const property of own.get(target) ?? []) properties.add(property);
            }
        }
        has.set(path, properties);
    }

    const found: PrivateRead[] = [];
    for (const [path, text] of code) {
        if (path === tokenDefaults) continue;
        const users = importers.get(path) ?? [];
        const reads = new Map<string, boolean>();
        for (const match of text.matchAll(READ)) {
            const property = match[1] as string;
            if (has.get(path)?.has(property)) continue;
            if (users.length > 0 && users.every(user => has.get(user)?.has(property))) continue;
            reads.set(property, (reads.get(property) ?? true) && match[2] === ",");
        }
        for (const [property, fallback] of reads) found.push({ path, property, fallback });
    }
    return found;
}

describe("private properties (--_*)", () => {
    const found = undefinedPrivateReads(sources);

    it("scans the shipped sources and the three token-default blocks", () => {
        expect(Object.keys(sources).length).toBeGreaterThan(100);
        const defaults = withoutComments(sources[TOKEN_DEFAULTS] ?? "");
        expect([...defaults.matchAll(BLOCK)].map(match => match[1])).toEqual([
            "violetActionTokenDefaults",
            "violetFieldTokenDefaults",
            "violetSurfaceTokenDefaults",
        ]);
    });

    it("defines every private property a component reads without a fallback", () => {
        const dropped = found.filter(read => !read.fallback).map(read => `${read.path}: var(${read.property})`);
        expect(
            dropped.sort(),
            "the declaration is dropped: define the property in the component, or include the token-default block that does; drop a KNOWN_DROPPED entry that is fixed",
        ).toEqual(Object.keys(KNOWN_DROPPED).sort());
    });

    it("lists every hook, a private property read with a fallback that the file does not define, and its readers", () => {
        const hooks: Record<string, string[]> = {};
        for (const read of found.filter(entry => entry.fallback)) {
            hooks[read.property] = [...(hooks[read.property] ?? []), read.path].sort();
        }
        const listed = Object.fromEntries(Object.entries(HOOKS).map(([property, hook]) => [property, [...hook.readers].sort()]));
        expect(hooks, "define the property, or list the hook and its reader in HOOKS with why; drop what nothing reads").toEqual(
            listed,
        );
    });

    it("keeps every literal fallback on a theme token or private alias aligned with the light export", () => {
        const format = (violation: FallbackViolation) =>
            `${violation.path}:${violation.line}: var(${violation.property}, ${violation.literal}) differs from ${violation.expected}`;
        const componentViolations = driftedLiteralFallbacks(sources).map(format);
        const storyViolations = driftedLiteralFallbacks({ [TOKEN_DEFAULTS]: sources[TOKEN_DEFAULTS] ?? "", ...storySources })
            .filter(violation => violation.path !== TOKEN_DEFAULTS)
            .map(format);
        expect(
            [...componentViolations, ...storyViolations],
            "update the fallback to the light export value, or drop the redundant fallback on a defined private alias",
        ).toEqual([]);
    });
});

describe("undefinedPrivateReads", () => {
    // A placeholder in a fixture is written with DOLLAR, so its string is not taken for a template.
    const DOLLAR = "$";
    const defaults = [
        'import { css, type ElementStyles } from "@lushly-dev/fast-element";',
        "export const violetFieldTokenDefaults: ElementStyles = css`",
        "    :host { --_radius-md: var(--violet-radius-md, 8px); }",
        "`;",
    ].join("\n");
    const scan = (files: Record<string, string>) => undefinedPrivateReads({ "./violet-token-defaults.ts": defaults, ...files });

    it("names a read of an alias the included block does not carry, and says whether it has a fallback", () => {
        expect(
            scan({
                "../well/violet-well.ts": [
                    "const styles = css`",
                    `    ${DOLLAR}{violetFieldTokenDefaults}`,
                    "    :host { --_well-gap: 4px; }",
                    "    .frame { border-radius: var(--_radius-md); gap: var(--_well-gap); }",
                    "    .panel { box-shadow: var(--_shadow-floating); border-radius: var(--_radius-round, 9999px); }",
                    "`;",
                ].join("\n"),
            }),
        ).toEqual([
            { path: "../well/violet-well.ts", property: "--_shadow-floating", fallback: false },
            { path: "../well/violet-well.ts", property: "--_radius-round", fallback: true },
        ]);
    });

    it("does not take a block the file only names, a comment or another component for a definition", () => {
        expect(
            scan({
                "../well/violet-well.ts": [
                    'import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";',
                    'import "./violet-well-item";',
                    'import type { VioletWellItem } from "./violet-well-item";',
                    "const styles = css`",
                    "    /* --_radius-md: 4px; */",
                    "    .frame { border-radius: var(--_radius-md); padding: var(--_item-gap); }",
                    "    .frame { margin: var(--_item-gap, 0); }",
                    "`;",
                ].join("\n"),
                "../well/violet-well-item.ts": "const styles = css`:host { --_item-gap: 2px; }`;",
            }),
        ).toEqual([
            { path: "../well/violet-well.ts", property: "--_radius-md", fallback: false },
            { path: "../well/violet-well.ts", property: "--_item-gap", fallback: false },
        ]);
    });

    it("counts what script sets, the component's styles module and the components a helper renders in", () => {
        expect(
            scan({
                "../chart/violet-chart.ts": [
                    'import { violetChartStyles } from "./violet-chart.styles";',
                    'import { swatch } from "./violet-chart-helpers";',
                    'const template = html`<div style="--_bar-left:4px"></div>`;',
                    'this.style.setProperty("--_chart-level", "1");',
                    "const row = `inline-size: var(--_row-size)`;",
                ].join("\n"),
                "../chart/violet-chart.styles.ts": [
                    "export const violetChartStyles = css`",
                    "    :host { --_row-size: 2rem; --_swatch: red; }",
                    "    .bar { inset-inline-start: var(--_bar-left); z-index: var(--_chart-level); }",
                    "`;",
                ].join("\n"),
                "../chart/violet-chart-helpers.ts": 'export const swatch = () => "var(--_swatch)";',
            }),
        ).toEqual([]);
    });

    it("asks every component a helper renders in for the property", () => {
        expect(
            scan({
                "../chart/violet-chart.ts": [
                    'import { swatch } from "./violet-chart-helpers";',
                    "const styles = css`:host { --_swatch: red; }`;",
                ].join("\n"),
                "../chart/violet-chart-legend.ts": 'import { swatch } from "./violet-chart-helpers";',
                "../chart/violet-chart-helpers.ts": 'export const swatch = () => "var(--_swatch)";',
            }),
        ).toEqual([{ path: "../chart/violet-chart-helpers.ts", property: "--_swatch", fallback: false }]);
    });
});

describe("driftedLiteralFallbacks", () => {
    const DOLLAR = "$";
    const defaults = [
        'import { css, type ElementStyles } from "@lushly-dev/fast-element";',
        "export const violetSurfaceTokenDefaults: ElementStyles = css`",
        "    :host {",
        "        --_text-primary: var(--violet-color-text-primary, #181b1a);",
        "        --_surface-subtle: var(--violet-color-surface-subtle, #e9e5de);",
        "        --_radius-lg: var(--violet-radius-lg, 12px);",
        "        --_radius-round: var(--violet-radius-round, 9999px);",
        "    }",
        "`;",
    ].join("\n");
    const lightValues = new Map<string, string>([
        ["--violet-color-text-primary", "#181b1a"],
        ["--violet-color-surface-subtle", "#e9e5de"],
        ["--violet-color-accent-text", "#1b5f80"],
        ["--violet-color-focus-ring", "#28769e"],
        ["--violet-color-action-danger-background", "#c42a1a"],
        ["--violet-radius-lg", "12px"],
        ["--violet-radius-round", "9999px"],
        ["--violet-space-stack-xs", "4px"],
        ["--violet-size-target-compact", "24px"],
        ["--violet-size-target-natural", "32px"],
        ["--violet-size-target-comfortable", "44px"],
    ]);
    const scan = (files: Record<string, string>) =>
        driftedLiteralFallbacks({ "./violet-token-defaults.ts": defaults, ...files }, lightValues);

    it("flags drifted theme-token, private-alias, hook, and non-export color fallbacks with exact line numbers", () => {
        expect(
            scan({
                "../card/violet-card.ts": [
                    "const styles = css`",
                    `    ${DOLLAR}{violetSurfaceTokenDefaults}`,
                    "    :host { --_local-ink: var(--_text-primary); }",
                    "",
                    "    // comment after a blank line must not shift reported line numbers",
                    "    .a { color: var(--violet-color-text-primary, #1c1a0d); }",
                    "    .b { color: var(--_text-primary, #1c1a0d); }",
                    "    .c { background: var(--_surface-subtle, rgba(28, 26, 13, 0.04)); }",
                    "    .d { border-radius: var(--_radius-lg, 6px); }",
                    "    .e { color: var(--_local-ink, #1c1a0d); }",
                    "    .f { color: var(--_text-link, #c42a1a); }",
                    "    .g { border-radius: var(--_radius-round, 6px); }",
                    "    .h { color: var(--_unmapped-link, #c84f3b); }",
                    "`;",
                ].join("\n"),
            }),
        ).toEqual([
            { path: "../card/violet-card.ts", line: 6, property: "--violet-color-text-primary", literal: "#1c1a0d", expected: "#181b1a" },
            { path: "../card/violet-card.ts", line: 7, property: "--_text-primary", literal: "#1c1a0d", expected: "#181b1a" },
            {
                path: "../card/violet-card.ts",
                line: 8,
                property: "--_surface-subtle",
                literal: "rgba(28, 26, 13, 0.04)",
                expected: "#e9e5de",
            },
            { path: "../card/violet-card.ts", line: 9, property: "--_radius-lg", literal: "6px", expected: "12px" },
            { path: "../card/violet-card.ts", line: 10, property: "--_local-ink", literal: "#1c1a0d", expected: "#181b1a" },
            { path: "../card/violet-card.ts", line: 11, property: "--_text-link", literal: "#c42a1a", expected: "#1b5f80" },
            { path: "../card/violet-card.ts", line: 12, property: "--_radius-round", literal: "6px", expected: "9999px" },
            {
                path: "../card/violet-card.ts",
                line: 13,
                property: "--_unmapped-link",
                literal: "#c84f3b",
                expected: "a light value from tokens/violet-theme.export.json",
            },
        ]);
    });

    it("handles multi-binding aliases against all bound light values without false positives", () => {
        expect(
            scan({
                "../grid/violet-grid.ts": [
                    "const styles = css`",
                    "    :host { --_row-size: var(--violet-size-target-natural); }",
                    '    :host([density="compact"]) { --_row-size: var(--violet-size-target-compact); }',
                    '    :host([density="comfortable"]) { --_row-size: var(--violet-size-target-comfortable); }',
                    "    .default { block-size: var(--_row-size, 32px); }",
                    "    .compact { block-size: var(--_row-size, 24px); }",
                    "    .wrong { block-size: var(--_row-size, 18px); }",
                    "`;",
                ].join("\n"),
            }),
        ).toEqual([
            {
                path: "../grid/violet-grid.ts",
                line: 7,
                property: "--_row-size",
                literal: "18px",
                expected: "32px | 24px | 44px",
            },
        ]);
    });

    it("accepts matching export fallbacks, non-color hook defaults, and matching hook tokens", () => {
        expect(
            scan({
                "../card/violet-card.ts": [
                    "const styles = css`",
                    `    ${DOLLAR}{violetSurfaceTokenDefaults}`,
                    "    .ok { color: var(--_text-primary); border-width: var(--_card-border-width, 1px); }",
                    "    .link { color: var(--_text-link, #1b5f80); border-radius: var(--_radius-round, 9999px); gap: var(--_space-xs, 4px); }",
                    "    .panel { inline-size: var(--_panel-inline-size, auto); }",
                    "    .swatch { background: var(--_swatch-color, transparent); }",
                    "`;",
                ].join("\n"),
            }),
        ).toEqual([]);
    });
});
