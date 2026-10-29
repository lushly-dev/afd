import { afterEach, describe, expect, it } from "vitest";

import "./violet-toast";
import type { VioletToast } from "./violet-toast";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderToast(
    template = `
        <violet-toast open tone="success" timeout="5000">
            <span slot="title">Propagation synced</span>
            Seed-source defaults were updated for the spring-greens plan.
        </violet-toast>
    `
): Promise<VioletToast> {
    document.body.innerHTML = template;
    await customElements.whenDefined("violet-toast");
    await nextFrame();
    return document.querySelector("violet-toast") as VioletToast;
}

describe("violet-toast", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("defaults to polite status semantics when open", async () => {
        const toast = await renderToast();
        const copy = toast.shadowRoot?.querySelector(".copy");

        expect(copy?.getAttribute("role")).toBe("status");
        expect(copy?.getAttribute("aria-live")).toBe("polite");
    });

    it("keeps the title and body content available", async () => {
        const toast = await renderToast();
        const titleSlot = toast.shadowRoot?.querySelector('slot[name="title"]') as HTMLSlotElement | null;
        const bodySlot = toast.shadowRoot?.querySelector(".content slot:not([name])") as HTMLSlotElement | null;
        const titleText = titleSlot?.assignedNodes({ flatten: true }).map(node => node.textContent ?? "").join("").trim();
        const bodyText = bodySlot?.assignedNodes({ flatten: true }).map(node => node.textContent ?? "").join("").trim();

        expect(titleText).toBe("Propagation synced");
        expect(bodyText?.includes("Seed-source defaults")).toBe(true);
    });

    it("does not auto-dismiss when actions are present", async () => {
        const toast = await renderToast(`
            <violet-toast open timeout="20">
                Save complete.
                <span slot="actions">Undo</span>
            </violet-toast>
        `);

        await new Promise(resolve => window.setTimeout(resolve, 60));

        expect(toast.hasAttribute("open")).toBe(true);
    });

    it("dismisses when the dismiss button is clicked", async () => {
        const toast = await renderToast(`<violet-toast open dismissible>Dismiss me.</violet-toast>`);
        const dismissButton = toast.shadowRoot
            ?.querySelector("violet-icon-button")
            ?.shadowRoot
            ?.querySelector("button") as HTMLButtonElement | null;

        dismissButton?.click();
        await nextFrame();

        expect(toast.open).toBe(false);
    });
});
