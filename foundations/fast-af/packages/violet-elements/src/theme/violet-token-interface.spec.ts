import { describe, expect, it } from "vitest";

import tokenInterface from "../../tokens/interface.json";
import { violetThemeBuiltInSet } from "./generated/violet-theme.generated";
import {
    VIOLET_TOKEN_TYPES,
    findVioletThemeSetGaps,
    violetTokenProperty,
    type VioletTokenInterface,
} from "./violet-theme-css";

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

const TOKEN_TYPES = new Set<string>(VIOLET_TOKEN_TYPES);

/**
 * Each contract version's digest: SHA-256 of the sorted `id:property:type` lines. Changing the
 * interface without a new version fails here; add the new version's digest when you bump it.
 */
const CONTRACT_DIGESTS: Readonly<Record<number, string>> = {
    1: "0fd1c3c87bff39e5d24aa8e0f846e569f469bc1194fac6a8d298f595adb3eebd",
};

/**
 * Calls the scan cannot read as a literal property, each with why no component reads a theme
 * property through it. Keyed by file and the call's first characters.
 */
const UNRESOLVED_ALLOWED: Readonly<Record<string, string>> = {
    // The foundations story's registry renders the export's own references as `var(--<ref>)`.
    "../foundations/token-registry.ts: var(${tokenIdToCssVar(value.ref)})": "renders the export's references",
};

const CALL = /\b(var|getPropertyValue)\(\s*/g;
const LITERAL_VAR = /^(--[A-Za-z0-9_-]+)(?=[\s,)])/;
const LITERAL_GET = /^(["'])(--[A-Za-z0-9_-]+)\1/;

interface Scan {
    /** Every theme property read, with the files that read it. */
    read: Map<string, string[]>;
    /** Every `var(` or `getPropertyValue(` whose argument is not a literal property, as `file: call`. */
    unresolved: string[];
}

/**
 * Every theme property the components read: each `var(--x` and `getPropertyValue("--x"` outside
 * comments, less private aliases (`--_x`) and the components' own knobs (`--violet-x`), which a
 * theme does not set. A call whose argument is a template, a variable or anything else the scan
 * cannot read is reported, so a read cannot hide from the interface.
 */
function scan(): Scan {
    const read = new Map<string, string[]>();
    const unresolved: string[] = [];
    for (const [path, text] of Object.entries(sources)) {
        const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        for (const match of code.matchAll(CALL)) {
            const rest = code.slice(match.index + match[0].length);
            const literal = match[1] === "var" ? LITERAL_VAR.exec(rest)?.[1] : LITERAL_GET.exec(rest)?.[2];
            if (literal === undefined) {
                const key = `${path}: ${code.slice(match.index, match.index + 60).split("\n")[0]}`;
                if (!Object.keys(UNRESOLVED_ALLOWED).some(allowed => key.startsWith(allowed))) {
                    unresolved.push(key);
                }
                continue;
            }
            if (literal.startsWith("--_") || literal.startsWith("--violet-")) {
                continue;
            }
            read.set(literal, [...(read.get(literal) ?? []), path]);
        }
    }
    return { read, unresolved };
}

async function digest(contract: VioletTokenInterface): Promise<string> {
    const lines = Object.entries(contract.tokens)
        .map(([id, entry]) => `${id}:${entry.property}:${entry.type}`)
        .sort()
        .join("\n");
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(lines));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

const contract = tokenInterface as VioletTokenInterface;
const entries = Object.entries(contract.tokens);

describe("the token interface (tokens/interface.json)", () => {
    it("scans the shipped sources", () => {
        expect(Object.keys(sources).length).toBeGreaterThan(100);
        expect(Object.keys(sources)).toContain("./violet-theme-runtime.ts");
        expect(Object.keys(sources).some(path => path.endsWith(".spec.ts"))).toBe(false);
    });

    it("reads every var() and getPropertyValue() argument as a literal property", () => {
        expect(scan().unresolved, "use a literal property, or allow the call with its reason").toEqual([]);
    });

    it("lists every theme property a component reads", () => {
        const listed = new Set(entries.map(([, entry]) => entry.property));
        const missing = [...scan().read]
            .filter(([property]) => !listed.has(property))
            .map(([property, paths]) => `${property} (read by ${[...new Set(paths)].join(", ")})`);
        expect(missing, "add each to tokens/interface.json, bump its contractVersion and supply it in Loam's tree").toEqual([]);
    });

    it("lists only properties a component reads, unless reserved", () => {
        const { read } = scan();
        const unread = entries.filter(([, entry]) => !entry.reserved && !read.has(entry.property)).map(([id]) => id);
        const reservedButRead = entries.filter(([, entry]) => entry.reserved && read.has(entry.property)).map(([id]) => id);
        expect(unread, "remove each from tokens/interface.json or mark it reserved, and bump its contractVersion").toEqual([]);
        expect(reservedButRead, "drop `reserved` from each").toEqual([]);
    });

    it("changes its ids, properties or types only with a new contractVersion", async () => {
        expect(
            await digest(contract),
            `contractVersion ${contract.contractVersion}'s ids changed: bump contractVersion and record its digest`,
        ).toBe(CONTRACT_DIGESTS[contract.contractVersion]);
    });

    it("names each property from its id and gives it a known type", () => {
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
        expect(findVioletThemeSetGaps(violetThemeBuiltInSet, contract)).toEqual({ problems: [], missing: [], complete: true });
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
        ).toEqual({ problems: [], missing: [], complete: true });
    });

    it("names every id a preset lacks, apart from validation problems", () => {
        expect(
            findVioletThemeSetGaps(
                { defaultPreset: "day", presets: { day: [{ id: "color.surface.page", value: "#fff" }], night: [] } },
                tiny,
            ),
        ).toEqual({
            problems: [],
            missing: [
                { preset: "day", id: "font.family.body", property: "--font-family-body" },
                { preset: "night", id: "font.family.body", property: "--font-family-body" },
            ],
            complete: false,
        });
        expect(
            findVioletThemeSetGaps({ defaultPreset: "noon", presets: { day: [] } }, tiny),
        ).toEqual({
            problems: ["the default preset 'noon' is not one of the presets (day)"],
            missing: [],
            complete: false,
        });
    });
});
