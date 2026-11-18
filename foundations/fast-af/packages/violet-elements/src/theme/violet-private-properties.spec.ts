import { describe, expect, it } from "vitest";

// Every source file the package ships: specs, stories and the generated theme data set no styles.
const sources = import.meta.glob(["../**/*.ts", "!../**/*.spec.ts", "!../**/*.stories.ts", "!./generated/**"], {
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
const HOOKS: Readonly<Record<string, { readers: readonly string[]; why: string }>> = {
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
    // Constants written as hooks. The readers include a token-default block that does not carry
    // the alias, so a theme's value does not reach them (#1436). Each renders its fallback, which
    // is what the Refined design was approved with.
    "--_radius-round": {
        readers: ["../color-picker/violet-color-picker.ts", "../date-picker/violet-date-picker.ts"],
        why: "the pickers' round controls: always 9999px",
    },
    "--_space-xs": {
        readers: [
            "../conversation/violet-chat-composer.ts",
            "../conversation/violet-source-citation.ts",
            "../conversation/violet-tool-call-card.ts",
        ],
        why: "the conversation components' smallest gap: always 4px",
    },
    "--_danger-text": {
        readers: ["../conversation/violet-message-status.ts"],
        why: "the message status's error colour: always #dc2626",
    },
    "--_text-link": {
        readers: ["../conversation/violet-source-citation.ts"],
        why: "the citation's link colour: always #2563eb; the interface has no link colour",
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
    "../gantt/violet-gantt.styles.ts: var(--_surface-page)": "repaints the gantt's body; needs a design decision (#1436)",
};

const DECLARED = /(--_[a-z0-9-]+)\s*:/g;
const SET_FROM_SCRIPT = /setProperty\(\s*["'`](--_[a-z0-9-]+)["'`]/g;
const READ = /var\(\s*(--_[a-z0-9-]+)\s*([,)])/g;
const BLOCK = /export const (\w+): ElementStyles = css`([\s\S]*?)`;/g;
const VALUE_IMPORT = /import\s+(?!type\b)[^"';]+?\s+from\s+"\.\/([\w.-]+)"/g;

interface PrivateRead {
    path: string;
    property: string;
    /** Whether every read of the property in the file carries a fallback. */
    fallback: boolean;
}

const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

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
});

describe("undefinedPrivateReads", () => {
    // A placeholder in a fixture is written with DOLLAR, so its string is not taken for a template.
    const DOLLAR = "$";
    const defaults = [
        'import { css, type ElementStyles } from "@lushly-dev/fast-element";',
        "export const violetFieldTokenDefaults: ElementStyles = css`",
        "    :host { --_radius-md: var(--radius-md, 4px); }",
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
