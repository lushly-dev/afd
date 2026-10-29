import { afterEach, describe, expect, it } from "vitest";

import "./violet-skeleton";
import type { VioletSkeleton } from "./violet-skeleton";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderSkeleton(): Promise<VioletSkeleton> {
    document.body.innerHTML = "";
    const skeleton = document.createElement("violet-skeleton") as VioletSkeleton;
    document.body.append(skeleton);
    await customElements.whenDefined("violet-skeleton");
    await nextFrame();
    return skeleton;
}

describe("violet-skeleton", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("is hidden from assistive technology by default", async () => {
        const skeleton = await renderSkeleton();
        expect(skeleton.getAttribute("aria-hidden")).toBe("true");
    });

    it("renders multiple bars for text-line placeholders", async () => {
        const skeleton = await renderSkeleton();
        skeleton.shape = "text";
        skeleton.lines = "3";
        await nextFrame();

        const bars = skeleton.shadowRoot?.querySelectorAll(".bar");
        expect(bars?.length).toBe(3);
    });
});
