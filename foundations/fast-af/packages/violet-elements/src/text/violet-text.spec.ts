import { afterEach, describe, expect, it } from "vitest";

import "./violet-text";
import type { VioletText } from "./violet-text";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderText(): Promise<VioletText> {
    document.body.innerHTML = "";
    const text = document.createElement("violet-text") as VioletText;
    text.as = "p";
    text.variant = "body";
    text.textContent = "Propagation notes";
    document.body.append(text);
    await customElements.whenDefined("violet-text");
    await nextFrame();
    return text;
}

describe("violet-text", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders the requested semantic element", async () => {
        const text = await renderText();
        const paragraph = text.shadowRoot?.querySelector("p");

        expect(paragraph).toBeTruthy();
        expect(text.textContent).toContain("Propagation notes");
    });

    it("applies truncation through the root class", async () => {
        const text = await renderText();
        text.as = "span";
        text.truncate = true;
        await nextFrame();

        const root = text.shadowRoot?.querySelector(".root");
        expect(root?.className).toContain("truncate");
    });
});
