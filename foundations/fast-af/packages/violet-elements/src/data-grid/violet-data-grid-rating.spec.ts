import { afterEach, describe, expect, it, vi } from "vitest";
import { Updates } from "@lushly-dev/fast-element";
import { userEvent } from "vitest/browser";

import "./violet-data-grid-rating";
import type { VioletDataGridRating } from "./violet-data-grid-rating";
import { normalizeRatingMax, parseRatingValue, serializeRatingValue } from "./violet-data-grid-rating-values";

async function renderRating(
    overrides: Partial<{
        rating: number | null;
        max: number;
        readonly: boolean;
        disabled: boolean;
    }> = {},
): Promise<VioletDataGridRating> {
    document.body.innerHTML = "";

    const element = document.createElement("violet-data-grid-rating") as VioletDataGridRating;
    element.max = overrides.max ?? 5;
    element.rating = overrides.rating === undefined ? 2 : overrides.rating;
    element.readonly = overrides.readonly ?? false;
    element.disabled = overrides.disabled ?? false;
    element.setAttribute("aria-label", "Quality rating");
    document.body.append(element);

    await customElements.whenDefined("violet-data-grid-rating");
    await Updates.next();

    return element;
}

describe("violet-data-grid-rating", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("emits input and change when a rating is selected", async () => {
        const element = await renderRating();
        const inputSpy = vi.fn();
        const changeSpy = vi.fn();

        element.addEventListener("input", inputSpy);
        element.addEventListener("change", changeSpy);

        element.selectRating(4);
        await Updates.next();

        expect(element.rating).toBe(4);
        expect(element.value).toBe("4");
        expect(inputSpy).toHaveBeenCalledTimes(1);
        expect(changeSpy).toHaveBeenCalledTimes(1);
    });

    it("clears the rating when the same star is clicked again", async () => {
        const element = await renderRating({
            rating: 3,
        });
        const star = element.shadowRoot?.querySelector<HTMLElement>('.star[data-index="3"]');

        if (!star) throw new Error("Expected a rendered star.");
        await userEvent.click(star);
        await Updates.next();

        expect(element.rating).toBeNull();
        expect(element.value).toBe("");
    });

    it("supports arrow keys, end, and delete on the control", async () => {
        const element = await renderRating({
            rating: 1,
        });
        const control = element.shadowRoot?.querySelector<HTMLElement>(".control");

        if (!control) throw new Error("Expected the rating control.");
        element.focus();
        expect(element.shadowRoot?.activeElement).toBe(control);

        await userEvent.keyboard("{ArrowRight}");
        await Updates.next();
        expect(element.rating).toBe(2);
        expect(control.getAttribute("aria-valuenow")).toBe("2");

        await userEvent.keyboard("{End}");
        await Updates.next();
        expect(element.rating).toBe(5);

        await userEvent.keyboard("{Delete}");
        await Updates.next();
        expect(element.rating).toBeNull();
        expect(control.getAttribute("aria-valuetext")).toBe("No rating, out of 5");
    });

    it("ignores selection changes in readonly mode", async () => {
        const element = await renderRating({
            rating: 4,
            readonly: true,
        });

        element.selectRating(2);
        await Updates.next();

        expect(element.rating).toBe(4);
        expect(element.shadowRoot?.querySelector(".control")?.getAttribute("role")).toBe("img");
        expect(element.shadowRoot?.querySelector(".control")?.getAttribute("aria-label")).toBe("Quality rating: 4 of 5");
        expect(element.shadowRoot?.querySelector("[tabindex]")).toBeNull();
    });

    it("honors readonly when it is provided as an attribute", async () => {
        document.body.innerHTML = "";

        const element = document.createElement("violet-data-grid-rating") as VioletDataGridRating;
        element.setAttribute("readonly", "");
        element.rating = 3;
        document.body.append(element);

        await customElements.whenDefined("violet-data-grid-rating");
        await Updates.next();

        expect(element.readonly).toBe(true);
        expect(element.shadowRoot?.querySelector(".control")?.getAttribute("role")).toBe("img");
    });

    it("preserves native Tab and Shift+Tab navigation and unhandled keys", async () => {
        const element = await renderRating();
        const before = document.createElement("button");
        const after = document.createElement("button");
        before.textContent = "Before rating";
        after.textContent = "After rating";
        document.body.prepend(before);
        document.body.append(after);
        element.focus();

        const control = element.shadowRoot?.querySelector<HTMLElement>(".control");
        if (!control) throw new Error("Expected the rating control.");
        const printable = new KeyboardEvent("keydown", {
            key: "a", bubbles: true, composed: true, cancelable: true,
        });
        control.dispatchEvent(printable);
        expect(printable.defaultPrevented).toBe(false);

        await userEvent.keyboard("{Tab}");
        expect(document.activeElement).toBe(after);
        element.focus();
        await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
        expect(document.activeElement).toBe(before);
        expect(element.rating).toBe(2);
    });

    it("updates readonly/disabled displays, labels, and scale reactively without emitting edits", async () => {
        const element = await renderRating({ rating: null });
        const changeSpy = vi.fn();
        element.addEventListener("change", changeSpy);
        expect(element.shadowRoot?.querySelector(".control")?.getAttribute("aria-valuenow")).toBe("0");

        element.readonly = true;
        element.rating = 4;
        element.setAttribute("aria-label", "Updated rating");
        await Updates.next();
        const display = element.shadowRoot?.querySelector<HTMLElement>(".control");
        expect(display?.getAttribute("role")).toBe("img");
        expect(display?.getAttribute("aria-label")).toBe("Updated rating: 4 of 5");
        expect(display?.hasAttribute("tabindex")).toBe(false);
        expect(element.shadowRoot?.querySelectorAll('.star[data-filled="true"]')).toHaveLength(4);
        expect(element.shadowRoot?.querySelectorAll('.star[aria-hidden="true"]')).toHaveLength(5);

        element.max = 3;
        await Updates.next();
        expect(element.rating).toBe(3);
        expect(display?.getAttribute("aria-label")).toBe("Updated rating: 3 of 3");
        expect(element.shadowRoot?.querySelectorAll(".star")).toHaveLength(3);

        element.readonly = false;
        element.disabled = true;
        await Updates.next();
        expect(element.shadowRoot?.querySelector(".control")?.getAttribute("aria-disabled")).toBe("true");
        element.selectRating(1);
        expect(element.rating).toBe(3);
        element.disabled = false;
        await Updates.next();
        expect(element.shadowRoot?.querySelector(".control")?.getAttribute("role")).toBe("slider");
        element.removeAttribute("aria-label");
        await Updates.next();
        expect(element.shadowRoot?.querySelector(".control")?.getAttribute("aria-label")).toBe("Rating");
        expect(changeSpy).not.toHaveBeenCalled();
    });

    it("reacts to readonly attribute removal and re-adding it", async () => {
        const element = await renderRating({ readonly: true });
        element.removeAttribute("readonly");
        await Updates.next();
        expect(element.shadowRoot?.querySelector(".control")?.getAttribute("role")).toBe("slider");
        element.setAttribute("readonly", "");
        await Updates.next();
        expect(element.shadowRoot?.querySelector(".control")?.getAttribute("role")).toBe("img");
    });
});

describe("rating values", () => {
    it("normalizes scales and preserves empty serialization", () => {
        expect(normalizeRatingMax(Number.NaN)).toBe(5);
        expect(normalizeRatingMax(12)).toBe(10);
        expect(normalizeRatingMax(0)).toBe(1);
        expect(parseRatingValue(" ")).toBeNull();
        expect(parseRatingValue("invalid")).toBeNull();
        expect(parseRatingValue(-1)).toBeNull();
        expect(parseRatingValue(8, 3)).toBe(3);
        expect(parseRatingValue(2.6)).toBe(3);
        expect(serializeRatingValue(null)).toBe("");
        expect(serializeRatingValue(8, 3)).toBe("3");
    });
});
