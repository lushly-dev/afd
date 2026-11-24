import { afterEach, describe, expect, it, vi } from "vitest";

import { installVioletTheme, loadVioletBuiltInTheme, setVioletBuiltInThemeImporterForTesting } from "./violet-theme-runtime";

/** A sheet's rules as the browser serializes them; empty for a sheet with no rules. */
function sheetText(sheet: CSSStyleSheet): string {
    return [...sheet.cssRules].map(rule => rule.cssText).join("\n");
}

describe("a built-in theme chunk that fails to load", () => {
    afterEach(() => {
        document.adoptedStyleSheets = [];
        setVioletBuiltInThemeImporterForTesting(() => import("./violet-theme-builtin"));
        vi.restoreAllMocks();
    });

    it("is reported, not left as an unhandled rejection, and retried by the next install", async () => {
        let fail = true;
        const importer = vi.fn(async () => {
            if (fail) {
                throw new Error("chunk failed");
            }
            return { violetThemeCssText: ":root { --violet-color-surface-page: #fff; }" };
        });
        setVioletBuiltInThemeImporterForTesting(importer);
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const unhandled = vi.fn();
        window.addEventListener("unhandledrejection", unhandled);

        const sheet = installVioletTheme(document);
        await vi.waitFor(() =>
            expect(error).toHaveBeenCalledWith(expect.stringMatching(/failed to load; the next install retries/), expect.any(Error)),
        );
        expect(sheet.cssRules).toHaveLength(0);
        expect([...document.adoptedStyleSheets]).toEqual([sheet]);
        // Not cached: an explicit call tries again, and fails again while the chunk is missing.
        await expect(loadVioletBuiltInTheme()).rejects.toThrow("chunk failed");
        expect(importer).toHaveBeenCalledTimes(2);

        fail = false;
        installVioletTheme(document);
        await expect(loadVioletBuiltInTheme()).resolves.toBe(":root { --violet-color-surface-page: #fff; }");
        expect(importer).toHaveBeenCalledTimes(3);
        expect(sheetText(sheet)).toBe(":root { --violet-color-surface-page: #fff; }");

        await new Promise(resolve => setTimeout(resolve, 0));
        window.removeEventListener("unhandledrejection", unhandled);
        expect(unhandled).not.toHaveBeenCalled();
    });

    it("defers invoking the built-in importer by a microtask to avoid TDZ during synchronous upgrade (#2072)", async () => {
        let initialized = false;
        const importer = vi.fn(() => {
            if (!initialized) {
                throw new ReferenceError("Cannot access 'violetThemeCssText' before initialization");
            }
            return Promise.resolve({ violetThemeCssText: ":root { --violet-color-surface-page: #f4f0ea; }" });
        });
        setVioletBuiltInThemeImporterForTesting(importer);
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        // Simulates a single-file bundle where <violet-theme> upgrades synchronously before the
        // inlined violet-theme-builtin const bindings finish initializing later in the same turn.
        const sheet = installVioletTheme(document);
        expect(importer).not.toHaveBeenCalled();
        initialized = true;

        await expect(loadVioletBuiltInTheme()).resolves.toBe(":root { --violet-color-surface-page: #f4f0ea; }");
        expect(importer).toHaveBeenCalledTimes(1);
        expect(sheetText(sheet)).toBe(":root { --violet-color-surface-page: #f4f0ea; }");
        expect(error).not.toHaveBeenCalled();
    });

    it.each(["undefined-namespace", "tdz-reference-error"] as const)(
        "recovers across multiple awaited registrations in a single-file bundle (%s) (#2072)",
        async mode => {
            let initialized = false;
            const importer = vi.fn(() => {
                if (!initialized) {
                    if (mode === "tdz-reference-error") {
                        throw new ReferenceError("Cannot access 'violetThemeBuiltin' before initialization");
                    }
                    // Rollup inlineDynamicImports hoists `var violetThemeBuiltin` as undefined until
                    // every top-level `await FASTElement.define(...)` in the bundle resolves.
                    return Promise.resolve(undefined as unknown as { violetThemeCssText: string });
                }
                return Promise.resolve({ violetThemeCssText: ":root { --violet-color-surface-page: #141a18; }" });
            });
            setVioletBuiltInThemeImporterForTesting(importer);
            const error = vi.spyOn(console, "error").mockImplementation(() => {});

            const sheet = installVioletTheme(document);
            // Simulate subsequent `await FASTElement.define(...)` microtasks finishing before the
            // bottom of the bundle initializes `violetThemeBuiltin`.
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            initialized = true;

            await expect(loadVioletBuiltInTheme()).resolves.toBe(":root { --violet-color-surface-page: #141a18; }");
            expect(importer).toHaveBeenCalledTimes(2);
            expect(sheetText(sheet)).toBe(":root { --violet-color-surface-page: #141a18; }");
            expect(error).not.toHaveBeenCalled();
        },
    );
});
