import { afterEach, describe, expect, it } from "vitest";

import "./violet-progress";
import type { VioletProgress } from "./violet-progress";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderProgress(
    template = `<violet-progress label="Uploading field imagery" value="48" max="100"></violet-progress>`
): Promise<VioletProgress> {
    document.body.innerHTML = template;
    await customElements.whenDefined("violet-progress");
    await nextFrame();
    return document.querySelector("violet-progress") as VioletProgress;
}

describe("violet-progress", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders a determinate native progress element", async () => {
        const progress = await renderProgress();
        const native = progress.shadowRoot?.querySelector("progress") as HTMLProgressElement | null;

        expect(native?.getAttribute("aria-label")).toBe("Uploading field imagery");
        expect(native?.getAttribute("value")).toBe("48");
        expect(progress.shadowRoot?.querySelector(".value-label")?.textContent?.trim()).toBe("48%");
    });

    it("omits the value attribute for indeterminate progress", async () => {
        const progress = await renderProgress(`<violet-progress label="Loading summary" value=""></violet-progress>`);
        const native = progress.shadowRoot?.querySelector("progress") as HTMLProgressElement | null;

        expect(native?.hasAttribute("value")).toBe(false);
        expect(progress.shadowRoot?.querySelector(".value-label")).toBeNull();
    });

    it("passes custom value text through to accessibility APIs", async () => {
        const progress = await renderProgress(
            `<violet-progress label="Irrigation capacity" value="2" max="4" value-text="Half capacity"></violet-progress>`
        );
        const native = progress.shadowRoot?.querySelector("progress") as HTMLProgressElement | null;

        expect(native?.getAttribute("aria-valuetext")).toBe("Half capacity");
        expect(progress.shadowRoot?.querySelector(".value-label")?.textContent?.trim()).toBe("50%");
    });
});
