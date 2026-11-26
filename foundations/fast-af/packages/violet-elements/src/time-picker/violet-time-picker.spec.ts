import { afterEach, describe, expect, it, vi } from "vitest";
import { server, userEvent } from "vitest/browser";

const isWebKit = server.browser === "webkit";
// Chromium and Firefox provide segmented HH:MM editing on native <input type="time">; WebKit on
// Windows degrades <input type="time"> to text and Linux WebKitGTK differs on partial segment entry.
const supportsSegmentedTimeInput =
  !isWebKit &&
  (() => {
    const probe = document.createElement("input");
    probe.type = "time";
    return probe.type === "time";
  })();

import "./violet-time-picker.define";
import type { VioletTimePicker } from "./violet-time-picker";

function nextFrame(): Promise<void> {
  // FAST flushes template updates in its own animation-frame batch; wait two frames so the DOM has settled.
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

async function renderTimePicker(
  configure: (picker: VioletTimePicker) => void = () => undefined,
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
  configure: (picker: VioletTimePicker) => void = () => undefined,
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

  // The input reads "" while incomplete, as the default does, so a reset must write it anyway.
  it.runIf(supportsSegmentedTimeInput)("clears an incomplete entry on form reset", async () => {
    document.body.innerHTML = `<form><violet-time-picker label="Start" name="when"></violet-time-picker></form>`;
    await customElements.whenDefined("violet-time-picker");
    await nextFrame();
    const form = document.querySelector("form") as HTMLFormElement;
    const picker = document.querySelector("violet-time-picker") as HTMLElement & { value: string };
    const input = picker.shadowRoot?.querySelector("input") as HTMLInputElement;

    await userEvent.click(input, { position: { x: 8, y: input.clientHeight / 2 } });
    await userEvent.keyboard("10");
    await nextFrame();
    expect(picker.value).toBe("");
    expect(input.validity.badInput).toBe(true);

    form.reset();
    await nextFrame();

    expect(input.validity.badInput).toBe(false);
    expect(input.value).toBe("");
    expect(picker.value).toBe("");
  });

  // #712: the input reads "" while a segment is incomplete, and a :value binding wrote that "" back,
  // erasing the segments already entered.
  it.runIf(supportsSegmentedTimeInput)(
    "keeps the other segments while one is re-entered",
    async () => {
      const picker = await renderTimePicker((element) => {
        element.value = "09:30";
      });
      const input = picker.shadowRoot?.querySelector("input") as HTMLInputElement;

      await userEvent.click(input, { position: { x: 8, y: input.clientHeight / 2 } });
      await userEvent.keyboard("{Backspace}");
      await nextFrame();
      expect(picker.value).toBe("");
      await userEvent.keyboard("10");
      await nextFrame();

      expect(input.value).toBe("10:30");
      expect(picker.value).toBe("10:30");
    },
  );

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

      const invalid = await renderTimePicker((element) => {
        element.errorText = "Outside business hours.";
        element.invalid = true;
      });
      expect(getInput(invalid).getAttribute("aria-invalid")).toBe("true");
      expect(getInput(invalid).getAttribute("aria-describedby")).toBe(invalid.errorId);
      expect(invalid.shadowRoot?.getElementById(invalid.supportingId)).toBeNull();
      expect(invalid.shadowRoot?.getElementById(invalid.errorId)?.getAttribute("role")).toBe(
        "alert",
      );
      expect(invalid.shadowRoot?.getElementById(invalid.errorId)?.textContent?.trim()).toBe(
        "Outside business hours.",
      );
    });

    it("marks the native input required and disabled", async () => {
      const picker = await renderTimePicker((element) => {
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
      const picker = await renderTimePicker((element) => {
        element.step = "1";
        element.value = "09:30:15";
      });

      expect(getInput(picker).value).toBe("09:30:15");
      expect(picker.validity.valid).toBe(true);

      typeInto(picker, "10:45:30");
      expect(picker.value).toBe("10:45:30");
    });

    it("forwards the step and propagates stepMismatch on the host across dynamic step changes", async () => {
      const picker = await renderTimePicker((element) => {
        element.min = "09:00";
        element.step = "900";
        element.value = "09:30";
      });

      const native = getInput(picker);
      expect(native.getAttribute("step")).toBe("900");
      expect(picker.checkValidity()).toBe(true);
      expect(picker.validity.stepMismatch).toBe(false);

      picker.value = "09:31";
      await nextFrame();
      expect(picker.validity.stepMismatch).toBe(true);
      expect(picker.checkValidity()).toBe(false);
      if (native.type === "time") {
        expect(native.validity.stepMismatch).toBe(true);
      }

      // While invalid without author error-text, the host surfaces the step constraint message.
      picker.invalid = true;
      await nextFrame();
      expect(picker.displayErrorText).toBe("Choose a valid time increment.");

      // Dynamic step update resolves stepMismatch and clears the fallback error.
      picker.step = "60";
      await nextFrame();
      expect(picker.validity.stepMismatch).toBe(false);
      expect(picker.displayErrorText).toBe("");

      // Tightening step back to 900 re-triggers stepMismatch on the host.
      picker.step = "900";
      await nextFrame();
      expect(picker.validity.stepMismatch).toBe(true);
      expect(picker.displayErrorText).toBe("Choose a valid time increment.");
    });

    it("forwards min and max so the native input flags times outside the range", async () => {
      const picker = await renderTimePicker();
      const native = getInput(picker);
      expect(native.getAttribute("min")).toBe("06:00");
      expect(native.getAttribute("max")).toBe("21:00");

      if (native.type === "time") {
        native.value = "05:00";
        expect(native.validity.rangeUnderflow).toBe(true);
        native.value = "22:00";
        expect(native.validity.rangeOverflow).toBe(true);
        native.value = "12:00";
        expect(native.validity.valid).toBe(true);
      }
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
      const { form, picker } = await renderInForm((element) => {
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
      const { picker } = await renderInForm((element) => {
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
      const { picker } = await renderInForm((element) => {
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

      for (const value of ["00:00", "23:59"]) {
        picker.value = value;
        expect(picker.validity.valid, value).toBe(true);
      }

      // Seconds are valid time-of-day syntax (not badInput), and pass step validation when step="1" or fractional step="0.1" / ".5".
      picker.value = "12:34:56";
      expect(picker.validity.badInput, "12:34:56").toBe(false);
      expect(picker.validity.stepMismatch, "12:34:56 at default step=60").toBe(true);
      picker.step = "1";
      expect(picker.validity.valid, "12:34:56 at step=1").toBe(true);
      for (const fractionalStep of ["0.1", ".5"]) {
        picker.step = fractionalStep;
        expect(picker.validity.stepMismatch, `12:34:56 at step=${fractionalStep}`).toBe(false);
        expect(picker.checkValidity(), `12:34:56 at step=${fractionalStep}`).toBe(true);
        await nextFrame();
        const nativeFractional = getInput(picker);
        if (nativeFractional.type === "time") {
          expect(
            nativeFractional.validity.stepMismatch,
            `native 12:34:56 at step=${fractionalStep}`,
          ).toBe(false);
        }
      }

      // Nonpositive or malformed step values (including hex, leading plus/space, and padded " any ") fall back to the 60s default, matching native <input type="time">; exact "any" disables step checks.
      for (const badStep of ["0", "bogus", "0x10", " any ", "+1", " 1"]) {
        picker.step = badStep;
        await nextFrame();
        expect(picker.validity.stepMismatch, `12:34:56 at step=${badStep}`).toBe(true);
        expect(picker.checkValidity(), `12:34:56 at step=${badStep}`).toBe(false);
        const native = getInput(picker);
        if (native.type === "time") {
          expect(native.validity.stepMismatch, `native 12:34:56 at step=${badStep}`).toBe(true);
        }
      }
      picker.step = "any";
      await nextFrame();
      expect(picker.validity.stepMismatch, "12:34:56 at step=any").toBe(false);
      expect(picker.checkValidity(), "12:34:56 at step=any").toBe(true);
      const native = getInput(picker);
      if (native.type === "time") {
        expect(native.validity.stepMismatch, "native 12:34:56 at step=any").toBe(false);
      }
    });

    it("reports rangeUnderflow and rangeOverflow for times outside min and max", async () => {
      const { picker } = await renderInForm((element) => {
        element.min = "06:00";
        element.max = "21:00";
      });

      picker.value = "05:00";
      expect(picker.validity.rangeUnderflow).toBe(true);

      picker.value = "22:00";
      expect(picker.validity.rangeOverflow).toBe(true);
    });

    it("refreshes the validation message when error text changes after invalid is set", async () => {
      const { picker } = await renderInForm((element) => {
        element.invalid = true;
      });

      picker.errorText = "Outside business hours.";

      expect(picker.validationMessage).toBe("Outside business hours.");
    });

    it("restores the initial value on form reset", async () => {
      const { form, picker } = await renderInForm((element) => {
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
