import { afterEach, describe, expect, it, vi } from "vitest";

import "./violet-time-picker";
import type { VioletTimePicker } from "./violet-time-picker";

function nextFrame(): Promise<void> {
    // FAST flushes template updates in its own animation-frame batch; wait two frames so the DOM has settled.
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function renderTimePicker(
    configure: (picker: VioletTimePicker) => void = () => undefined
): Promise<VioletTimePicker> {
    document.body.innerHTML = "";
    const picker = document.createElement("violet-time-picker") as VioletTimePicker;
    picker.label = "Start time";
    picker.supportingText = "Choose when this automation should begin each day.";
    picker.value = "09:30";
    picker.name = "start-time";
    picker.min = "06:00";
    picker.max = "21:00";
    picker.step = "60";
    configure(picker);
    document.body.append(picker);
    await customElements.whenDefined("violet-time-picker");
    await nextFrame();
    return picker;
}

async function renderInForm(
    configure: (picker: VioletTimePicker) => void = () => undefined
): Promise<{ form: HTMLFormElement; picker: VioletTimePicker }> {
    document.body.innerHTML = "";
    const form = document.createElement("form");
    const picker = document.createElement("violet-time-picker") as VioletTimePicker;
    picker.name = "start";
    configure(picker);
    form.append(picker);
    document.body.append(form);
    await customElements.whenDefined("violet-time-picker");
    await nextFrame();
    return { form, picker };
}

function getInput(picker: VioletTimePicker): HTMLInputElement {
    const input = picker.shadowRoot?.querySelector<HTMLInputElement>('input[type="time"]');
    if (!input) {
        throw new Error("Expected the native time input to render.");
    }
    return input;
}

function typeInto(picker: VioletTimePicker, value: string, commit = true): void {
    const input = getInput(picker);
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (commit) {
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }
}

function customEventDetails(mock: ReturnType<typeof vi.fn>): unknown[] {
    return mock.mock.calls.map(([event]) => (event as CustomEvent).detail).filter(Boolean);
}

describe("violet-time-picker", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("syncs native time input state from the value property", async () => {
        const picker = await renderTimePicker();
        const input = picker.shadowRoot?.querySelector('input[type="time"]') as HTMLInputElement | null;

        expect(input?.value).toBe("09:30");
    });

    it("updates from native input events", async () => {
        const picker = await renderTimePicker();
        const input = picker.shadowRoot?.querySelector('input[type="time"]') as HTMLInputElement | null;

        input!.value = "10:15";
        input?.dispatchEvent(new Event("input", { bubbles: true }));
        input?.dispatchEvent(new Event("change", { bubbles: true }));
        await nextFrame();

        expect(picker.value).toBe("10:15");
    });

    it("fails validity when required and empty", async () => {
        const picker = await renderTimePicker();
        picker.required = true;
        picker.value = "";
        await nextFrame();

        expect(picker.checkValidity()).toBe(false);
    });

    describe("rendering and ARIA", () => {
        it("labels the native input and forwards name, min, max and step", async () => {
            const picker = await renderTimePicker();
            const input = getInput(picker);
            const label = picker.shadowRoot?.querySelector("label");

            expect(label?.textContent?.trim()).toBe("Start time");
            expect(label?.getAttribute("for")).toBe(input.id);
            expect(input.name).toBe("start-time");
            expect(input.min).toBe("06:00");
            expect(input.max).toBe("21:00");
            expect(input.step).toBe("60");
        });

        it("defaults the step to 60 seconds and falls back when it is cleared", async () => {
            document.body.innerHTML = "";
            const picker = document.createElement("violet-time-picker") as VioletTimePicker;
            document.body.append(picker);
            await nextFrame();

            expect(picker.step).toBe("60");
            expect(getInput(picker).step).toBe("60");

            picker.step = "";
            expect(picker.stepValue).toBe("60");
        });

        it("links supporting text and the error message through aria-describedby", async () => {
            const picker = await renderTimePicker();
            expect(getInput(picker).getAttribute("aria-describedby")).toBe(picker.supportingId);
            expect(getInput(picker).getAttribute("aria-invalid")).toBe("false");

            const invalid = await renderTimePicker(element => {
                element.errorText = "Outside business hours.";
                element.invalid = true;
            });
            expect(getInput(invalid).getAttribute("aria-invalid")).toBe("true");
            expect(getInput(invalid).getAttribute("aria-describedby")).toBe(`${invalid.supportingId} ${invalid.errorId}`);
            expect(invalid.shadowRoot?.getElementById(invalid.errorId)?.textContent?.trim()).toBe("Outside business hours.");
        });

        it("marks the native input required and disabled", async () => {
            const picker = await renderTimePicker(element => {
                element.required = true;
                element.disabled = true;
            });

            expect(getInput(picker).required).toBe(true);
            expect(getInput(picker).disabled).toBe(true);
        });
    });

    describe("value and events", () => {
        it("pushes programmatic value changes into the native input", async () => {
            const picker = await renderTimePicker();

            picker.value = "13:45";
            expect(getInput(picker).value).toBe("13:45");

            picker.value = "";
            expect(getInput(picker).value).toBe("");
        });

        it("emits input while editing and change when committed, each with the new value", async () => {
            const picker = await renderTimePicker();
            const input = vi.fn();
            const change = vi.fn();
            picker.addEventListener("input", input);
            picker.addEventListener("change", change);

            typeInto(picker, "11:05", false);
            expect(customEventDetails(input)).toEqual([{ value: "11:05" }]);
            expect(customEventDetails(change)).toEqual([]);

            getInput(picker).dispatchEvent(new Event("change", { bubbles: true }));
            expect(customEventDetails(change)).toEqual([{ value: "11:05" }]);
        });

        it("clears the value when the native input is emptied", async () => {
            const picker = await renderTimePicker();

            typeInto(picker, "");

            expect(picker.value).toBe("");
        });

        it("accepts seconds when the step allows them", async () => {
            const picker = await renderTimePicker(element => {
                element.step = "1";
                element.value = "09:30:15";
            });

            expect(getInput(picker).value).toBe("09:30:15");
            expect(picker.validity.valid).toBe(true);

            typeInto(picker, "10:45:30");
            expect(picker.value).toBe("10:45:30");
        });

        it("forwards the step so the native input flags times off the step", async () => {
            const picker = await renderTimePicker(element => {
                element.step = "900";
                element.value = "09:30";
            });

            expect(getInput(picker).validity.stepMismatch).toBe(false);
            getInput(picker).value = "09:31";
            expect(getInput(picker).validity.stepMismatch).toBe(true);
        });

        it("forwards min and max so the native input flags times outside the range", async () => {
            const picker = await renderTimePicker();

            getInput(picker).value = "05:00";
            expect(getInput(picker).validity.rangeUnderflow).toBe(true);
            getInput(picker).value = "22:00";
            expect(getInput(picker).validity.rangeOverflow).toBe(true);
            getInput(picker).value = "12:00";
            expect(getInput(picker).validity.valid).toBe(true);
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
            expect(new FormData(form).has("start")).toBe(false);

            picker.value = "07:15";
            expect(new FormData(form).get("start")).toBe("07:15");

            picker.value = "";
            expect(new FormData(form).has("start")).toBe(false);
        });

        it("submits a value entered through the native input", async () => {
            const { form, picker } = await renderInForm();

            typeInto(picker, "18:20");

            expect(new FormData(form).get("start")).toBe("18:20");
        });

        it("is valueMissing when required and empty, then valid once a time is set", async () => {
            const { form, picker } = await renderInForm(element => {
                element.required = true;
            });

            expect(picker.validity.valueMissing).toBe(true);
            expect(picker.validationMessage).toBe("Please choose a time.");
            expect(picker.checkValidity()).toBe(false);
            expect(form.checkValidity()).toBe(false);

            picker.value = "08:00";

            expect(picker.validity.valid).toBe(true);
            expect(picker.checkValidity()).toBe(true);
            expect(form.checkValidity()).toBe(true);
        });

        it("raises a custom error with the supplied error text when invalid", async () => {
            const { picker } = await renderInForm(element => {
                element.value = "09:00";
                element.errorText = "Outside business hours.";
                element.invalid = true;
            });

            expect(picker.validity.customError).toBe(true);
            expect(picker.validationMessage).toBe("Outside business hours.");
            expect(picker.checkValidity()).toBe(false);

            picker.invalid = false;
            expect(picker.validity.customError).toBe(false);
            expect(picker.checkValidity()).toBe(true);
        });

        it("falls back to a default message for invalid without error text", async () => {
            const { picker } = await renderInForm(element => {
                element.invalid = true;
            });

            expect(picker.validationMessage).toBe("Enter a valid time.");
        });

        it("reports badInput for values that are not a valid time of day", async () => {
            const { picker } = await renderInForm();

            for (const value of ["25:00", "12:60", "9:30", "noon"]) {
                picker.value = value;
                expect(picker.validity.badInput, value).toBe(true);
                expect(picker.validationMessage, value).toBe("Enter a valid time.");
            }

            for (const value of ["00:00", "23:59", "12:34:56"]) {
                picker.value = value;
                expect(picker.validity.valid, value).toBe(true);
            }
        });

        it("reports rangeUnderflow and rangeOverflow for times outside min and max", async () => {
            const { picker } = await renderInForm(element => {
                element.min = "06:00";
                element.max = "21:00";
            });

            picker.value = "05:00";
            expect(picker.validity.rangeUnderflow).toBe(true);

            picker.value = "22:00";
            expect(picker.validity.rangeOverflow).toBe(true);
        });

        it("refreshes the validation message when error text changes after invalid is set", async () => {
            const { picker } = await renderInForm(element => {
                element.invalid = true;
            });

            picker.errorText = "Outside business hours.";

            expect(picker.validationMessage).toBe("Outside business hours.");
        });

        it("restores the initial value on form reset", async () => {
            const { form, picker } = await renderInForm(element => {
                element.value = "09:30";
            });
            typeInto(picker, "14:00");
            expect(new FormData(form).get("start")).toBe("14:00");

            form.reset();
            await nextFrame();

            expect(picker.value).toBe("09:30");
            expect(getInput(picker).value).toBe("09:30");
            expect(new FormData(form).get("start")).toBe("09:30");
        });

        it("clears to empty on form reset when it started empty", async () => {
            const { form, picker } = await renderInForm();
            typeInto(picker, "14:00");

            form.reset();
            await nextFrame();

            expect(picker.value).toBe("");
            expect(new FormData(form).has("start")).toBe(false);
        });
    });
});
