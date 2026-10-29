import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import "../option/violet-option";
import type { VioletOption } from "../option/violet-option";
import "../option-group/violet-option-group";
import "./violet-combobox";
import type { VioletCombobox } from "./violet-combobox";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function createOption(label: string, value: string, disabled = false): HTMLElement {
    const option = document.createElement("violet-option");
    option.setAttribute("value", value);
    option.textContent = label;
    if (disabled) {
        option.setAttribute("disabled", "");
    }
    return option;
}

async function renderCombobox(): Promise<VioletCombobox> {
    document.body.innerHTML = "";
    const combobox = document.createElement("violet-combobox") as VioletCombobox;
    combobox.label = "Seed source";
    combobox.append(
        createOption("Regional catalog", "regional"),
        createOption("Local co-op", "coop"),
        createOption("Greenhouse reserve", "reserve")
    );
    document.body.append(combobox);
    await customElements.whenDefined("violet-combobox");
    await nextFrame();
    return combobox;
}

function getInput(combobox: VioletCombobox): HTMLInputElement {
    const input = combobox.shadowRoot?.querySelector<HTMLInputElement>('input[role="combobox"]');
    if (!input) {
        throw new Error("Expected combobox input to render.");
    }
    return input;
}

function getPanel(combobox: VioletCombobox): HTMLElement {
    const panel = combobox.shadowRoot?.querySelector<HTMLElement>(".panel");
    if (!panel) {
        throw new Error("Expected combobox panel to render.");
    }
    return panel;
}

function getOption(combobox: VioletCombobox, value: string): VioletOption {
    const option = combobox.querySelector<VioletOption>(`violet-option[value="${value}"]`);
    if (!option) {
        throw new Error(`Expected option ${value} to exist.`);
    }
    return option;
}

/** Simulates the user typing into the native input (sets text and fires `input`). */
async function typeText(combobox: VioletCombobox, text: string): Promise<void> {
    const input = getInput(combobox);
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await nextFrame();
}

function pressKey(combobox: VioletCombobox, key: string): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true });
    getInput(combobox).dispatchEvent(event);
    return event;
}

async function renderForm(
    configure: (combobox: VioletCombobox) => void = () => undefined
): Promise<{ form: HTMLFormElement; combobox: VioletCombobox }> {
    document.body.innerHTML = "";
    const form = document.createElement("form");
    const combobox = document.createElement("violet-combobox") as VioletCombobox;
    combobox.name = "source";
    combobox.append(
        createOption("Regional catalog", "regional"),
        createOption("Local co-op", "coop"),
        createOption("Greenhouse reserve", "reserve")
    );
    configure(combobox);
    form.append(combobox);
    document.body.append(form);
    await customElements.whenDefined("violet-combobox");
    await nextFrame();
    return { form, combobox };
}

