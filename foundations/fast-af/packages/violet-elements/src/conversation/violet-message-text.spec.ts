import { afterEach, describe, expect, it } from "vitest";

import "./violet-message-text";
import type { VioletMessageText } from "./violet-message-text";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderText(attrs = "", content = "Hello world"): Promise<VioletMessageText> {
    document.body.innerHTML = `<violet-message-text ${attrs}>${content}</violet-message-text>`;
    await customElements.whenDefined("violet-message-text");
    await nextFrame();
    return document.querySelector("violet-message-text") as VioletMessageText;
}

function cursorOf(text: VioletMessageText): HTMLElement {
    const cursor = text.shadowRoot?.querySelector<HTMLElement>('[part="cursor"]');
    if (!cursor) {
        throw new Error("Expected the cursor element to render.");
    }
    return cursor;
}

describe("violet-message-text", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("defaults to the done state and hides the cursor", async () => {
        const text = await renderText();

        expect(text.state).toBe("done");
        expect(cursorOf(text).hidden).toBe(true);
    });

    it("shows the cursor only while streaming", async () => {
        const text = await renderText('state="streaming"');
        expect(text.state).toBe("streaming");
        expect(cursorOf(text).hidden).toBe(false);

        text.setAttribute("state", "done");
        await nextFrame();
        expect(cursorOf(text).hidden).toBe(true);
    });

    it("reflects the state property to the attribute and back", async () => {
        const text = await renderText();

        text.state = "streaming";
        await nextFrame();
        expect(text.getAttribute("state")).toBe("streaming");
        expect(cursorOf(text).hidden).toBe(false);

        text.setAttribute("state", "done");
        expect(text.state).toBe("done");
    });

    it("hides the cursor for unknown state values", async () => {
        const text = await renderText('state="paused"');

        expect(cursorOf(text).hidden).toBe(true);
    });

    it("keeps the cursor out of the accessibility tree", async () => {
        const text = await renderText('state="streaming"');

        expect(cursorOf(text).getAttribute("aria-hidden")).toBe("true");
    });

    it("projects light DOM content through the default slot", async () => {
        const text = await renderText("", "Streamed <strong>bold</strong> reply");
        const slot = text.shadowRoot?.querySelector<HTMLSlotElement>("slot");
        const assigned = slot?.assignedNodes({ flatten: true }) ?? [];

        expect(assigned.map(node => node.textContent).join("")).toBe("Streamed bold reply");
        expect(text.querySelector("strong")).not.toBeNull();
    });

    it("exposes text and cursor parts", async () => {
        const text = await renderText();

        expect(text.shadowRoot?.querySelector('[part="text"]')).not.toBeNull();
        expect(text.shadowRoot?.querySelector('[part="cursor"]')).not.toBeNull();
    });
});
