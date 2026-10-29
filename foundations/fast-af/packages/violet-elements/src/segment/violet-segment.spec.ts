import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-segment";
import type { VioletSegment } from "./violet-segment";

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        requestAnimationFrame(() => resolve());
    });
}

async function renderSegment(
    label = "Day",
    configure?: (segment: VioletSegment) => void
): Promise<VioletSegment> {
    document.body.innerHTML = "";

    const segment = document.createElement("violet-segment") as VioletSegment;
    segment.textContent = label;
    segment.value = "day";
    configure?.(segment);
    document.body.append(segment);

    await customElements.whenDefined("violet-segment");
    await nextFrame();

    return segment;
}

function button(segment: VioletSegment): HTMLButtonElement {
    const native = segment.shadowRoot?.querySelector(".button") as HTMLButtonElement | null;
    if (!native) {
        throw new Error("violet-segment did not render its button");
    }
    return native;
}

function trackSelectRequests(segment: VioletSegment): Array<{ value: string }> {
    const details: Array<{ value: string }> = [];
    segment.addEventListener("select-request", event => {
        details.push((event as CustomEvent<{ value: string }>).detail);
    });
    return details;
}

describe("violet-segment", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders a radio-role button with defaults", async () => {
        const segment = await renderSegment();

        expect(segment.checked).toBe(false);
        expect(segment.disabled).toBe(false);
        expect(button(segment).getAttribute("role")).toBe("radio");
        expect(button(segment).getAttribute("type")).toBe("button");
        expect(button(segment).getAttribute("aria-checked")).toBe("false");
        expect(button(segment).disabled).toBe(false);
    });

    it("maps attributes to properties and the inner button", async () => {
        const segment = await renderSegment("Week", el => {
            el.setAttribute("value", "week");
            el.setAttribute("checked", "");
            el.setAttribute("disabled", "");
        });

        expect(segment.value).toBe("week");
        expect(segment.checked).toBe(true);
        expect(segment.disabled).toBe(true);
        expect(button(segment).getAttribute("aria-checked")).toBe("true");
        expect(button(segment).disabled).toBe(true);
    });

    it("reflects checked changes to the attribute and aria-checked", async () => {
        const segment = await renderSegment();

        segment.setCheckedFromGroup(true);
        await nextFrame();

        expect(segment.checked).toBe(true);
        expect(segment.hasAttribute("checked")).toBe(true);
        expect(button(segment).getAttribute("aria-checked")).toBe("true");

        segment.setCheckedFromGroup(false);
        await nextFrame();

        expect(segment.hasAttribute("checked")).toBe(false);
        expect(button(segment).getAttribute("aria-checked")).toBe("false");
    });

    it("emits select-request with its value when clicked", async () => {
        const segment = await renderSegment();
        const details = trackSelectRequests(segment);

        button(segment).click();

        expect(details).toEqual([{ value: "day" }]);
    });

    it.each([
        ["Enter", "{Enter}"],
        ["Space", "{ }"],
    ])("emits select-request when activated with %s", async (_name, keys) => {
        const segment = await renderSegment();
        const details = trackSelectRequests(segment);

        segment.focus();
        await userEvent.keyboard(keys);

        expect(details).toEqual([{ value: "day" }]);
    });

    it("does not request selection when already checked", async () => {
        const segment = await renderSegment("Day", el => {
            el.checked = true;
        });
        const details = trackSelectRequests(segment);

        button(segment).click();

        expect(details).toEqual([]);
    });

    it("does not request selection when disabled", async () => {
        const segment = await renderSegment("Day", el => {
            el.disabled = true;
        });
        const details = trackSelectRequests(segment);

        button(segment).click();
        segment.handleClick();

        expect(details).toEqual([]);
    });

    it("is effectively disabled from its group and exposes aria-disabled on the host", async () => {
        const segment = await renderSegment();
        const details = trackSelectRequests(segment);

        segment.setGroupDisabled(true);
        await nextFrame();

        expect(segment.disabled).toBe(false);
        expect(segment.effectiveDisabled).toBe(true);
        expect(segment.getAttribute("aria-disabled")).toBe("true");

        segment.handleClick();
        expect(details).toEqual([]);

        segment.setGroupDisabled(false);
        await nextFrame();

        expect(segment.effectiveDisabled).toBe(false);
        expect(segment.hasAttribute("aria-disabled")).toBe(false);

        segment.handleClick();
        expect(details).toEqual([{ value: "day" }]);
    });

    it("delegates focus to the inner button and focusButton focuses it", async () => {
        const segment = await renderSegment();

        segment.focus();
        expect(document.activeElement).toBe(segment);
        expect(segment.shadowRoot?.activeElement).toBe(button(segment));

        (document.activeElement as HTMLElement).blur();
        expect(segment.shadowRoot?.activeElement).toBeNull();

        segment.focusButton();
        expect(segment.shadowRoot?.activeElement).toBe(button(segment));
    });

    it("is a Tab stop on its own and lets a group remove it from the tab order", async () => {
        const segment = await renderSegment();
        expect(button(segment).getAttribute("tabindex")).toBe("0");

        segment.setManagedTabIndex(-1);
        await nextFrame();
        expect(button(segment).getAttribute("tabindex")).toBe("-1");

        segment.setManagedTabIndex(null);
        await nextFrame();
        expect(button(segment).getAttribute("tabindex")).toBe("0");
    });

    it("projects its label into the default slot", async () => {
        const segment = await renderSegment("Month");
        const slot = segment.shadowRoot?.querySelector("slot") as HTMLSlotElement;

        expect(slot.assignedNodes()[0]?.textContent).toBe("Month");
    });
});