describe("violet-combobox", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("filters visible options from the current input text", async () => {
        const combobox = await renderCombobox();
        combobox.value = "coop";
        await nextFrame();

        expect(combobox.visibleOptions).toHaveLength(1);
        expect(combobox.visibleOptions[0]?.value).toBe("coop");
    });

    it("does not reflect typed or selected text into the value attribute", async () => {
        const combobox = await renderCombobox();
        const input = combobox.shadowRoot?.querySelector("input");
        if (!input) {
            throw new Error("Expected combobox input to render.");
        }

        input.value = "coo";
        input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        await nextFrame();
        expect(combobox.value).toBe("coo");
        expect(combobox.hasAttribute("value")).toBe(false);

        combobox.selectValue("reserve");
        await nextFrame();
        expect(combobox.hasAttribute("value")).toBe(false);
    });

    it("resets to the value attribute default after re-attaching", async () => {
        const combobox = await renderCombobox();
        combobox.setAttribute("value", "Local co-op");
        await nextFrame();
        combobox.remove();
        document.body.append(combobox);
        await nextFrame();

        combobox.selectValue("reserve");
        await nextFrame();
        combobox.formResetCallback();
        await nextFrame();

        expect(combobox.value).toBe("Local co-op");
        expect(combobox.getAttribute("value")).toBe("Local co-op");
    });

    it("commits the selected option label and value", async () => {
        const combobox = await renderCombobox();
        combobox.selectValue("reserve");
        await nextFrame();

        expect(combobox.selectedOptionValue).toBe("reserve");
        expect(combobox.value).toBe("Greenhouse reserve");
    });

    describe("rendering and ARIA", () => {
        it("renders a closed combobox input wired to its label and listbox", async () => {
            const combobox = await renderCombobox();
            const input = getInput(combobox);
            const listbox = combobox.shadowRoot?.querySelector('[role="listbox"]');

            expect(input.getAttribute("aria-expanded")).toBe("false");
            expect(input.getAttribute("aria-autocomplete")).toBe("list");
            expect(input.getAttribute("aria-controls")).toBe(listbox?.id);
            expect(input.getAttribute("aria-labelledby")).toBe(combobox.labelId);
            expect(combobox.shadowRoot?.getElementById(combobox.labelId)?.textContent?.trim()).toBe("Seed source");
            expect(getPanel(combobox).hasAttribute("hidden")).toBe(true);
            expect(combobox.options.every(option => option.getAttribute("role") === "option")).toBe(true);
        });

        it("opens on focus and reflects the open state in aria-expanded and the panel", async () => {
            const combobox = await renderCombobox();
            const input = getInput(combobox);

            input.focus();
            await nextFrame();

            expect(combobox.open).toBe(true);
            expect(input.getAttribute("aria-expanded")).toBe("true");
            expect(getPanel(combobox).hasAttribute("hidden")).toBe(false);
        });

        it("points aria-activedescendant at the active option only while open", async () => {
            const combobox = await renderCombobox();
            const input = getInput(combobox);

            combobox.show();
            await nextFrame();
            expect(combobox.activeValue).toBe("regional");
            expect(input.ariaActiveDescendantElement).toBe(getOption(combobox, "regional"));
            expect(combobox.activeOptionId).toBe(getOption(combobox, "regional").id);

            combobox.hide(true);
            await nextFrame();
            expect(input.ariaActiveDescendantElement).toBeNull();
        });

        it("marks only the selected option as aria-selected", async () => {
            const combobox = await renderCombobox();
            combobox.selectValue("coop");
            await nextFrame();

            expect(getOption(combobox, "coop").getAttribute("aria-selected")).toBe("true");
            expect(getOption(combobox, "regional").getAttribute("aria-selected")).toBe("false");
            expect(getOption(combobox, "reserve").getAttribute("aria-selected")).toBe("false");
        });

        it("exposes disabled options through aria-disabled", async () => {
            const combobox = await renderCombobox();
            const disabled = createOption("Retired seed", "retired", true);
            combobox.append(disabled);
            await nextFrame();

            expect(disabled.getAttribute("aria-disabled")).toBe("true");
            expect(getOption(combobox, "coop").getAttribute("aria-disabled")).toBe("false");
        });

        it("falls back to the placeholder and then a generic name for the listbox label", async () => {
            const combobox = await renderCombobox();
            const listbox = combobox.shadowRoot?.querySelector('[role="listbox"]');
            expect(listbox?.getAttribute("aria-label")).toBe("Seed source");

            combobox.label = "";
            combobox.placeholder = "Pick a source";
            await nextFrame();
            expect(listbox?.getAttribute("aria-label")).toBe("Pick a source");
            expect(getInput(combobox).hasAttribute("aria-labelledby")).toBe(false);

            combobox.placeholder = "";
            await nextFrame();
            expect(listbox?.getAttribute("aria-label")).toBe("Options");
        });

        it("links supporting and error text through aria-describedby", async () => {
            const combobox = await renderCombobox();
            combobox.supportingText = "Where the seed came from.";
            combobox.invalid = true;
            combobox.errorText = "Pick a known source.";
            await nextFrame();

            const input = getInput(combobox);
            expect(input.getAttribute("aria-describedby")).toBe(`${combobox.supportingId} ${combobox.errorId}`);
            expect(input.getAttribute("aria-invalid")).toBe("true");
            expect(combobox.shadowRoot?.getElementById(combobox.errorId)?.textContent?.trim()).toBe(
                "Pick a known source."
            );
        });
    });

    describe("filtering", () => {
        it("filters case-insensitively and ignores punctuation in labels", async () => {
            const combobox = await renderCombobox();

            await typeText(combobox, "LOCAL CO");
            expect(combobox.visibleOptions.map(option => option.value)).toEqual(["coop"]);

            await typeText(combobox, "co-op");
            expect(combobox.visibleOptions.map(option => option.value)).toEqual(["coop"]);
        });

        it("matches substrings anywhere in the label", async () => {
            const combobox = await renderCombobox();

            await typeText(combobox, "house");
            expect(combobox.visibleOptions.map(option => option.value)).toEqual(["reserve"]);
        });

        it("hides filtered-out options and restores them when the text is cleared", async () => {
            const combobox = await renderCombobox();

            await typeText(combobox, "reserve");
            expect(getOption(combobox, "reserve").hidden).toBe(false);
            expect(getOption(combobox, "regional").hidden).toBe(true);
            expect(getOption(combobox, "coop").hidden).toBe(true);

            await typeText(combobox, "");
            expect(combobox.options.every(option => !option.hidden)).toBe(true);
        });

        it("shows an empty state and has no active option when nothing matches", async () => {
            const combobox = await renderCombobox();

            await typeText(combobox, "zzz");

            expect(combobox.visibleOptions).toHaveLength(0);
            expect(combobox.activeValue).toBe("");
            expect(combobox.shadowRoot?.querySelector('[part="empty-state"]')?.textContent?.trim()).toBe(
                "No matching options"
            );
            expect(combobox.activeOptionId).toBe("");
            expect(getInput(combobox).ariaActiveDescendantElement).toBeNull();
        });

        it("does not select anything when Enter is pressed with no matches", async () => {
            const combobox = await renderCombobox();
            const handler = vi.fn();
            combobox.addEventListener("change", handler);

            await typeText(combobox, "zzz");
            pressKey(combobox, "Enter");

            expect(handler).not.toHaveBeenCalled();
            expect(combobox.selectedOptionValue).toBe("");
            expect(combobox.open).toBe(true);
        });

        it("resets the active option to the first match as the text changes", async () => {
            const combobox = await renderCombobox();

            await typeText(combobox, "re");
            expect(combobox.visibleOptions.map(option => option.value)).toEqual(["regional", "reserve"]);
            expect(combobox.activeValue).toBe("regional");

            await typeText(combobox, "res");
            expect(combobox.activeValue).toBe("reserve");
        });
    });

    describe("input events", () => {
        it("emits input with the typed text and opens the panel", async () => {
            const combobox = await renderCombobox();
            const handler = vi.fn();
            combobox.addEventListener("input", handler);

            await typeText(combobox, "coo");

            expect(combobox.open).toBe(true);
            expect(combobox.value).toBe("coo");
            const custom = handler.mock.calls
                .map(([event]) => event as CustomEvent)
                .find(event => event.detail && "selectedValue" in event.detail);
            expect(custom?.detail).toEqual({ value: "coo", selectedValue: "" });
        });

        it("clears the committed selection once the text no longer matches the selected label", async () => {
            const combobox = await renderCombobox();
            combobox.selectValue("coop");
            await nextFrame();
            expect(combobox.selectedOptionValue).toBe("coop");

            await typeText(combobox, "Local co-");
            expect(combobox.selectedOptionValue).toBe("");

            // Editing back to the same label (ignoring punctuation) keeps selection cleared until re-selected.
            await typeText(combobox, "Local co-op");
            expect(combobox.selectedOptionValue).toBe("");
        });

        it("keeps the selection while the text still equals the selected label", async () => {
            const combobox = await renderCombobox();
            combobox.selectValue("coop");
            await nextFrame();

            await typeText(combobox, "Local Co-Op");

            expect(combobox.selectedOptionValue).toBe("coop");
        });

        it("emits change from the native change event with the free-text payload", async () => {
            const combobox = await renderCombobox();
            const handler = vi.fn();
            combobox.addEventListener("change", handler);

            await typeText(combobox, "custom seed");
            getInput(combobox).dispatchEvent(new Event("change", { bubbles: true }));

            const event = handler.mock.calls.at(-1)?.[0] as CustomEvent;
            expect(event.detail).toEqual({ value: "custom seed", selectedValue: "" });
        });
    });

    describe("keyboard", () => {
        it("opens with ArrowDown and moves the active option forward", async () => {
            const combobox = await renderCombobox();

            const event = pressKey(combobox, "ArrowDown");
            await nextFrame();

            expect(event.defaultPrevented).toBe(true);
            expect(combobox.open).toBe(true);
            expect(combobox.activeValue).toBe("coop");
            expect(getOption(combobox, "coop").active).toBe(true);
            expect(getOption(combobox, "regional").active).toBe(false);
        });

        it("opens with ArrowUp and wraps to the last option", async () => {
            const combobox = await renderCombobox();

            pressKey(combobox, "ArrowUp");
            await nextFrame();

            expect(combobox.open).toBe(true);
            expect(combobox.activeValue).toBe("reserve");
        });

        it("skips disabled options and disabled groups when moving from the first option", async () => {
            const combobox = await renderCombobox();
            const group = document.createElement("violet-option-group");
            group.setAttribute("disabled", "");
            group.append(createOption("Group seed", "grouped"));
            combobox.insertBefore(createOption("Retired seed", "retired", true), getOption(combobox, "coop"));
            combobox.append(group);
            await nextFrame();

            pressKey(combobox, "ArrowDown");
            expect(combobox.activeValue).toBe("coop");
        });

        it("skips a trailing disabled group when wrapping upwards", async () => {
            const combobox = await renderCombobox();
            const group = document.createElement("violet-option-group");
            group.setAttribute("disabled", "");
            group.append(createOption("Group seed", "grouped"));
            combobox.append(createOption("Retired seed", "retired", true), group);
            await nextFrame();

            pressKey(combobox, "ArrowUp");

            expect(combobox.activeValue).toBe("reserve");
        });

        it("starts from the selected option when the panel is reopened", async () => {
            const combobox = await renderCombobox();
            combobox.selectValue("coop");
            await nextFrame();

            combobox.show();

            expect(combobox.activeValue).toBe("coop");
            expect(getOption(combobox, "coop").active).toBe(true);
        });

        it("moves the active option within the filtered options only", async () => {
            const combobox = await renderCombobox();
            await typeText(combobox, "re");
            expect(combobox.activeValue).toBe("regional");

            pressKey(combobox, "ArrowDown");

            expect(combobox.activeValue).toBe("reserve");
        });

        it("advances through every option on repeated ArrowDown and wraps", async () => {
            const combobox = await renderCombobox();
            pressKey(combobox, "ArrowDown");
            expect(combobox.activeValue).toBe("coop");
            pressKey(combobox, "ArrowDown");
            expect(combobox.activeValue).toBe("reserve");
            pressKey(combobox, "ArrowDown");
            expect(combobox.activeValue).toBe("regional");
        });

        it("moves backwards through every option on repeated ArrowUp", async () => {
            const combobox = await renderCombobox();
            pressKey(combobox, "ArrowUp");
            expect(combobox.activeValue).toBe("reserve");
            pressKey(combobox, "ArrowUp");
            expect(combobox.activeValue).toBe("coop");
        });

        it("selects the active option with Enter, emits change and closes", async () => {
            const combobox = await renderCombobox();
            const handler = vi.fn();
            combobox.addEventListener("change", handler);
            pressKey(combobox, "ArrowDown");

            const event = pressKey(combobox, "Enter");
            await nextFrame();

            expect(event.defaultPrevented).toBe(true);
            expect(combobox.open).toBe(false);
            expect(combobox.selectedOptionValue).toBe("coop");
            expect(combobox.value).toBe("Local co-op");
            expect(getInput(combobox).value).toBe("Local co-op");
            expect(handler).toHaveBeenCalledTimes(1);
            expect((handler.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
                value: "Local co-op",
                selectedValue: "coop",
                label: "Local co-op",
            });
        });

        it("selects the first match with Enter after filtering", async () => {
            const combobox = await renderCombobox();
            await typeText(combobox, "greenh");

            pressKey(combobox, "Enter");
            await nextFrame();

            expect(combobox.selectedOptionValue).toBe("reserve");
            expect(combobox.value).toBe("Greenhouse reserve");
            expect(combobox.open).toBe(false);
        });

        it("ignores Enter while the panel is closed", async () => {
            const combobox = await renderCombobox();
            const handler = vi.fn();
            combobox.addEventListener("change", handler);

            pressKey(combobox, "Enter");

            expect(handler).not.toHaveBeenCalled();
            expect(combobox.selectedOptionValue).toBe("");
        });

        it("closes with Escape and restores the selected label", async () => {
            const combobox = await renderCombobox();
            combobox.selectValue("reserve");
            await nextFrame();
            // Differs from the label only by case/punctuation, so the selection is kept while "editing".
            await typeText(combobox, "greenhouse-RESERVE");
            expect(combobox.open).toBe(true);
            expect(combobox.selectedOptionValue).toBe("reserve");

            const event = pressKey(combobox, "Escape");
            await nextFrame();

            expect(event.defaultPrevented).toBe(true);
            expect(combobox.open).toBe(false);
            expect(combobox.value).toBe("Greenhouse reserve");
            expect(getInput(combobox).getAttribute("aria-expanded")).toBe("false");
        });

        it("clears uncommitted free text on Escape and ignores Escape while closed", async () => {
            const combobox = await renderCombobox();
            await typeText(combobox, "mystery");

            pressKey(combobox, "Escape");
            expect(combobox.value).toBe("");
            expect(combobox.open).toBe(false);

            combobox.value = "kept";
            pressKey(combobox, "Escape");
            expect(combobox.value).toBe("kept");
        });

        it("does not move the active option or close the panel for Home, End, PageUp and PageDown", async () => {
            const combobox = await renderCombobox();
            combobox.show();
            const before = combobox.activeValue;

            for (const key of ["Home", "End", "PageUp", "PageDown"]) {
                pressKey(combobox, key);
            }

            expect(combobox.activeValue).toBe(before);
            expect(combobox.open).toBe(true);
        });

        it("lets a real keyboard type, filter and select with Enter", async () => {
            const combobox = await renderCombobox();
            const handler = vi.fn();
            combobox.addEventListener("change", handler);
            getInput(combobox).focus();

            await userEvent.keyboard("res");
            await vi.waitFor(() => expect(combobox.visibleOptions.map(option => option.value)).toEqual(["reserve"]));
            await userEvent.keyboard("{Enter}");

            await vi.waitFor(() => expect(combobox.selectedOptionValue).toBe("reserve"));
            expect(combobox.value).toBe("Greenhouse reserve");
            expect(combobox.open).toBe(false);
            expect(handler).toHaveBeenCalled();
        });

        it("closes the panel when Tab moves focus out of the combobox", async () => {
            const combobox = await renderCombobox();
            const after = document.createElement("button");
            document.body.append(after);
            getInput(combobox).focus();
            await vi.waitFor(() => expect(combobox.open).toBe(true));

            await userEvent.tab();

            await vi.waitFor(() => expect(document.activeElement).toBe(after));
            await vi.waitFor(() => expect(combobox.open).toBe(false));
        });
    });

    describe("selection", () => {
        it("selects an option when it is clicked", async () => {
            const combobox = await renderCombobox();
            const handler = vi.fn();
            combobox.addEventListener("change", handler);
            combobox.show();

            getOption(combobox, "coop").shadowRoot?.querySelector<HTMLElement>('[part="control"]')?.click();
            await nextFrame();

            expect(combobox.selectedOptionValue).toBe("coop");
            expect(combobox.value).toBe("Local co-op");
            expect(combobox.open).toBe(false);
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it("ignores clicks on disabled options", async () => {
            const combobox = await renderCombobox();
            const disabled = createOption("Retired seed", "retired", true);
            combobox.append(disabled);
            await nextFrame();
            const handler = vi.fn();
            combobox.addEventListener("change", handler);
            combobox.show();

            disabled.shadowRoot?.querySelector<HTMLElement>('[part="control"]')?.click();
            await nextFrame();

            expect(handler).not.toHaveBeenCalled();
            expect(combobox.selectedOptionValue).toBe("");
            expect(combobox.open).toBe(true);
        });

        it("refuses programmatic selection of disabled, grouped-disabled or unknown values", async () => {
            const combobox = await renderCombobox();
            const group = document.createElement("violet-option-group");
            group.setAttribute("disabled", "");
            group.append(createOption("Group seed", "grouped"));
            combobox.append(createOption("Retired seed", "retired", true), group);
            await nextFrame();
            const handler = vi.fn();
            combobox.addEventListener("change", handler);

            combobox.selectValue("retired");
            combobox.selectValue("grouped");
            combobox.selectValue("missing");

            expect(handler).not.toHaveBeenCalled();
            expect(combobox.selectedOptionValue).toBe("");
        });

        it("consumes request-select events so they do not leak to ancestors", async () => {
            const combobox = await renderCombobox();
            const leaked = vi.fn();
            document.body.addEventListener("request-select", leaked);

            getOption(combobox, "reserve").dispatchEvent(
                new CustomEvent("request-select", { detail: { value: "reserve" }, bubbles: true, composed: true })
            );
            await nextFrame();
            document.body.removeEventListener("request-select", leaked);

            expect(combobox.selectedOptionValue).toBe("reserve");
            expect(leaked).not.toHaveBeenCalled();
        });

        it("resolves an initial value attribute to the matching option and its label", async () => {
            document.body.innerHTML = "";
            const combobox = document.createElement("violet-combobox") as VioletCombobox;
            combobox.setAttribute("value", "reserve");
            combobox.append(createOption("Regional catalog", "regional"), createOption("Greenhouse reserve", "reserve"));
            document.body.append(combobox);
            await nextFrame();

            expect(combobox.selectedOptionValue).toBe("reserve");
            expect(combobox.value).toBe("Greenhouse reserve");
            expect(getOption(combobox, "reserve").selected).toBe(true);
        });

        it("resolves typed text that equals an option label on slot change", async () => {
            const combobox = await renderCombobox();
            combobox.value = "local coop";
            combobox.append(createOption("Extra seed", "extra"));
            await nextFrame();
            await nextFrame();

            expect(combobox.selectedOptionValue).toBe("coop");
            expect(combobox.value).toBe("Local co-op");
        });

        it("picks up options appended after first render", async () => {
            const combobox = await renderCombobox();
            combobox.append(createOption("Seed swap", "swap"));
            await nextFrame();
            await nextFrame();

            await typeText(combobox, "swap");
            expect(combobox.visibleOptions.map(option => option.value)).toEqual(["swap"]);
        });
    });

    describe("opening and closing", () => {
        it("closes and reverts when the user presses outside the combobox", async () => {
            const combobox = await renderCombobox();
            combobox.selectValue("coop");
            await nextFrame();
            await typeText(combobox, "LOCAL co op");
            expect(combobox.open).toBe(true);

            document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
            await nextFrame();

            expect(combobox.open).toBe(false);
            expect(combobox.value).toBe("Local co-op");
            expect(combobox.selectedOptionValue).toBe("coop");
        });

        it("discards unmatched free text when the user presses outside", async () => {
            const combobox = await renderCombobox();
            await typeText(combobox, "mystery");

            document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
            await nextFrame();

            expect(combobox.open).toBe(false);
            expect(combobox.value).toBe("");
        });

        it("stays open when the pointer goes down inside the combobox", async () => {
            const combobox = await renderCombobox();
            combobox.show();

            getInput(combobox).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
            await nextFrame();

            expect(combobox.open).toBe(true);
        });

        it("does not open when disabled", async () => {
            const combobox = await renderCombobox();
            combobox.disabled = true;
            await nextFrame();

            combobox.show();
            combobox.handleInputFocus();

            expect(combobox.open).toBe(false);
            expect(getInput(combobox).disabled).toBe(true);
        });

        it("positions the open panel beneath the control frame", async () => {
            const combobox = await renderCombobox();
            combobox.show();
            await nextFrame();
            await nextFrame();

            const panel = getPanel(combobox);
            const frame = combobox.shadowRoot?.querySelector(".control-frame")?.getBoundingClientRect();
            const panelRect = panel.getBoundingClientRect();
            expect(frame).toBeDefined();
            expect(panelRect.width).toBeGreaterThan(0);
            expect(panelRect.width).toBeLessThanOrEqual(window.innerWidth - 8);
            // The panel overlaps the frame border by 1px (gap = -1) and sits directly beneath it.
            // Anchor positioning and fractional layout (DPR, font metrics, Chromium build) can shift
            // the rounded edges by one device pixel, so allow +/-1px around the expected offset.
            // A real mispositioning (no overlap, a visible gap, or opening above) is >= 2px off.
            const expectedTop = (frame?.bottom ?? 0) - 1;
            expect(Math.abs(panelRect.top - expectedTop)).toBeLessThanOrEqual(1);
        });
    });

    describe("form participation", () => {
        it("is form associated and reports its form", async () => {
            const { form, combobox } = await renderForm();

            expect(combobox.form).toBe(form);
            expect(combobox.willValidate).toBe(true);
        });

        it("submits the selected option value under its name, not the label", async () => {
            const { form, combobox } = await renderForm();
            combobox.selectValue("coop");
            await nextFrame();

            expect(new FormData(form).get("source")).toBe("coop");
        });

        it("submits free text when no option is selected and nothing when empty", async () => {
            const { form, combobox } = await renderForm();
            expect(new FormData(form).has("source")).toBe(false);

            await typeText(combobox, "custom seed");

            expect(new FormData(form).get("source")).toBe("custom seed");
        });

        it("is valueMissing when required and empty, and valid once an option is chosen", async () => {
            const { combobox } = await renderForm(element => {
                element.required = true;
                element.errorText = "A source is needed.";
            });

            expect(combobox.checkValidity()).toBe(false);
            expect(combobox.validity.valueMissing).toBe(true);
            expect(combobox.validationMessage).toBe("A source is needed.");
            expect(combobox.shadowRoot?.getElementById(combobox.errorId)?.textContent?.trim()).toBe(
                "A source is needed."
            );

            combobox.selectValue("reserve");
            await nextFrame();

            expect(combobox.checkValidity()).toBe(true);
            expect(combobox.validity.valid).toBe(true);
        });

        it("treats whitespace-only text as missing when required", async () => {
            const { combobox } = await renderForm(element => {
                element.required = true;
            });

            await typeText(combobox, "   ");

            expect(combobox.validity.valueMissing).toBe(true);
            expect(combobox.validationMessage).toBe("Please choose an option.");
        });

        it("raises a custom error when invalid is set", async () => {
            const { combobox } = await renderForm();
            combobox.invalid = true;
            combobox.errorText = "Unknown source.";
            await nextFrame();

            expect(combobox.validity.customError).toBe(true);
            expect(combobox.validationMessage).toBe("Unknown source.");
            expect(combobox.checkValidity()).toBe(false);

            combobox.invalid = false;
            await nextFrame();
            expect(combobox.checkValidity()).toBe(true);
        });

        it("blocks form submission validity while required is unmet", async () => {
            const { form, combobox } = await renderForm(element => {
                element.required = true;
            });

            expect(form.checkValidity()).toBe(false);
            combobox.selectValue("regional");
            await nextFrame();
            expect(form.checkValidity()).toBe(true);
        });

        it("omits its value and validity when disabled directly", async () => {
            const { form, combobox } = await renderForm(element => {
                element.required = true;
            });
            combobox.selectValue("coop");
            await nextFrame();
            expect(new FormData(form).get("source")).toBe("coop");

            combobox.disabled = true;
            await nextFrame();

            expect(new FormData(form).has("source")).toBe(false);
            expect(combobox.checkValidity()).toBe(true);
            expect(combobox.shadowRoot?.querySelector(".error")).toBeNull();
        });

        it("restores the initial value on form reset", async () => {
            const { form, combobox } = await renderForm(element => {
                element.setAttribute("value", "regional");
            });
            expect(combobox.selectedOptionValue).toBe("regional");

            combobox.selectValue("reserve");
            await nextFrame();
            expect(new FormData(form).get("source")).toBe("reserve");

            form.reset();
            await nextFrame();

            expect(combobox.selectedOptionValue).toBe("regional");
            expect(combobox.value).toBe("Regional catalog");
            expect(combobox.open).toBe(false);
            expect(new FormData(form).get("source")).toBe("regional");
            expect(getOption(combobox, "reserve").selected).toBe(false);
        });

        it("clears everything on form reset when there was no initial value", async () => {
            const { form, combobox } = await renderForm();
            combobox.selectValue("coop");
            await nextFrame();

            form.reset();
            await nextFrame();

            expect(combobox.value).toBe("");
            expect(combobox.selectedOptionValue).toBe("");
            expect(new FormData(form).has("source")).toBe(false);
            expect(combobox.options.every(option => !option.selected)).toBe(true);
        });
    });

    describe("native key handling", () => {
        it("does not cancel typing, Tab, Home or End", async () => {
            const combobox = await renderCombobox();

            for (const key of ["a", "Tab", "Home", "End", "Backspace"]) {
                expect(pressKey(combobox, key).defaultPrevented, key).toBe(false);
            }
        });

        it("does not cancel Enter or Escape while closed", async () => {
            const combobox = await renderCombobox();
            combobox.hide(false);

            expect(pressKey(combobox, "Enter").defaultPrevented).toBe(false);
            expect(pressKey(combobox, "Escape").defaultPrevented).toBe(false);
        });

        it("still cancels the keys it handles", async () => {
            const combobox = await renderCombobox();

            expect(pressKey(combobox, "ArrowDown").defaultPrevented).toBe(true);
            expect(pressKey(combobox, "ArrowUp").defaultPrevented).toBe(true);
        });

        it("lets Tab move focus out of the input", async () => {
            const combobox = await renderCombobox();
            const after = document.createElement("button");
            document.body.append(after);
            getInput(combobox).focus();

            await userEvent.tab();

            await vi.waitFor(() => expect(document.activeElement).toBe(after));
        });
    });
});
