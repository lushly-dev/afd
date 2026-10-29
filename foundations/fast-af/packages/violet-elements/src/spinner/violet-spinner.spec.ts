import { afterEach, describe, expect, it } from "vitest";

import "./violet-spinner";
import type { VioletSpinner } from "./violet-spinner";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderSpinner(
    template = `<violet-spinner label="Loading greenhouse telemetry" size="lg"></violet-spinner>`
): Promise<VioletSpinner> {
    document.body.innerHTML = template;
    await customElements.whenDefined("violet-spinner");
    await nextFrame();
    return document.querySelector("violet-spinner") as VioletSpinner;
}

describe("violet-spinner", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("announces a stable loading label by default", async () => {
        const spinner = await renderSpinner();
        const indicator = spinner.shadowRoot?.querySelector(".spinner") as HTMLElement | null;

        expect(indicator?.getAttribute("role")).toBe("img");
        expect(indicator?.getAttribute("aria-label")).toBe("Loading greenhouse telemetry");
        expect(spinner.getAttribute("size")).toBe("lg");
    });

    it("falls back to a generic loading label", async () => {
        const spinner = await renderSpinner(`<violet-spinner></violet-spinner>`);
        const indicator = spinner.shadowRoot?.querySelector(".spinner") as HTMLElement | null;

        expect(indicator?.getAttribute("aria-label")).toBe("Loading");
    });

    it("can be marked decorative", async () => {
        const spinner = await renderSpinner(`<violet-spinner decorative></violet-spinner>`);
        const indicator = spinner.shadowRoot?.querySelector(".spinner") as HTMLElement | null;

        expect(indicator?.getAttribute("role")).toBe("presentation");
        expect(indicator?.getAttribute("aria-hidden")).toBe("true");
    });
});
