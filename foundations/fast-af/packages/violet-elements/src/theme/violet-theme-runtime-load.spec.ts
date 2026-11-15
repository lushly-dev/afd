import { afterEach, describe, expect, it, vi } from "vitest";

import { installVioletTheme, loadVioletBuiltInTheme, setVioletBuiltInThemeImporterForTesting } from "./violet-theme-runtime";

describe("a built-in theme chunk that fails to load", () => {
    afterEach(() => {
        document.querySelectorAll('style[data-violet-theme="runtime"]').forEach(node => {
            node.remove();
        });
        setVioletBuiltInThemeImporterForTesting(() => import("./violet-theme-builtin"));
        vi.restoreAllMocks();
    });

    it("is reported, not left as an unhandled rejection, and retried by the next install", async () => {
        let fail = true;
        const importer = vi.fn(async () => {
            if (fail) {
                throw new Error("chunk failed");
            }
            return { violetThemeCssText: ":root { --color-surface-page: #fff; }" };
        });
        setVioletBuiltInThemeImporterForTesting(importer);
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const unhandled = vi.fn();
        window.addEventListener("unhandledrejection", unhandled);

        const style = installVioletTheme(document);
        await vi.waitFor(() =>
            expect(error).toHaveBeenCalledWith(expect.stringMatching(/failed to load; the next install retries/), expect.any(Error)),
        );
        expect(style.textContent).toBe("");
        // Not cached: an explicit call tries again, and fails again while the chunk is missing.
        await expect(loadVioletBuiltInTheme()).rejects.toThrow("chunk failed");
        expect(importer).toHaveBeenCalledTimes(2);

        fail = false;
        installVioletTheme(document);
        await expect(loadVioletBuiltInTheme()).resolves.toBe(":root { --color-surface-page: #fff; }");
        expect(importer).toHaveBeenCalledTimes(3);
        expect(style.textContent).toBe(":root { --color-surface-page: #fff; }");

        await new Promise(resolve => setTimeout(resolve, 0));
        window.removeEventListener("unhandledrejection", unhandled);
        expect(unhandled).not.toHaveBeenCalled();
    });
});
