import { afterEach, describe, expect, it } from "vitest";

import "./violet-dialog";
import type { VioletDialog } from "./violet-dialog";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function settle(): Promise<void> {
    await nextFrame();
    await nextFrame();
}

async function renderDialog(attributes: Record<string, string>, content: string): Promise<VioletDialog> {
    document.body.innerHTML = "";
    const dialog = document.createElement("violet-dialog") as VioletDialog;
    for (const [name, value] of Object.entries(attributes)) {
        dialog.setAttribute(name, value);
    }
    dialog.innerHTML = `<span slot="title">Title</span>${content}`;
    document.body.append(dialog);
    await customElements.whenDefined("violet-dialog");
    await settle();
    return dialog;
}

function bodyOf(dialog: VioletDialog): HTMLElement {
    const body = dialog.shadowRoot?.querySelector<HTMLElement>(".body");
    if (!body) {
        throw new Error("Expected dialog body.");
    }
    return body;
}

describe("violet-dialog", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("restores focus to the exact trigger inside a shadow root", async () => {
        document.body.innerHTML = "";
        const host = document.createElement("div");
        // delegatesFocus makes host.focus() land on the first focusable child, so restoring
        // focus to the shadow host would pick the wrong control.
        const root = host.attachShadow({ mode: "open", delegatesFocus: true });
        const first = document.createElement("button");
        first.textContent = "First";
        const trigger = document.createElement("button");
        trigger.textContent = "Open";
        root.append(first, trigger);
        document.body.append(host);

        const dialog = document.createElement("violet-dialog") as VioletDialog;
        dialog.innerHTML = '<span slot="title">Title</span><p>Body</p>';
        document.body.append(dialog);
        await settle();

        trigger.focus();
        expect(root.activeElement).toBe(trigger);

        dialog.show();
        await settle();
        expect(root.activeElement).toBeNull();

        dialog.hide();
        await settle();

        expect(root.activeElement).toBe(trigger);
    });

    it("does not make a short body a tab stop", async () => {
        const dialog = await renderDialog({}, "<p>Short content</p>");
        dialog.show();
        await settle();

        expect(bodyOf(dialog).hasAttribute("tabindex")).toBe(false);
    });

    it("makes an overflowing body keyboard focusable", async () => {
        const dialog = await renderDialog({}, '<div style="block-size: 4000px">Tall content</div>');
        dialog.show();
        await settle();

        expect(bodyOf(dialog).getAttribute("tabindex")).toBe("0");

        dialog.hide();
        await settle();
        expect(bodyOf(dialog).hasAttribute("tabindex")).toBe(false);
    });

    it("describes an alert dialog by its body", async () => {
        const dialog = await renderDialog({ type: "alert" }, "<p>This cannot be undone.</p>");
        dialog.show();
        await settle();

        const native = dialog.shadowRoot?.querySelector("dialog");
        expect(native?.getAttribute("role")).toBe("alertdialog");

        const describedBy = native?.getAttribute("aria-describedby");
        expect(describedBy).toBe(bodyOf(dialog).id);
        expect(dialog.shadowRoot?.getElementById(describedBy ?? "")).toBe(bodyOf(dialog));
    });

    it("does not set aria-describedby for modal dialogs", async () => {
        const dialog = await renderDialog({}, "<p>Body</p>");
        dialog.show();
        await settle();

        expect(dialog.shadowRoot?.querySelector("dialog")?.hasAttribute("aria-describedby")).toBe(false);
    });
});
