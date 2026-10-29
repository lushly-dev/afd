import { afterEach, describe, expect, it } from "vitest";

import "./violet-message-status";
import type { VioletMessageStatus } from "./violet-message-status";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderStatus(attrs = "", content = ""): Promise<VioletMessageStatus> {
    document.body.innerHTML = `<violet-message-status ${attrs}>${content}</violet-message-status>`;
    await customElements.whenDefined("violet-message-status");
    await nextFrame();
    return document.querySelector("violet-message-status") as VioletMessageStatus;
}

function textOf(status: VioletMessageStatus): string {
    return status.shadowRoot?.querySelector('[part="text"]')?.textContent?.trim() ?? "";
}

describe("violet-message-status", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("defaults to the streaming status", async () => {
        const status = await renderStatus();

        expect(status.status).toBe("streaming");
        expect(textOf(status)).toBe("Responding…");
    });

    it.each([
        ["submitted", "Thinking…"],
        ["streaming", "Responding…"],
        ["error", "Something went wrong"],
        ["cancelled", "Stopped"],
        ["retrying", "Retrying…"],
    ])("renders the default text for %s", async (value, expected) => {
        const status = await renderStatus(`status="${value}"`);

        expect(textOf(status)).toBe(expected);
        expect(status.defaultText()).toBe(expected);
    });

    it("renders no default text for an unknown status", async () => {
        const status = await renderStatus('status="unknown"');

        expect(status.defaultText()).toBe("");
        expect(textOf(status)).toBe("");
    });

    it("exposes a polite status live region", async () => {
        const status = await renderStatus();
        const root = status.shadowRoot?.querySelector('[part="root"]');

        expect(root?.getAttribute("role")).toBe("status");
        expect(root?.getAttribute("aria-live")).toBe("polite");
    });

    it("updates text and reflects the attribute when status changes", async () => {
        const status = await renderStatus('status="submitted"');

        status.status = "error";
        await nextFrame();

        expect(status.getAttribute("status")).toBe("error");
        expect(textOf(status)).toBe("Something went wrong");
    });

    it.each(["streaming", "retrying"])("renders three animated dots for %s", async value => {
        const status = await renderStatus(`status="${value}"`);
        const root = status.shadowRoot;

        expect(root?.querySelectorAll(".streaming-dot")).toHaveLength(3);
        expect(root?.querySelector(".dot")).toBeNull();
    });

    it.each(["submitted", "error", "cancelled"])("renders a single dot for %s", async value => {
        const status = await renderStatus(`status="${value}"`);
        const root = status.shadowRoot;

        expect(root?.querySelectorAll(".dot")).toHaveLength(1);
        expect(root?.querySelector(".streaming-dot")).toBeNull();
    });

    it("hides indicator dots from assistive technology", async () => {
        const status = await renderStatus();
        const dots = Array.from(status.shadowRoot?.querySelectorAll(".streaming-dot") ?? []);

        expect(dots.length).toBeGreaterThan(0);
        for (const dot of dots) {
            expect(dot.getAttribute("aria-hidden")).toBe("true");
        }
    });

    it("lets slotted text override the default text", async () => {
        const status = await renderStatus('status="error"', "Custom failure text");
        const slot = status.shadowRoot?.querySelector<HTMLSlotElement>("slot");
        const assigned = slot?.assignedNodes({ flatten: true }) ?? [];

        expect(assigned.map(node => node.textContent).join("")).toBe("Custom failure text");
    });

    it("swaps the indicator when moving between dot and streaming states", async () => {
        const status = await renderStatus('status="submitted"');
        expect(status.shadowRoot?.querySelectorAll(".dot")).toHaveLength(1);

        status.setAttribute("status", "streaming");
        await nextFrame();

        expect(status.shadowRoot?.querySelectorAll(".streaming-dot")).toHaveLength(3);
        expect(status.shadowRoot?.querySelector(".dot")).toBeNull();
    });
});
