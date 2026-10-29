import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-accordion-item";
import type { VioletAccordionItem } from "./violet-accordion-item";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function renderItem(configure?: (item: VioletAccordionItem) => void): Promise<VioletAccordionItem> {
    document.body.innerHTML = "";

    const item = document.createElement("violet-accordion-item") as VioletAccordionItem;
    const heading = document.createElement("span");
    heading.slot = "heading";
    heading.textContent = "Shipping";
    const body = document.createElement("p");
    body.textContent = "Ships in two days.";
    item.append(heading, body);
    configure?.(item);
    document.body.append(item);

    await customElements.whenDefined("violet-accordion-item");
    await nextFrame();

    return item;
}

function trigger(item: VioletAccordionItem): HTMLButtonElement {
    const element = item.shadowRoot?.querySelector(".trigger") as HTMLButtonElement | null;
    if (!element) {
        throw new Error("violet-accordion-item did not render its trigger");
    }
    return element;
}

function panel(item: VioletAccordionItem): HTMLElement {
    const element = item.shadowRoot?.querySelector(".panel") as HTMLElement | null;
    if (!element) {
        throw new Error("violet-accordion-item did not render its panel");
    }
    return element;
}

function trackToggles(item: VioletAccordionItem): Array<{ expanded: boolean }> {
    const details: Array<{ expanded: boolean }> = [];
    item.addEventListener("toggle-request", event => {
        details.push((event as CustomEvent<{ expanded: boolean }>).detail);
    });
    return details;
}

describe("violet-accordion-item", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("is collapsed by default with a hidden panel", async () => {
        const item = await renderItem();

        expect(item.expanded).toBe(false);
        expect(item.disabled).toBe(false);
        expect(trigger(item).getAttribute("aria-expanded")).toBe("false");
        expect(panel(item).hasAttribute("hidden")).toBe(true);
    });

    it("exposes heading, button and region semantics with linked ids", async () => {
        const item = await renderItem();
        const heading = item.shadowRoot?.querySelector(".heading") as HTMLElement;

        expect(heading.getAttribute("role")).toBe("heading");
        expect(heading.getAttribute("aria-level")).toBe("3");
        expect(trigger(item).id).toBe(item.buttonId);
        expect(trigger(item).getAttribute("aria-controls")).toBe(item.panelId);
        expect(panel(item).id).toBe(item.panelId);
        expect(panel(item).getAttribute("role")).toBe("region");
        expect(panel(item).getAttribute("aria-labelledby")).toBe(item.buttonId);
    });

    it("generates unique ids per item", () => {
        const first = document.createElement("violet-accordion-item") as VioletAccordionItem;
        const second = document.createElement("violet-accordion-item") as VioletAccordionItem;

        expect(first.panelId).not.toBe(second.panelId);
        expect(first.buttonId).not.toBe(second.buttonId);
    });

    it("shows the panel and sets aria-expanded when expanded", async () => {
        const item = await renderItem(el => {
            el.setAttribute("expanded", "");
        });

        expect(item.expanded).toBe(true);
        expect(trigger(item).getAttribute("aria-expanded")).toBe("true");
        expect(panel(item).hasAttribute("hidden")).toBe(false);

        item.expanded = false;
        await nextFrame();

        expect(item.hasAttribute("expanded")).toBe(false);
        expect(trigger(item).getAttribute("aria-expanded")).toBe("false");
        expect(panel(item).hasAttribute("hidden")).toBe(true);
    });

    it("emits toggle-request with the requested state when the trigger is clicked", async () => {
        const item = await renderItem();
        const details = trackToggles(item);

        trigger(item).click();
        expect(details).toEqual([{ expanded: true }]);

        // The item does not change its own state; the parent accordion owns it.
        expect(item.expanded).toBe(false);

        item.expanded = true;
        trigger(item).click();
        expect(details).toEqual([{ expanded: true }, { expanded: false }]);
    });

    it.each([
        ["Enter", "{Enter}"],
        ["Space", "{ }"],
    ])("emits toggle-request when the trigger is activated with %s", async (_name, keys) => {
        const item = await renderItem();
        const details = trackToggles(item);

        item.focus();
        expect(item.shadowRoot?.activeElement).toBe(trigger(item));
        await userEvent.keyboard(keys);

        expect(details).toEqual([{ expanded: true }]);
    });

    it("does not emit toggle-request when disabled", async () => {
        const item = await renderItem(el => {
            el.disabled = true;
        });
        const details = trackToggles(item);

        expect(trigger(item).disabled).toBe(true);
        trigger(item).click();
        item.handleTriggerClick();

        expect(details).toEqual([]);
    });

    it("focusTrigger focuses the heading button", async () => {
        const item = await renderItem();

        item.focusTrigger();

        expect(item.shadowRoot?.activeElement).toBe(trigger(item));
    });

    it.each([
        ["1", 1],
        ["6", 6],
        ["0", 3],
        ["7", 3],
        ["abc", 3],
    ])("maps heading-level=%j to level %i", async (attribute, expected) => {
        const item = await renderItem(el => {
            el.setAttribute("heading-level", attribute);
        });
        const heading = item.shadowRoot?.querySelector(".heading") as HTMLElement;

        expect(item.headingLevel).toBe(expected);
        expect(heading.getAttribute("aria-level")).toBe(String(expected));
    });

    it("projects the heading and panel body slots", async () => {
        const item = await renderItem();
        const root = item.shadowRoot as ShadowRoot;
        const headingSlot = root.querySelector('slot[name="heading"]') as HTMLSlotElement;
        const bodySlot = root.querySelector("slot:not([name])") as HTMLSlotElement;

        expect(headingSlot.assignedElements()[0]?.textContent).toBe("Shipping");
        expect(bodySlot.assignedElements()[0]?.textContent).toBe("Ships in two days.");
    });
});
