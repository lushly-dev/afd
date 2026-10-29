import { afterEach, describe, expect, it } from "vitest";

import "./violet-color-swatch";
import type { VioletColorSwatch } from "./violet-color-swatch";

async function renderSwatch(): Promise<VioletColorSwatch> {
    document.body.innerHTML = "";
    const swatch = document.createElement("violet-color-swatch") as VioletColorSwatch;
    document.body.append(swatch);
    await customElements.whenDefined("violet-color-swatch");
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
    return swatch;
}

describe("violet-color-swatch", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("normalizes shorthand hex colors", async () => {
        const swatch = await renderSwatch();
        swatch.value = "#abc";
        await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));

        expect(swatch.normalizedValue).toBe("#aabbcc");
    });

    it("uses the provided label for non-decorative output", async () => {
        const swatch = await renderSwatch();
        swatch.value = "#244635";
        swatch.label = "Evergreen";
        await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));

        const surface = swatch.shadowRoot?.querySelector(".swatch");
        expect(surface?.getAttribute("aria-label")).toBe("Evergreen");
    });
});
