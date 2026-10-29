import { afterEach, describe, expect, it } from "vitest";

import "./violet-image";
import type { VioletImage } from "./violet-image";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderImage(): Promise<VioletImage> {
    document.body.innerHTML = "";
    const image = document.createElement("violet-image") as VioletImage;
    image.src = "https://example.com/greenhouse.jpg";
    image.alt = "Greenhouse trays";
    document.body.append(image);
    await customElements.whenDefined("violet-image");
    await nextFrame();
    return image;
}

describe("violet-image", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders a native image when src is available", async () => {
        const image = await renderImage();
        expect(image.shadowRoot?.querySelector("img")?.getAttribute("alt")).toBe("Greenhouse trays");
    });

    it("shows fallback content after an image error", async () => {
        const image = await renderImage();
        image.handleImageError();
        await nextFrame();
        await nextFrame();

        expect(image.shadowRoot?.querySelector("img")?.hasAttribute("hidden")).toBe(true);
        expect(image.shadowRoot?.textContent).toContain("Image unavailable");
    });

    it("shows default fallback content when no source is provided", async () => {
        document.body.innerHTML = "";
        const image = document.createElement("violet-image") as VioletImage;
        image.alt = "Fallback planting image";
        document.body.append(image);
        await customElements.whenDefined("violet-image");
        await nextFrame();

        expect(image.shadowRoot?.querySelector("img")).toBeNull();
        expect(image.shadowRoot?.textContent).toContain("Image unavailable");
    });
});
