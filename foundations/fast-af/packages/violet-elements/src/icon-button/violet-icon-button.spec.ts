import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-icon-button";
import type { VioletIconButton } from "./violet-icon-button";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function renderIconButton(configure?: (button: VioletIconButton) => void): Promise<VioletIconButton> {
    document.body.innerHTML = "";

    const button = document.createElement("violet-icon-button") as VioletIconButton;
    const glyph = document.createElement("span");
    glyph.textContent = "+";
    button.append(glyph);
    configure?.(button);
    document.body.append(button);

    await customElements.whenDefined("violet-icon-button");
    await nextFrame();

    return button;
}

function control(button: VioletIconButton): HTMLButtonElement {
    const native = button.shadowRoot?.querySelector("button");
    if (!native) {
        throw new Error("violet-icon-button did not render its native control");
    }
    return native;
}

describe("violet-icon-button", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders a native button with defaults", async () => {
        const button = await renderIconButton();

        expect(button.appearance).toBe("secondary");
        expect(button.type).toBe("button");
        expect(button.disabled).toBe(false);
        expect(button.label).toBe("");
        expect(control(button).getAttribute("type")).toBe("button");
        expect(control(button).getAttribute("data-appearance")).toBe("secondary");
    });

    it("uses the label as the accessible name and tooltip", async () => {
        const button = await renderIconButton(el => {
            el.setAttribute("label", "Add item");
        });

        expect(button.label).toBe("Add item");
        expect(control(button).getAttribute("aria-label")).toBe("Add item");
        expect(control(button).getAttribute("title")).toBe("Add item");

        button.label = "Add another item";
        await nextFrame();

        expect(button.getAttribute("label")).toBe("Add another item");
        expect(control(button).getAttribute("aria-label")).toBe("Add another item");
    });

    it("forwards attributes to properties and the native control", async () => {
        const button = await renderIconButton(el => {
            el.setAttribute("appearance", "quiet");
            el.setAttribute("type", "submit");
            el.setAttribute("disabled", "");
        });

        expect(button.appearance).toBe("quiet");
        expect(button.type).toBe("submit");
        expect(button.disabled).toBe(true);
        expect(control(button).getAttribute("data-appearance")).toBe("quiet");
        expect(control(button).getAttribute("type")).toBe("submit");
        expect(control(button).disabled).toBe(true);
    });

    it("reflects property changes to host attributes and the control", async () => {
        const button = await renderIconButton();

        button.appearance = "primary";
        button.disabled = true;
        await nextFrame();

        expect(button.getAttribute("appearance")).toBe("primary");
        expect(button.hasAttribute("disabled")).toBe(true);
        expect(control(button).getAttribute("data-appearance")).toBe("primary");
        expect(control(button).disabled).toBe(true);

        button.disabled = false;
        await nextFrame();

        expect(button.hasAttribute("disabled")).toBe(false);
        expect(control(button).disabled).toBe(false);
    });

    it.each([
        ["Enter", "{Enter}"],
        ["Space", "{ }"],
    ])("activates with the %s key and emits a click", async (_name, keys) => {
        const button = await renderIconButton(el => {
            el.label = "Add item";
        });
        let clicks = 0;
        button.addEventListener("click", () => {
            clicks += 1;
        });

        button.focus();
        await userEvent.keyboard(keys);

        expect(clicks).toBe(1);
    });

    it("delegates focus to the inner control", async () => {
        const button = await renderIconButton();

        button.focus();

        expect(document.activeElement).toBe(button);
        expect(button.shadowRoot?.activeElement).toBe(control(button));
    });

    it("does not emit clicks or take focus when disabled", async () => {
        const button = await renderIconButton(el => {
            el.label = "Add item";
            el.disabled = true;
        });
        let clicks = 0;
        button.addEventListener("click", () => {
            clicks += 1;
        });

        control(button).click();
        button.focus();
        await userEvent.keyboard("{Enter}");

        expect(clicks).toBe(0);
        expect(document.activeElement).not.toBe(button);
    });

    it("projects slotted icon content", async () => {
        const button = await renderIconButton();
        const slot = button.shadowRoot?.querySelector("slot") as HTMLSlotElement;

        expect(slot.assignedElements()).toHaveLength(1);
        expect(slot.assignedElements()[0]?.textContent).toBe("+");
    });
});
