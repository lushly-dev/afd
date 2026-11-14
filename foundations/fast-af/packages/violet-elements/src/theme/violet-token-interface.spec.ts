import { describe, expect, it } from "vitest";

import tokenInterface from "../../tokens/interface.json";
import { violetThemeBuiltInSet } from "./generated/violet-theme.generated";
import { findVioletThemeSetGaps, violetTokenProperty, type VioletTokenInterface } from "./violet-theme-css";

declare global {
    interface ImportMeta {
        glob(patterns: string[], options: { query: string; import: string; eager: true }): Record<string, unknown>;
    }
}

// Every source file the package ships: specs, stories and the generated theme data read no token.
const sources = import.meta.glob(["../**/*.ts", "!../**/*.spec.ts", "!../**/*.stories.ts", "!./generated/**"], {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;

const TOKEN_TYPES = new Set(["color", "dimension", "duration", "cubicBezier", "fontWeight", "fontFamily", "number", "shadow"]);
const READ = /(?:var\(\s*|getPropertyValue\(\s*["'])(--[A-Za-z0-9_-]+)/g;

/**
 * Every theme property the components read: each `var(--x` and `getPropertyValue("--x"` outside
 * comments, less private aliases (`--_x`) and the components' own knobs (`--violet-x`), which a
 * theme does not set. Maps each property to the files that read it.
 */
function readProperties(): Map<string, string[]> {
    const read = new Map<string, string[]>();
    for (const [path, text] of Object.entries(sources)) {
        const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        for (const match of code.matchAll(READ)) {
            const property = match[1];
            if (property.startsWith("--_") || property.startsWith("--violet-")) {
                continue;
            }
            read.set(property, [...(read.get(property) ?? []), path]);
        }
    }
    return read;
}

const contract = tokenInterface as VioletTokenInterface;
const entries = Object.entries(contract.tokens);

describe("the token interface (tokens/interface.json)", () => {
    it("scans the shipped sources", () => {
        expect(Object.keys(sources).length).toBeGreaterThan(100);
        expect(Object.keys(sources)).toContain("./violet-theme-runtime.ts");
        expect(Object.keys(sources).some(path => path.endsWith(".spec.ts"))).toBe(false);
    });

    it("lists every theme property a component reads", () => {
        const listed = new Set(entries.map(([, entry]) => entry.property));
        const missing = [...readProperties()]
            .filter(([property]) => !listed.has(property))
            .map(([property, paths]) => `${property} (read by ${[...new Set(paths)].join(", ")})`);
        expect(missing, "add each to tokens/interface.json, bump its contractVersion and supply it in Loam's tree").toEqual([]);
    });

    it("lists only properties a component reads, unless reserved", () => {
        const read = readProperties();
        const unread = entries.filter(([, entry]) => !entry.reserved && !read.has(entry.property)).map(([id]) => id);
        const reservedButRead = entries.filter(([, entry]) => entry.reserved && read.has(entry.property)).map(([id]) => id);
        expect(unread, "remove each from tokens/interface.json or mark it reserved, and bump its contractVersion").toEqual([]);
        expect(reservedButRead, "drop `reserved` from each").toEqual([]);
    });

    it("names each property from its id and gives it a known type", () => {
        // Version 1 has these 89 ids. Changing the list changes the version: update both here.
        expect(contract.contractVersion).toBe(1);
        expect(entries).toHaveLength(89);
        for (const [id, entry] of entries) {
            expect(entry.property, id).toBe(violetTokenProperty(id));
            expect(TOKEN_TYPES.has(entry.type), `${id} has type ${entry.type}`).toBe(true);
        }
        expect(contract.tokens["font.family.body"]).toEqual({ property: "--font-family-body", type: "fontFamily" });
        expect(contract.tokens["font.family.mono"]).toEqual({
            property: "--font-family-mono",
            type: "fontFamily",
            reserved: true,
        });
    });

    it("is supplied in full by the built-in default set, in every preset", () => {
        expect(findVioletThemeSetGaps(violetThemeBuiltInSet, contract)).toEqual([]);
    });
});

describe("findVioletThemeSetGaps", () => {
    const tiny: VioletTokenInterface = {
        contractVersion: 1,
        tokens: {
            "color.surface.page": { property: "--color-surface-page", type: "color" },
            "font.family.body": { property: "--font-family-body", type: "fontFamily" },
        },
    };

    it("counts what a preset inherits from the default and allows extra ids", () => {
        expect(
            findVioletThemeSetGaps(
                {
                    defaultPreset: "day",
                    presets: {
                        day: [
                            { id: "color.surface.page", value: "#fff" },
                            { id: "font.family.body", value: "Georgia, serif" },
                            { id: "color.brand.leaf", value: "#2f6b3a" },
                        ],
                        night: [{ id: "color.surface.page", value: "#111" }],
                    },
                },
                tiny,
            ),
        ).toEqual([]);
    });

    it("names every id a preset lacks", () => {
        expect(
            findVioletThemeSetGaps(
                { defaultPreset: "day", presets: { day: [{ id: "color.surface.page", value: "#fff" }], night: [] } },
                tiny,
            ),
        ).toEqual([
            "the preset 'day' has no value for 'font.family.body' (--font-family-body)",
            "the preset 'night' has no value for 'font.family.body' (--font-family-body)",
        ]);
    });
});
