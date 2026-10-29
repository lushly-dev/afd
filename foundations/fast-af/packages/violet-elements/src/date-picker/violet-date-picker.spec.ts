import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import type { VioletCalendar } from "../calendar/violet-calendar";
import "./violet-date-picker";
import type { VioletDatePicker } from "./violet-date-picker";

function nextFrame(): Promise<void> {
    // FAST flushes template updates in its own animation-frame batch; wait two frames so the DOM has settled.
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function renderDatePicker(
    configure: (picker: VioletDatePicker) => void = () => undefined
): Promise<VioletDatePicker> {
    document.body.innerHTML = "";
    const picker = document.createElement("violet-date-picker") as VioletDatePicker;
    picker.label = "Planting date";
    picker.supportingText = "Choose when this plan should begin.";
    picker.value = "2026-03-23";
    picker.min = "2026-03-01";
    picker.max = "2026-04-15";
    configure(picker);
    document.body.append(picker);
    await customElements.whenDefined("violet-date-picker");
    await nextFrame();
    return picker;
}

async function renderInForm(
    configure: (picker: VioletDatePicker) => void = () => undefined
): Promise<{ form: HTMLFormElement; picker: VioletDatePicker }> {
    document.body.innerHTML = "";
    const form = document.createElement("form");
    const picker = document.createElement("violet-date-picker") as VioletDatePicker;
    picker.name = "planting";
    configure(picker);
    form.append(picker);
    document.body.append(form);
    await customElements.whenDefined("violet-date-picker");
    await nextFrame();
    return { form, picker };
}

function getInput(picker: VioletDatePicker): HTMLInputElement {
    const input = picker.shadowRoot?.querySelector<HTMLInputElement>('input[type="date"]');
    if (!input) {
        throw new Error("Expected the native date input to render.");
    }
    return input;
}

function getToggle(picker: VioletDatePicker): HTMLButtonElement {
    const toggle = picker.shadowRoot?.querySelector<HTMLButtonElement>(".toggle");
    if (!toggle) {
        throw new Error("Expected the toggle button to render.");
    }
    return toggle;
}

function getPanel(picker: VioletDatePicker): HTMLElement {
    const panel = picker.shadowRoot?.querySelector<HTMLElement>(".panel");
    if (!panel) {
        throw new Error("Expected the panel to render.");
    }
    return panel;
}

function getCalendar(picker: VioletDatePicker): VioletCalendar {
    const calendar = picker.shadowRoot?.querySelector<VioletCalendar>("violet-calendar");
    if (!calendar) {
        throw new Error("Expected the calendar to render.");
    }
    return calendar;
}

function calendarDay(picker: VioletDatePicker, iso: string): HTMLButtonElement {
    const button = getCalendar(picker).shadowRoot?.querySelector<HTMLButtonElement>(`button[data-date="${iso}"]`);
    if (!button) {
        throw new Error(`Expected calendar day ${iso} to render.`);
    }
    return button;
}

function inputKeydown(picker: VioletDatePicker, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true, ...init });
    getInput(picker).dispatchEvent(event);
    return event;
}

