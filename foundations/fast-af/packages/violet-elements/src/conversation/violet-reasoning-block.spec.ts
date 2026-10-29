import { afterEach, describe, expect, it } from "vitest";

import "./violet-reasoning-block";
import type { VioletReasoningBlock } from "./violet-reasoning-block";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderBlock(attrs = "", content = "Step one. Step two."): Promise<VioletReasoningBlock> {
    document.body.innerHTML = `<violet-reasoning-block ${attrs}>${content}</violet-reasoning-block>`;
    await customElements.whenDefined("violet-reasoning-block");
    await nextFrame();
    return document.querySelector("violet-reasoning-block") as VioletReasoningBlock;
}

function toggleOf(block: VioletReasoningBlock): HTMLButtonElement {
    const toggle = block.shadowRoot?.querySelector<HTMLButtonElement>('[part="toggle"]');
    if (!toggle) {
        throw new Error("Expected the toggle button to render.");
    }
    return toggle;
}

function contentOf(block: VioletReasoningBlock): HTMLElement {
    const content = block.shadowRoot?.querySelector<HTMLElement>('[part="content"]');
    if (!content) {
        throw new Error("Expected the content region to render.");
    }
    return content;
}

describe("violet-reasoning-block", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders collapsed by default with the default label", async () => {
        const block = await renderBlock();

        expect(block.expanded).toBe(false);
        expect(block.state).toBe("done");
        expect(block.label).toBe("Thinking");
        expect(toggleOf(block).textContent).toContain("Thinking");
        expect(toggleOf(block).getAttribute("aria-expanded")).toBe("false");
        expect(contentOf(block).hidden).toBe(true);
    });

    it("renders expanded when the expanded attribute is present", async () => {
        const block = await renderBlock("expanded");

        expect(block.expanded).toBe(true);
        expect(toggleOf(block).getAttribute("aria-expanded")).toBe("true");
        expect(contentOf(block).hidden).toBe(false);
    });

    it("toggles on click and reflects expanded to the attribute", async () => {
        const block = await renderBlock();

        toggleOf(block).click();
        await nextFrame();
        expect(block.expanded).toBe(true);
        expect(block.hasAttribute("expanded")).toBe(true);
        expect(toggleOf(block).getAttribute("aria-expanded")).toBe("true");
        expect(contentOf(block).hidden).toBe(false);

        toggleOf(block).click();
        await nextFrame();
        expect(block.expanded).toBe(false);
        expect(block.hasAttribute("expanded")).toBe(false);
        expect(contentOf(block).hidden).toBe(true);
    });

    it("responds to the expanded property and attribute", async () => {
        const block = await renderBlock();

        block.expanded = true;
        await nextFrame();
        expect(block.getAttribute("expanded")).toBe("");

        block.removeAttribute("expanded");
        await nextFrame();
        expect(block.expanded).toBe(false);
        expect(toggleOf(block).getAttribute("aria-expanded")).toBe("false");
    });

    it("uses a focusable native button so Enter and Space toggle it", async () => {
        const block = await renderBlock();
        const toggle = toggleOf(block);

        toggle.focus();

        expect(block.shadowRoot?.activeElement).toBe(toggle);
        expect(toggle.tagName).toBe("BUTTON");
        expect(toggle.type).toBe("button");
    });

    it("uses the label attribute for the toggle text", async () => {
        const block = await renderBlock('label="Reasoning"');

        expect(block.label).toBe("Reasoning");
        expect(toggleOf(block).textContent).toContain("Reasoning");
        expect(toggleOf(block).textContent).not.toContain("Thinking");

        block.label = "Chain of thought";
        await nextFrame();
        expect(block.getAttribute("label")).toBe("Chain of thought");
        expect(toggleOf(block).textContent).toContain("Chain of thought");
    });

    it("links the toggle to the content region", async () => {
        const block = await renderBlock();
        const content = contentOf(block);

        expect(toggleOf(block).getAttribute("aria-controls")).toBe(content.id);
        expect(content.getAttribute("role")).toBe("region");
    });

    it("shows the streaming indicator only in the streaming state", async () => {
        const block = await renderBlock('state="streaming"');
        const indicator = block.shadowRoot?.querySelector<HTMLElement>(".streaming-indicator");

        expect(indicator).not.toBeNull();
        expect(indicator?.getAttribute("aria-hidden")).toBe("true");
        expect(getComputedStyle(indicator as HTMLElement).display).not.toBe("none");

        block.setAttribute("state", "done");
        await nextFrame();
        expect(getComputedStyle(indicator as HTMLElement).display).toBe("none");
    });

    it("projects slotted reasoning text into the content region", async () => {
        const block = await renderBlock("expanded", "Because of X");
        const slot = contentOf(block).querySelector<HTMLSlotElement>("slot");
        const assigned = slot?.assignedNodes({ flatten: true }) ?? [];

        expect(assigned.map(node => node.textContent).join("")).toBe("Because of X");
    });

    it("renders the chevron icon as decorative", async () => {
        const block = await renderBlock();
        const icon = block.shadowRoot?.querySelector("violet-icon");

        expect(icon?.hasAttribute("decorative")).toBe(true);
    });
});
