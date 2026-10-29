import { afterEach, describe, expect, it } from "vitest";

import "./violet-snackbar";
import type { VioletSnackbar } from "./violet-snackbar";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderSnackbar(
    template = `<violet-snackbar open>Row changes synced.</violet-snackbar>`
): Promise<VioletSnackbar> {
    document.body.innerHTML = template;
    await customElements.whenDefined("violet-snackbar");
    await nextFrame();
    return document.querySelector("violet-snackbar") as VioletSnackbar;
}

describe("violet-snackbar", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("defaults to polite status semantics when open", async () => {
        const snackbar = await renderSnackbar();
        const messageCopy = snackbar.shadowRoot?.querySelector(".message-copy");

        expect(messageCopy?.getAttribute("role")).toBe("status");
        expect(messageCopy?.getAttribute("aria-live")).toBe("polite");
    });

    it("renders action slot content when provided", async () => {
        const snackbar = await renderSnackbar(`
            <violet-snackbar open>
                Row changes synced.
                <span slot="action">Undo</span>
            </violet-snackbar>
        `);
        const actionSlot = snackbar.shadowRoot?.querySelector('slot[name="action"]') as HTMLSlotElement | null;
        const actionText = actionSlot?.assignedNodes({ flatten: true }).map(node => node.textContent ?? "").join("").trim();

        expect(actionText).toBe("Undo");
    });

    it("does not auto-dismiss when an action is present", async () => {
        const snackbar = await renderSnackbar(`
            <violet-snackbar open timeout="20">
                Row changes synced.
                <span slot="action">Undo</span>
            </violet-snackbar>
        `);

        await new Promise(resolve => window.setTimeout(resolve, 60));

        expect(snackbar.hasAttribute("open")).toBe(true);
    });

    it("dismisses when the dismiss button is clicked", async () => {
        const snackbar = await renderSnackbar(`<violet-snackbar open dismissible>Dismiss me.</violet-snackbar>`);
        const dismissButton = snackbar.shadowRoot
            ?.querySelector("violet-icon-button")
            ?.shadowRoot
            ?.querySelector("button") as HTMLButtonElement | null;

        dismissButton?.click();
        await nextFrame();

        expect(snackbar.open).toBe(false);
    });
});
