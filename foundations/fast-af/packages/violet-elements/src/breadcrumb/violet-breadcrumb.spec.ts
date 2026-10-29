import { afterEach, describe, expect, it } from "vitest";

import "../breadcrumb-item/violet-breadcrumb-item";
import "./violet-breadcrumb";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

describe("violet-breadcrumb", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("marks the last item as current", async () => {
        document.body.innerHTML = `
            <violet-breadcrumb label="Breadcrumb">
                <violet-breadcrumb-item href="/plans">Plans</violet-breadcrumb-item>
                <violet-breadcrumb-item href="/plans/propagation">Propagation</violet-breadcrumb-item>
                <violet-breadcrumb-item>Current</violet-breadcrumb-item>
            </violet-breadcrumb>
        `;

        await customElements.whenDefined("violet-breadcrumb");
        await nextFrame();

        const items = document.querySelectorAll("violet-breadcrumb-item");
        expect(items[2]?.hasAttribute("current")).toBe(true);
    });

    it("renders inert text instead of a fake link when a non-current item has no href", async () => {
        document.body.innerHTML = `
            <violet-breadcrumb label="Breadcrumb">
                <violet-breadcrumb-item>Plans</violet-breadcrumb-item>
                <violet-breadcrumb-item current>Current</violet-breadcrumb-item>
            </violet-breadcrumb>
        `;

        await customElements.whenDefined("violet-breadcrumb");
        await nextFrame();

        const firstItem = document.querySelector("violet-breadcrumb-item");
        const link = firstItem?.shadowRoot?.querySelector("a");
        const labelSlot = firstItem?.shadowRoot?.querySelector(".label slot") as HTMLSlotElement | null;
        const assignedText = labelSlot
            ?.assignedNodes({ flatten: true })
            .map(node => node.textContent ?? "")
            .join("")
            .trim();

        expect(link).toBeNull();
        expect(assignedText).toBe("Plans");
    });

    it("hides the separator on the current item", async () => {
        document.body.innerHTML = `
            <violet-breadcrumb label="Breadcrumb">
                <violet-breadcrumb-item href="/plans">Plans</violet-breadcrumb-item>
                <violet-breadcrumb-item current>Current</violet-breadcrumb-item>
            </violet-breadcrumb>
        `;

        await customElements.whenDefined("violet-breadcrumb");
        await nextFrame();

        const currentItem = document.querySelectorAll("violet-breadcrumb-item")[1];
        const separator = currentItem?.shadowRoot?.querySelector(".separator") as HTMLElement | null;

        expect(getComputedStyle(separator as Element).display).toBe("none");
    });
});
