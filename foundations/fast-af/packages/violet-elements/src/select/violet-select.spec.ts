import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import "../option/violet-option";
import "./violet-select";
import type { VioletSelect } from "./violet-select";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function waitForShadow<T>(get: () => T | null, description: string): Promise<T> {
    return vi.waitFor(() => {
        const value = get();
        expect(value, description).not.toBeNull();
        return value as T;
    });
}

function createOption(label: string, value: string): HTMLElement {
    const option = document.createElement("violet-option");
    option.setAttribute("value", value);
    option.textContent = label;
    return option;
}

async function renderSelect(): Promise<VioletSelect> {
    document.body.innerHTML = "";
    const select = document.createElement("violet-select") as VioletSelect;
    select.label = "Propagation";
    select.supportingText = "Choose a default path.";
    select.value = "direct";
    select.append(createOption("Broadcast", "broadcast"), createOption("Direct", "direct"), createOption("Transplant", "transplant"));
    document.body.append(select);
    await customElements.whenDefined("violet-select");
    await nextFrame();
    return select;
}

describe("violet-select", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("reflects the selected option label in the trigger text", async () => {
        const select = await renderSelect();
        expect(select.selectedLabel).toBe("Direct");
    });

    it("commits the active option and closes", async () => {
        const select = await renderSelect();
        select.show();
        select.handleListboxKeydown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
        select.handleListboxKeydown(new KeyboardEvent("keydown", { key: "Enter" }));
        await nextFrame();

        expect(select.value).toBe("transplant");
        expect(select.open).toBe(false);
    });

    it("keeps native keyboard defaults while opening and selecting through rendered bindings", async () => {
        const select = await renderSelect();
        const before = document.createElement("button");
        before.textContent = "Before";
        const after = document.createElement("button");
        after.textContent = "After";
        document.body.prepend(before);
        document.body.append(after);

        const trigger = select.shadowRoot?.querySelector<HTMLButtonElement>(".trigger");

        if (!trigger) {
            throw new Error("Expected select trigger to render.");
        }
        expect(trigger?.getAttribute("aria-labelledby")).toContain(select.valueId);
        expect(trigger?.textContent).toContain("Direct");

        trigger.focus();
        const character = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "x",
        });
        trigger.dispatchEvent(character);
        expect(character.defaultPrevented).toBe(false);

        const openWithSpace = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: " ",
        });
        trigger.dispatchEvent(openWithSpace);
        expect(openWithSpace.defaultPrevented).toBe(true);
        await vi.waitFor(() => expect(select.open).toBe(true));
        expect(select.open).toBe(true);

        const listbox = await waitForShadow(
            () => select.shadowRoot?.querySelector<HTMLElement>('[role="listbox"]') ?? null,
            "Expected select listbox to render."
        );
        listbox.focus();
        const moveDown = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "ArrowDown",
        });
        listbox.dispatchEvent(moveDown);
        expect(moveDown.defaultPrevented).toBe(true);
        const commit = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "Enter",
        });
        listbox.dispatchEvent(commit);
        expect(commit.defaultPrevented).toBe(true);
        await vi.waitFor(() => expect(select.open).toBe(false));

        expect(select.value).toBe("transplant");
        expect(select.open).toBe(false);
        expect(select.shadowRoot?.activeElement).toBe(trigger);

        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
        await vi.waitFor(() => expect(select.open).toBe(true));
        expect(select.open).toBe(true);
        const forwardTab = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "Tab",
        });
        const openListbox = await waitForShadow(
            () => select.shadowRoot?.querySelector<HTMLElement>('[role="listbox"]') ?? null,
            "Expected select listbox to render."
        );
        openListbox.dispatchEvent(forwardTab);
        expect(forwardTab.defaultPrevented).toBe(false);
        openListbox.dispatchEvent(
            new FocusEvent("focusout", {
                bubbles: true,
                composed: true,
                relatedTarget: after,
            })
        );
        after.focus();
        await nextFrame();
        expect(select.open).toBe(false);
        expect(document.activeElement).toBe(after);

        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
        await vi.waitFor(() => expect(select.open).toBe(true));
        const reverseTab = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "Tab",
            shiftKey: true,
        });
        const reopenedListbox = await waitForShadow(
            () => select.shadowRoot?.querySelector<HTMLElement>('[role="listbox"]') ?? null,
            "Expected select listbox to render after reopening."
        );
        reopenedListbox.dispatchEvent(reverseTab);
        expect(reverseTab.defaultPrevented).toBe(false);
        reopenedListbox.dispatchEvent(
            new FocusEvent("focusout", {
                bubbles: true,
                composed: true,
                relatedTarget: before,
            })
        );
        before.focus();
        await nextFrame();
        expect(select.open).toBe(false);
        expect(document.activeElement).toBe(before);
    });

    it("passes composing shortcut keys through the rendered trigger and listbox", async () => {
        const select = await renderSelect();
        const trigger = select.shadowRoot?.querySelector<HTMLButtonElement>(".trigger");

        if (!trigger) {
            throw new Error("Expected select trigger to render.");
        }
        trigger.focus();

        const triggerEvent = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            isComposing: true,
            key: "ArrowDown",
        });
        trigger.dispatchEvent(triggerEvent);
        expect(triggerEvent.defaultPrevented).toBe(false);
        expect(select.open).toBe(false);

        const composingEnter = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            isComposing: true,
            key: "Enter",
        });
        trigger.dispatchEvent(composingEnter);
        expect(composingEnter.defaultPrevented).toBe(false);
        expect(select.open).toBe(false);

        const openWithEnter = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "Enter",
        });
        trigger.dispatchEvent(openWithEnter);
        expect(openWithEnter.defaultPrevented).toBe(true);
        await vi.waitFor(() => expect(select.open).toBe(true));
        const listbox = await waitForShadow(
            () => select.shadowRoot?.querySelector<HTMLElement>('[role="listbox"]') ?? null,
            "Expected select listbox to render after opening."
        );
        listbox.focus();

        const listboxEvent = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            composed: true,
            key: "ArrowDown",
        });
        Object.defineProperty(listboxEvent, "keyCode", { value: 229 });
        listbox.dispatchEvent(listboxEvent);
        expect(listboxEvent.defaultPrevented).toBe(false);
        expect(select.activeValue).toBe("direct");
    });

    it("closes on outside focus while keeping internal focus transfers open", async () => {
        const select = await renderSelect();
        const outside = document.createElement("button");
        outside.textContent = "Outside";
        document.body.append(outside);

        const trigger = select.shadowRoot?.querySelector<HTMLButtonElement>(".trigger");
        if (!trigger) {
            throw new Error("Expected select trigger to render.");
        }

        await userEvent.click(trigger);
        await vi.waitFor(() => expect(select.open).toBe(true));
        const listbox = await waitForShadow(
            () => select.shadowRoot?.querySelector<HTMLElement>('[role="listbox"]') ?? null,
            "Expected select listbox to render for focus transfer."
        );
        listbox.focus();
        trigger.focus();
        expect(select.open).toBe(true);

        const outsideFocusOut = new FocusEvent("focusout", {
            bubbles: true,
            composed: true,
            relatedTarget: outside,
        });
        trigger.dispatchEvent(outsideFocusOut);
        await nextFrame();
        expect(select.open).toBe(false);
    });
});