describe("violet-date-picker", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("syncs its native date input from the value property", async () => {
        const picker = await renderDatePicker();
        const input = picker.shadowRoot?.querySelector('input[type="date"]') as HTMLInputElement | null;

        expect(input?.value).toBe("2026-03-23");
    });

    it("updates from native input events", async () => {
        const picker = await renderDatePicker();
        const input = picker.shadowRoot?.querySelector('input[type="date"]') as HTMLInputElement | null;

        input!.value = "2026-03-24";
        input?.dispatchEvent(new Event("input", { bubbles: true }));
        input?.dispatchEvent(new Event("change", { bubbles: true }));
        await nextFrame();

        expect(picker.value).toBe("2026-03-24");
    });

    it("commits calendar selection and closes the popup", async () => {
        const picker = await renderDatePicker();

        picker.show();
        picker.handleCalendarChange(
            new CustomEvent("change", {
                detail: { value: "2026-03-30" },
                bubbles: true,
            }),
        );
        await nextFrame();

        expect(picker.value).toBe("2026-03-30");
        expect(picker.open).toBe(false);
    });

    describe("rendering and ARIA", () => {
        it("labels the native input and passes min and max through", async () => {
            const picker = await renderDatePicker();
            const input = getInput(picker);
            const label = picker.shadowRoot?.querySelector("label");

            expect(label?.textContent?.trim()).toBe("Planting date");
            expect(label?.getAttribute("for")).toBe(input.id);
            expect(input.min).toBe("2026-03-01");
            expect(input.max).toBe("2026-04-15");
        });

        it("links supporting and error text through aria-describedby and aria-invalid", async () => {
            const picker = await renderDatePicker();
            expect(getInput(picker).getAttribute("aria-describedby")).toBe(picker.supportingId);
            expect(getInput(picker).getAttribute("aria-invalid")).toBe("false");

            const invalid = await renderDatePicker(element => {
                element.errorText = "Pick a Monday.";
                element.invalid = true;
            });
            const input = getInput(invalid);
            expect(input.getAttribute("aria-invalid")).toBe("true");
            expect(input.getAttribute("aria-describedby")).toBe(`${invalid.supportingId} ${invalid.errorId}`);
            expect(invalid.shadowRoot?.getElementById(invalid.errorId)?.textContent?.trim()).toBe("Pick a Monday.");
        });

        it("wires the toggle button to the popup panel", async () => {
            const picker = await renderDatePicker();
            const toggle = getToggle(picker);

            expect(toggle.getAttribute("aria-haspopup")).toBe("dialog");
            expect(toggle.getAttribute("aria-expanded")).toBe("false");
            expect(toggle.getAttribute("aria-controls")).toBe(picker.panelId);
            expect(getPanel(picker).id).toBe(picker.panelId);
            expect(getPanel(picker).hidden).toBe(true);
        });

        it("changes the toggle label depending on whether a date is chosen", async () => {
            const picker = await renderDatePicker();
            expect(getToggle(picker).getAttribute("aria-label")).toBe("Change date");

            picker.value = "";
            await nextFrame();
            expect(getToggle(picker).getAttribute("aria-label")).toBe("Choose date");
        });

        it("hands value, min, max and locale to the calendar in single mode", async () => {
            const picker = await renderDatePicker(element => {
                element.locale = "de-DE";
            });
            const calendar = getCalendar(picker);

            expect(calendar.getAttribute("selection-mode")).toBe("single");
            expect(calendar.value).toBe("2026-03-23");
            expect(calendar.min).toBe("2026-03-01");
            expect(calendar.max).toBe("2026-04-15");
            expect(calendar.locale).toBe("de-DE");
        });

        it("formats a locale-aware display value", async () => {
            const picker = await renderDatePicker();
            expect(picker.displayValue).toBe("Mar 23, 2026");

            picker.locale = "de-DE";
            expect(picker.displayValue).toBe("23.03.2026");

            picker.value = "";
            expect(picker.displayValue).toBe("");
        });
    });

    describe("popup", () => {
        it("opens and closes, updating aria-expanded, the panel and emitting open-change", async () => {
            const picker = await renderDatePicker();
            const handler = vi.fn();
            picker.addEventListener("open-change", handler);

            picker.show();
            await nextFrame();
            expect(picker.open).toBe(true);
            expect(getPanel(picker).hidden).toBe(false);
            expect(getToggle(picker).getAttribute("aria-expanded")).toBe("true");
            expect(picker.shadowRoot?.querySelector(".control-shell")?.classList.contains("open")).toBe(true);

            picker.hide();
            await nextFrame();
            expect(picker.open).toBe(false);
            expect(getPanel(picker).hidden).toBe(true);
            expect(getToggle(picker).getAttribute("aria-expanded")).toBe("false");

            expect(handler.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
                { open: true },
                { open: false },
            ]);
        });

        it("toggles from the calendar button", async () => {
            const picker = await renderDatePicker();

            getToggle(picker).click();
            await nextFrame();
            expect(picker.open).toBe(true);

            getToggle(picker).click();
            await nextFrame();
            expect(picker.open).toBe(false);
        });

        it("moves focus to the tabbable calendar day when opened", async () => {
            const picker = await renderDatePicker();

            picker.show();

            await vi.waitFor(() => {
                expect(getCalendar(picker).shadowRoot?.activeElement?.getAttribute("data-date")).toBe("2026-03-23");
            });
        });

        it("opens with ArrowDown and closes with Escape from the input", async () => {
            const picker = await renderDatePicker();

            expect(inputKeydown(picker, "ArrowDown").defaultPrevented).toBe(true);
            await nextFrame();
            expect(picker.open).toBe(true);

            expect(inputKeydown(picker, "Escape").defaultPrevented).toBe(true);
            await nextFrame();
            expect(picker.open).toBe(false);
        });

        it("ignores Escape while closed", async () => {
            const picker = await renderDatePicker();
            const handler = vi.fn();
            picker.addEventListener("open-change", handler);

            inputKeydown(picker, "Escape");
            await nextFrame();

            expect(picker.open).toBe(false);
            expect(handler).not.toHaveBeenCalled();
        });

        it("closes with Escape from calendar focus and returns focus to the input", async () => {
            const picker = await renderDatePicker();
            const outer = vi.fn();
            document.body.addEventListener("keydown", outer);

            picker.show();
            await vi.waitFor(() => {
                expect(getCalendar(picker).shadowRoot?.activeElement?.getAttribute("data-date")).toBe("2026-03-23");
            });

            await userEvent.keyboard("{Escape}");
            await nextFrame();

            expect(picker.open).toBe(false);
            expect(picker.value).toBe("2026-03-23");
            expect(picker.shadowRoot?.activeElement).toBe(getInput(picker));
            // A handled Escape must not reach an enclosing dialog.
            expect(outer.mock.calls.some(([e]) => (e as KeyboardEvent).key === "Escape")).toBe(false);
            document.body.removeEventListener("keydown", outer);
        });

        it("lets Escape propagate when the popup is closed", async () => {
            const picker = await renderDatePicker();
            const outer = vi.fn();
            document.body.addEventListener("keydown", outer);

            const panel = getPanel(picker);
            const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true, cancelable: true });
            panel.dispatchEvent(event);

            expect(event.defaultPrevented).toBe(false);
            expect(outer).toHaveBeenCalledTimes(1);
            document.body.removeEventListener("keydown", outer);
        });

        it("does not open when disabled", async () => {
            const picker = await renderDatePicker(element => {
                element.disabled = true;
            });

            picker.show();
            picker.toggleOpen();
            inputKeydown(picker, "ArrowDown");
            await nextFrame();

            expect(picker.open).toBe(false);
            expect(getInput(picker).disabled).toBe(true);
            expect(getToggle(picker).disabled).toBe(true);
        });

        it("closes when the pointer goes down outside and stays open for presses inside", async () => {
            const picker = await renderDatePicker();
            picker.show();
            await nextFrame();

            getInput(picker).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
            expect(picker.open).toBe(true);

            document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
            expect(picker.open).toBe(false);
        });

        it("stops reacting to outside presses once removed from the document", async () => {
            const picker = await renderDatePicker();
            picker.show();
            picker.remove();

            document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));

            expect(picker.open).toBe(true);
        });

        it("positions the panel next to the control frame", async () => {
            const picker = await renderDatePicker();
            picker.show();
            await nextFrame();

            const frame = picker.shadowRoot?.querySelector(".control-frame")?.getBoundingClientRect();
            expect(Number.parseFloat(getPanel(picker).style.inlineSize)).toBeGreaterThanOrEqual(
                Math.max(frame?.width ?? 0, 280)
            );
            expect(getPanel(picker).style.top).not.toBe("");
            expect(getPanel(picker).style.left).not.toBe("");
        });
    });

    describe("selection", () => {
        it("selects a day clicked in the calendar, closes and returns focus to the input", async () => {
            const picker = await renderDatePicker();
            picker.show();
            await nextFrame();

            calendarDay(picker, "2026-03-25").click();
            await nextFrame();

            expect(picker.value).toBe("2026-03-25");
            expect(getInput(picker).value).toBe("2026-03-25");
            expect(picker.open).toBe(false);
            expect(picker.shadowRoot?.activeElement).toBe(getInput(picker));
        });

        it("emits exactly one change with the chosen value and swallows the calendar change event", async () => {
            const picker = await renderDatePicker();
            const input = vi.fn();
            const change = vi.fn();
            picker.addEventListener("input", input);
            picker.addEventListener("change", change);
            picker.show();
            await nextFrame();

            calendarDay(picker, "2026-03-25").click();
            await nextFrame();

            expect(change).toHaveBeenCalledTimes(1);
            expect((change.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ value: "2026-03-25" });
            const inputDetails = input.mock.calls.map(([event]) => (event as CustomEvent).detail);
            expect(inputDetails).toContainEqual({ value: "2026-03-25" });
        });

        it("emits exactly one input event when a calendar day is chosen", async () => {
            const picker = await renderDatePicker();
            const input = vi.fn();
            picker.addEventListener("input", input);
            picker.show();
            await nextFrame();

            calendarDay(picker, "2026-03-25").click();
            await nextFrame();

            expect(input).toHaveBeenCalledTimes(1);
        });

        it("disables calendar days outside min and max", async () => {
            const picker = await renderDatePicker(element => {
                element.min = "2026-03-10";
                element.max = "2026-03-20";
            });
            picker.show();
            await nextFrame();

            expect(calendarDay(picker, "2026-03-10").disabled).toBe(false);
            expect(calendarDay(picker, "2026-03-20").disabled).toBe(false);
            expect(calendarDay(picker, "2026-03-09").disabled).toBe(true);
            expect(calendarDay(picker, "2026-03-21").disabled).toBe(true);
        });

        it("does not commit a day outside min and max clicked in the calendar", async () => {
            const picker = await renderDatePicker(element => {
                element.min = "2026-03-10";
                element.max = "2026-03-20";
            });
            const handler = vi.fn();
            picker.addEventListener("change", handler);
            picker.show();
            await nextFrame();

            calendarDay(picker, "2026-03-25").click();
            await nextFrame();

            expect(picker.value).toBe("2026-03-23");
            expect(handler).not.toHaveBeenCalled();
            expect(picker.open).toBe(true);
        });

        it("ignores calendar changes without a value", async () => {
            const picker = await renderDatePicker();
            const handler = vi.fn();
            picker.addEventListener("change", handler);
            picker.show();

            picker.handleCalendarChange(new CustomEvent("change", { detail: {}, bubbles: true }));

            expect(picker.value).toBe("2026-03-23");
            expect(picker.open).toBe(true);
            expect(handler).not.toHaveBeenCalled();
        });

        it("emits input then change with the typed value from the native input", async () => {
            const picker = await renderDatePicker();
            const input = vi.fn();
            const change = vi.fn();
            picker.addEventListener("input", input);
            picker.addEventListener("change", change);
            const native = getInput(picker);

            native.value = "2026-04-02";
            native.dispatchEvent(new Event("input", { bubbles: true }));
            native.dispatchEvent(new Event("change", { bubbles: true }));

            const details = (mock: ReturnType<typeof vi.fn>) =>
                mock.mock.calls.map(([event]) => (event as CustomEvent).detail).filter(Boolean);
            expect(details(input)).toEqual([{ value: "2026-04-02" }]);
            expect(details(change)).toEqual([{ value: "2026-04-02" }]);
        });

        it("clears the value when the native input is emptied", async () => {
            const picker = await renderDatePicker();
            const native = getInput(picker);

            native.value = "";
            native.dispatchEvent(new Event("input", { bubbles: true }));
            native.dispatchEvent(new Event("change", { bubbles: true }));

            await nextFrame();

            expect(picker.value).toBe("");
            expect(getToggle(picker).getAttribute("aria-label")).toBe("Choose date");
        });

        it("pushes programmatic value changes back into the native input", async () => {
            const picker = await renderDatePicker();

            picker.value = "2026-04-10";
            expect(getInput(picker).value).toBe("2026-04-10");

            picker.value = "";
            expect(getInput(picker).value).toBe("");
        });

        it("lets a real keyboard type a date into the native input", async () => {
            const picker = await renderDatePicker(element => {
                element.value = "";
                element.min = "";
                element.max = "";
                element.locale = "en-US";
            });
            getInput(picker).focus();

            await userEvent.keyboard("04152026");

            await vi.waitFor(() => expect(picker.value).toBe("2026-04-15"));
        });
    });

    describe("form participation", () => {
        it("is form associated and reports its form", async () => {
            const { form, picker } = await renderInForm();

            expect(picker.form).toBe(form);
            expect(picker.willValidate).toBe(true);
        });

        it("submits its value under its name and omits it when empty", async () => {
            const { form, picker } = await renderInForm();
            expect(new FormData(form).has("planting")).toBe(false);

            picker.value = "2026-03-23";

            expect(new FormData(form).get("planting")).toBe("2026-03-23");

            picker.value = "";
            expect(new FormData(form).has("planting")).toBe(false);
        });

        it("submits a value chosen in the calendar", async () => {
            const { form, picker } = await renderInForm();
            picker.show();
            await nextFrame();
            const calendar = getCalendar(picker);
            const today = new Date();
            const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-15`;

            calendar.shadowRoot?.querySelector<HTMLButtonElement>(`button[data-date="${iso}"]`)?.click();
            await nextFrame();

            expect(new FormData(form).get("planting")).toBe(iso);
        });

        it("is valueMissing when required and empty, then valid once a date is set", async () => {
            const { form, picker } = await renderInForm(element => {
                element.required = true;
            });

            expect(picker.validity.valueMissing).toBe(true);
            expect(picker.validationMessage).toBe("Please choose a date.");
            expect(picker.checkValidity()).toBe(false);
            expect(form.checkValidity()).toBe(false);

            picker.value = "2026-03-23";

            expect(picker.validity.valid).toBe(true);
            expect(picker.checkValidity()).toBe(true);
            expect(form.checkValidity()).toBe(true);
        });

        it("raises a custom error with the supplied error text when invalid", async () => {
            const { picker } = await renderInForm(element => {
                element.value = "2026-03-23";
                element.invalid = true;
                element.errorText = "Not a planting day.";
            });

            expect(picker.validity.customError).toBe(true);
            expect(picker.validationMessage).toBe("Not a planting day.");
            expect(picker.checkValidity()).toBe(false);

            picker.invalid = false;
            expect(picker.validity.customError).toBe(false);
        });

        it("refreshes the validation message when error text changes after invalid is set", async () => {
            const { picker } = await renderInForm(element => {
                element.invalid = true;
            });

            picker.errorText = "Not a planting day.";

            expect(picker.validationMessage).toBe("Not a planting day.");
        });

        it("falls back to a default message for invalid without error text", async () => {
            const { picker } = await renderInForm(element => {
                element.invalid = true;
            });

            expect(picker.validationMessage).toBe("Select a valid date.");
        });

        it("reports badInput for a value that is not a real calendar date", async () => {
            const { picker } = await renderInForm();

            picker.value = "2026-02-31";

            expect(picker.validity.badInput).toBe(true);
            expect(picker.validationMessage).toBe("Enter a valid date.");

            picker.value = "2026-02-28";
            expect(picker.validity.valid).toBe(true);
        });

        it("reports rangeUnderflow and rangeOverflow for values outside min and max", async () => {
            const { picker } = await renderInForm(element => {
                element.min = "2026-03-01";
                element.max = "2026-04-15";
            });

            picker.value = "2026-02-01";
            expect(picker.validity.rangeUnderflow).toBe(true);

            picker.value = "2026-05-01";
            expect(picker.validity.rangeOverflow).toBe(true);
        });

        it("restores the initial value on form reset", async () => {
            const { form, picker } = await renderInForm(element => {
                element.value = "2026-03-23";
            });
            picker.value = "2026-04-02";
            expect(new FormData(form).get("planting")).toBe("2026-04-02");

            form.reset();
            await nextFrame();

            expect(picker.value).toBe("2026-03-23");
            expect(getInput(picker).value).toBe("2026-03-23");
            expect(new FormData(form).get("planting")).toBe("2026-03-23");
        });

        it("clears to empty on form reset when it started empty", async () => {
            const { form, picker } = await renderInForm();
            picker.value = "2026-04-02";

            form.reset();
            await nextFrame();

            expect(picker.value).toBe("");
            expect(new FormData(form).has("planting")).toBe(false);
        });
    });

    describe("native key handling", () => {
        it("does not cancel typing, Tab or arrow keys inside the native input", async () => {
            const picker = await renderDatePicker();

            for (const key of ["1", "Tab", "ArrowLeft", "ArrowRight", "Backspace"]) {
                expect(inputKeydown(picker, key).defaultPrevented, key).toBe(false);
            }
        });

        it("does not cancel Escape while closed", async () => {
            const picker = await renderDatePicker();

            expect(inputKeydown(picker, "Escape").defaultPrevented).toBe(false);
        });

        it("still cancels ArrowDown and opens the panel", async () => {
            const picker = await renderDatePicker();

            expect(inputKeydown(picker, "ArrowDown").defaultPrevented).toBe(true);
            expect(picker.open).toBe(true);
        });
    });
});
