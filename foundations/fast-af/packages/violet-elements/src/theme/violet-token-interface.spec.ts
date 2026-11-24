import { describe, expect, it } from "vitest";

import tokenInterface from "../../tokens/interface.json";
import { violetThemeBuiltInSet } from "./generated/violet-theme.generated";
import { tokenCustomProperty } from "./generated/violet-token-property.generated";
import {
    VIOLET_CSS_PREFIX,
    VIOLET_TOKEN_TYPES,
    findVioletThemeSetGaps,
    violetTokenProperty,
    type VioletTokenInterface,
} from "./violet-theme-css";

// Every source file the package ships: specs, stories and the generated theme data read no token.
const sources = import.meta.glob<string>(["../**/*.ts", "!../**/*.spec.ts", "!../**/*.stories.ts", "!./generated/**"], {
    query: "?raw",
    import: "default",
    eager: true,
});

const TOKEN_TYPES = new Set<string>(VIOLET_TOKEN_TYPES);

/**
 * Each contract version's digest: SHA-256 of the sorted `id:property:type` lines. Changing the
 * interface without a new version fails here; add the new version's digest when you bump it.
 */
const CONTRACT_DIGESTS: Readonly<Record<number, string>> = {
    1: "0fd1c3c87bff39e5d24aa8e0f846e569f469bc1194fac6a8d298f595adb3eebd",
    // The Refined design: font.family.heading, shadow.well and the five color.field.* ids fields read.
    2: "a62b51f27974d98d9c78da13bd0d5ac8e5f91d0fbb8423cfff5f5148b1d34638",
    // Distinct accent tokens (#1577): color.accent.background and color.accent.text.
    3: "46a6fc2d8be329e3be627635fa848d92396f56d17475bbf389e6d628de5cabf2",
    // Every property under cssPrefix `violet` (#1786): `--violet-<kebab id>`.
    4: "e986d5697ea6263de35b42396ddd22599fe7d290f7288402bd3ede8e907eb362",
};

/**
 * The components' own knobs (`--violet-<name>`, set by a host, not by a theme) whose names begin
 * like a token's: each with why it is a knob. Any other `--violet-<family>-` read must be listed.
 */
const KNOBS: Readonly<Record<string, string>> = {
    "--violet-font-family": "the host's typeface override, read ahead of font.family.body (#512)",
};

/** `--violet-color-`, `--violet-size-` and so on: the start of every token family's properties. */
const TOKEN_FAMILIES = [...new Set(Object.keys(tokenInterface.tokens).map(id => id.split(".")[0]))].map(
    family => `${violetTokenProperty(family)}-`,
);

/**
 * Calls the scan cannot read as a literal property, each with why no component reads a theme
 * property through it. Keyed by file and the call's first characters.
 */
const UNRESOLVED_ALLOWED: Readonly<Record<string, string>> = {
    // The foundations story's registry renders the export's own references as `var(--<ref>)`.
    "../foundations/token-registry.ts: var(${tokenIdToCssVar(value.ref)})": "renders the export's references",
    // The deprecated alias block points each old name at its token's property; it reads nothing itself.
    "./violet-theme-css.ts: var(${violetTokenProperty(id)})": "writes the alias block's var() of each property",
    // Standard CSS Anchor Positioning property, not a theme token.
    '../shared/overlay-positioning.ts: getPropertyValue("anchor-name")': "reads standard CSS anchor-name property",
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
 * comments, less private aliases (`--_x`) and the components' own knobs (`--violet-<name>` outside
 * the token families, and `KNOBS`), which a theme does not set. A read of an unprefixed name
 * (`--color-x`, the names before contract version 4) counts as a theme read, so it fails as
 * unlisted. A call whose argument is a template, a variable or anything else the scan cannot read
 * is reported, so a read cannot hide from the interface.
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
            const knob =
                literal.startsWith("--violet-") &&
                (literal in KNOBS || !TOKEN_FAMILIES.some(family => literal.startsWith(family)));
            if (literal.startsWith("--_") || knob) {
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

    it("names each property from its id under cssPrefix and gives it a known type", () => {
        expect(contract.cssPrefix).toBe(VIOLET_CSS_PREFIX);
        expect(VIOLET_CSS_PREFIX).toBe("violet");
        for (const [id, entry] of entries) {
            expect(entry.property, id).toBe(violetTokenProperty(id));
            expect(entry.property, id).toBe(tokenCustomProperty(id, contract.cssPrefix));
            expect(TOKEN_TYPES.has(entry.type), `${id} has type ${entry.type}`).toBe(true);
        }
        expect(contract.tokens["font.family.body"]).toEqual({ property: "--violet-font-family-body", type: "fontFamily" });
        // Read by the tool-call card since contract version 2, so no longer reserved.
        expect(contract.tokens["font.family.mono"]).toEqual({ property: "--violet-font-family-mono", type: "fontFamily" });
        expect(contract.tokens["font.family.heading"]).toEqual({ property: "--violet-font-family-heading", type: "fontFamily" });
        expect(contract.tokens["shadow.well"]).toEqual({ property: "--violet-shadow-well", type: "shadow" });
        expect(contract.tokens["color.accent.background"]).toEqual({ property: "--violet-color-accent-background", type: "color" });
        expect(contract.tokens["color.accent.text"]).toEqual({ property: "--violet-color-accent-text", type: "color" });
    });

    it("keeps each knob that begins like a token out of the tokens' properties", () => {
        const properties = new Set(entries.map(([, entry]) => entry.property));
        for (const knob of Object.keys(KNOBS)) {
            expect(properties.has(knob), `${knob} is a token's property`).toBe(false);
        }
        expect(TOKEN_FAMILIES).toContain("--violet-color-");
    });

    it("is supplied in full by the built-in default set, in every preset", () => {
        expect(findVioletThemeSetGaps(violetThemeBuiltInSet, contract)).toEqual({ problems: [], missing: [], complete: true });
    });
});

describe("findVioletThemeSetGaps", () => {
    const tiny: VioletTokenInterface = {
        contractVersion: 1,
        tokens: {
            "color.surface.page": { property: "--violet-color-surface-page", type: "color" },
            "font.family.body": { property: "--violet-font-family-body", type: "fontFamily" },
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
                { preset: "day", id: "font.family.body", property: "--violet-font-family-body" },
                { preset: "night", id: "font.family.body", property: "--violet-font-family-body" },
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
