import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-text-field.define";
import type { VioletTextField } from "./violet-text-field";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function renderField(
  options: { configure?: (field: VioletTextField) => void; inForm?: boolean } = {},
): Promise<{ field: VioletTextField; form: HTMLFormElement | null }> {
  document.body.innerHTML = "";

  const field = document.createElement("violet-text-field") as VioletTextField;
  field.name = "email";
  options.configure?.(field);

  let form: HTMLFormElement | null = null;
  if (options.inForm) {
    form = document.createElement("form");
    form.append(field);
    document.body.append(form);
  } else {
    document.body.append(field);
  }

  await customElements.whenDefined("violet-text-field");
  await nextFrame();

  return { field, form };
}

function input(field: VioletTextField): HTMLInputElement {
  const native = field.shadowRoot?.querySelector("input");
  if (!native) {
    throw new Error("violet-text-field did not render its native input");
  }
  return native;
}

function customDetails(events: Event[]): Array<{ value: string }> {
  return events
    .filter((event): event is CustomEvent<{ value: string }> => event instanceof CustomEvent)
    .map((event) => event.detail);
}

describe("violet-text-field", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders an empty text input with defaults", async () => {
    const { field } = await renderField();

    expect(field.type).toBe("text");
    expect(field.value).toBe("");
    expect(field.disabled).toBe(false);
    expect(field.readonly).toBe(false);
    expect(field.required).toBe(false);
    expect(input(field).type).toBe("text");
    expect(input(field).value).toBe("");
    expect(field.shadowRoot?.querySelector("label")).toBeNull();
    expect(field.shadowRoot?.querySelector(".supporting")).toBeNull();
  });

  it("maps attributes to properties and the native input", async () => {
    const { field } = await renderField({
      configure: (el) => {
        el.setAttribute("type", "email");
        el.setAttribute("value", "ada@example.com");
        el.setAttribute("placeholder", "you@example.com");
        el.setAttribute("name", "contact");
        el.setAttribute("required", "");
        el.setAttribute("readonly", "");
      },
    });
    const native = input(field);

    expect(field.type).toBe("email");
    expect(field.value).toBe("ada@example.com");
    expect(native.type).toBe("email");
    expect(native.value).toBe("ada@example.com");
    expect(native.placeholder).toBe("you@example.com");
    expect(native.name).toBe("contact");
    expect(native.required).toBe(true);
    expect(native.readOnly).toBe(true);
  });

  it("reflects boolean properties to host attributes, never value", async () => {
    const { field } = await renderField();

    field.value = "hello";
    field.disabled = true;
    field.invalid = true;
    await nextFrame();

    expect(field.hasAttribute("value")).toBe(false);
    expect(field.hasAttribute("disabled")).toBe(true);
    expect(field.hasAttribute("invalid")).toBe(true);
    expect(input(field).value).toBe("hello");
    expect(input(field).disabled).toBe(true);
    expect(input(field).getAttribute("aria-invalid")).toBe("true");

    field.invalid = false;
    await nextFrame();
    expect(input(field).getAttribute("aria-invalid")).toBe("false");
  });

  it("renders a label associated with the input and uses it as the accessible name", async () => {
    const { field } = await renderField({
      configure: (el) => {
        el.label = "Email address";
      },
    });
    const label = field.shadowRoot?.querySelector("label") as HTMLLabelElement;

    expect(label.textContent?.trim()).toBe("Email address");
    expect(label.htmlFor).toBe(input(field).id);
    expect(input(field).id).toBe(field.inputId);
    expect(input(field).getAttribute("aria-label")).toBe("Email address");
  });

  it("falls back to the host aria-label when there is no visible label", async () => {
    const { field } = await renderField({
      configure: (el) => {
        el.setAttribute("aria-label", "Search");
      },
    });

    expect(input(field).getAttribute("aria-label")).toBe("Search");
  });

  it("renders supporting text only when provided", async () => {
    const { field } = await renderField({
      configure: (el) => {
        el.supportingText = "We never share your email.";
      },
    });

    expect(field.shadowRoot?.querySelector(".supporting")?.textContent?.trim()).toBe(
      "We never share your email.",
    );
  });

  it("gives each field a unique input id", async () => {
    const first = document.createElement("violet-text-field") as VioletTextField;
    const second = document.createElement("violet-text-field") as VioletTextField;

    expect(first.inputId).not.toBe(second.inputId);
  });

  it("projects the before slot", async () => {
    const { field } = await renderField({
      configure: (el) => {
        const icon = document.createElement("span");
        icon.slot = "before";
        icon.textContent = "@";
        el.append(icon);
      },
    });
    const slot = field.shadowRoot?.querySelector('slot[name="before"]') as HTMLSlotElement;

    expect(slot.assignedElements()).toHaveLength(1);
  });

  describe("interaction", () => {
    it("updates value and emits input events with a value detail while typing", async () => {
      const { field } = await renderField();
      const events: Event[] = [];
      field.addEventListener("input", (event) => events.push(event));

      field.focus();
      await userEvent.keyboard("abc");

      expect(field.value).toBe("abc");
      expect(input(field).value).toBe("abc");
      expect(customDetails(events)).toEqual([{ value: "a" }, { value: "ab" }, { value: "abc" }]);
    });

    it("emits change with the committed value when focus leaves", async () => {
      const { field } = await renderField();
      const after = document.createElement("button");
      after.textContent = "After";
      document.body.append(after);
      const events: Event[] = [];
      field.addEventListener("change", (event) => events.push(event));

      field.focus();
      await userEvent.keyboard("hello");
      expect(customDetails(events)).toEqual([]);

      await userEvent.tab();

      expect(customDetails(events)).toEqual([{ value: "hello" }]);
      expect(field.value).toBe("hello");
    });

    it("emits change on Enter after typing", async () => {
      const { field } = await renderField();
      const events: Event[] = [];
      field.addEventListener("change", (event) => events.push(event));

      field.focus();
      await userEvent.keyboard("go{Enter}");

      expect(customDetails(events)).toEqual([{ value: "go" }]);
    });

    it("draws a read-only field's line in the strong border and its placeholder in secondary text", async () => {
      const field = await renderTextField({ readonly: "" });
      const style = getComputedStyle(field);
      // With no theme installed these are the light theme's values (Loam's D159).
      expect(style.getPropertyValue("--_field-border").trim().toLowerCase()).toBe("#6b7d6e");
      expect(style.getPropertyValue("--_field-placeholder").trim().toLowerCase()).toBe("#48534b");
      // The painted line: the frame's inset top rule is the strong border.
      const frame = () => field.shadowRoot?.querySelector(".control-frame") as HTMLElement;
      expect(getComputedStyle(frame()).boxShadow).toContain("rgb(107, 125, 110)");
      // The pointer can rest over the field from an earlier test, and the hover line is darker: move it off.
      const away = document.body.appendChild(document.createElement("div"));
      away.style.cssText =
        "position: fixed; inset-block-end: 0; inset-inline-end: 0; inline-size: 4px; block-size: 4px";
      await userEvent.hover(away);
      away.remove();
      field.removeAttribute("readonly");
      await nextFrame();
      expect(getComputedStyle(field).getPropertyValue("--_field-border").trim().toLowerCase()).toBe(
        "#869089",
      );
      // The frame eases its shadow, and the transition may not have started a frame later; wait for the line to settle.
      await vi.waitFor(() =>
        expect(getComputedStyle(frame()).boxShadow).toContain("rgb(134, 144, 137)"),
      );
    });

    it("ignores typing while readonly", async () => {
      const { field } = await renderField({
        configure: (el) => {
          el.value = "fixed";
          el.readonly = true;
        },
      });

      field.focus();
      await userEvent.keyboard("zzz");

      expect(field.value).toBe("fixed");
    });

    it("cannot be focused while disabled", async () => {
      const { field } = await renderField({
        configure: (el) => {
          el.disabled = true;
        },
      });

      field.focus();

      expect(field.shadowRoot?.activeElement).toBeNull();
    });

    it("delegates focus to the native input", async () => {
      const { field } = await renderField();

      field.focus();

      expect(document.activeElement).toBe(field);
      expect(field.shadowRoot?.activeElement).toBe(input(field));
    });
  });

  describe("form participation", () => {
    it("submits the current value under its name", async () => {
      const { field, form } = await renderField({ inForm: true });

      expect(new FormData(form as HTMLFormElement).get("email")).toBe("");

      field.focus();
      await userEvent.keyboard("ada@example.com");

      expect(new FormData(form as HTMLFormElement).get("email")).toBe("ada@example.com");
      expect(field.form).toBe(form);
    });

    it("submits the initial value attribute", async () => {
      const { form } = await renderField({
        inForm: true,
        configure: (el) => {
          el.setAttribute("value", "preset");
        },
      });

      expect(new FormData(form as HTMLFormElement).get("email")).toBe("preset");
    });

    it("omits the value from form data when disabled", async () => {
      const { form } = await renderField({
        inForm: true,
        configure: (el) => {
          el.value = "secret";
          el.disabled = true;
        },
      });

      expect(new FormData(form as HTMLFormElement).has("email")).toBe(false);
    });

    it("reports valueMissing while required and empty", async () => {
      const { field, form } = await renderField({
        inForm: true,
        configure: (el) => {
          el.required = true;
        },
      });

      expect(field.checkValidity()).toBe(false);
      expect(field.validity.valueMissing).toBe(true);
      expect(field.validationMessage).not.toBe("");
      expect((form as HTMLFormElement).checkValidity()).toBe(false);

      field.value = "filled";
      await nextFrame();

      expect(field.checkValidity()).toBe(true);
      expect((form as HTMLFormElement).checkValidity()).toBe(true);
    });

    it("reports a custom error while invalid", async () => {
      const { field } = await renderField({
        inForm: true,
        configure: (el) => {
          el.value = "nope";
          el.invalid = true;
        },
      });

      expect(field.validity.customError).toBe(true);
      expect(field.checkValidity()).toBe(false);

      field.invalid = false;
      await nextFrame();

      expect(field.checkValidity()).toBe(true);
    });

    it("skips validation while readonly or disabled", async () => {
      const { field } = await renderField({
        inForm: true,
        configure: (el) => {
          el.required = true;
          el.readonly = true;
        },
      });

      expect(field.checkValidity()).toBe(true);

      field.readonly = false;
      field.disabled = true;
      await nextFrame();

      expect(field.checkValidity()).toBe(true);
    });

    it("restores its initial value on form reset", async () => {
      const { field, form } = await renderField({
        inForm: true,
        configure: (el) => {
          el.setAttribute("value", "initial");
        },
      });

      field.focus();
      // Keyboard-style focus selects the existing text; collapse the selection to the end first.
      input(field).setSelectionRange(7, 7);
      await userEvent.keyboard("-edited");
      expect(field.value).toBe("initial-edited");

      (form as HTMLFormElement).reset();
      await nextFrame();

      expect(field.value).toBe("initial");
      expect(input(field).value).toBe("initial");
      expect(new FormData(form as HTMLFormElement).get("email")).toBe("initial");
    });

    it("resets to empty when no initial value was provided", async () => {
      const { field, form } = await renderField({ inForm: true });

      field.value = "typed";
      await nextFrame();
      (form as HTMLFormElement).reset();
      await nextFrame();

      expect(field.value).toBe("");
    });
  });
});

async function renderTextField(attributes: Record<string, string> = {}): Promise<VioletTextField> {
  document.body.innerHTML = "";
  const field = document.createElement("violet-text-field") as VioletTextField;
  field.label = "Password";
  for (const [name, value] of Object.entries(attributes)) {
    field.setAttribute(name, value);
  }
  document.body.append(field);
  await customElements.whenDefined("violet-text-field");
  await nextFrame();
  return field;
}

function type(field: VioletTextField, text: string): void {
  const input = field.shadowRoot?.querySelector("input");
  if (!input) {
    throw new Error("Expected text field input to render.");
  }
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
}

describe("violet-text-field value attribute", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not reflect typed text into the value attribute", async () => {
    const field = await renderTextField({ type: "password" });

    type(field, "hunter2");
    await nextFrame();

    expect(field.value).toBe("hunter2");
    expect(field.hasAttribute("value")).toBe(false);
  });

  it("does not reflect programmatic value changes into the attribute", async () => {
    const field = await renderTextField({ value: "initial" });

    field.value = "changed";
    await nextFrame();

    expect(field.getAttribute("value")).toBe("initial");
  });

  it("still reads the initial value attribute and later attribute changes", async () => {
    const field = await renderTextField({ value: "initial" });
    expect(field.value).toBe("initial");

    field.setAttribute("value", "updated");
    await nextFrame();

    expect(field.value).toBe("updated");
  });

  it("resets to the attribute default, including after re-attaching", async () => {
    const field = await renderTextField({ value: "initial" });

    type(field, "typed");
    field.remove();
    document.body.append(field);
    await nextFrame();

    field.formResetCallback();
    await nextFrame();

    expect(field.value).toBe("initial");
    expect(field.getAttribute("value")).toBe("initial");
  });
});

describe("violet-text-field number entry (#712)", () => {
  for (const start of ["", "5"]) {
    it(`keeps a typed minus sign over "${start}"`, async () => {
      const { field } = await renderField({
        configure: (candidate) => {
          candidate.type = "number";
          candidate.value = start;
        },
      });
      const control = input(field);
      await userEvent.click(control);
      control.select();
      await userEvent.keyboard("-");
      await nextFrame();
      await userEvent.keyboard("2");
      await nextFrame();

      expect(control.value).toBe("-2");
      expect(field.value).toBe("-2");
    });
  }

  it("shows the value attribute it starts with", async () => {
    document.body.innerHTML = '<violet-text-field type="number" value="4"></violet-text-field>';
    await customElements.whenDefined("violet-text-field");
    await nextFrame();
    const field = document.querySelector("violet-text-field") as VioletTextField;
    expect(input(field).value).toBe("4");
  });

  it("clears a partial entry on form reset", async () => {
    const { field, form } = await renderField({
      inForm: true,
      configure: (candidate) => {
        candidate.type = "number";
      },
    });
    const control = input(field);
    await userEvent.click(control);
    await userEvent.keyboard("-");
    await nextFrame();
    form?.reset();
    await nextFrame();
    expect(control.validity.badInput).toBe(false);
    expect(field.value).toBe("");
  });

  it("still shows a value set from outside", async () => {
    const { field } = await renderField({
      configure: (candidate) => {
        candidate.type = "number";
        candidate.value = "3";
      },
    });
    expect(input(field).value).toBe("3");
    field.value = "7";
    expect(input(field).value).toBe("7");
    field.value = "";
    expect(input(field).value).toBe("");
  });

  it("shrinks inside narrow CSS grid columns without overflowing its host", async () => {
    document.body.innerHTML = `
            <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:8px;width:240px">
                <violet-text-field id="a" label="Glyph" placeholder="e.g. H"></violet-text-field>
                <violet-text-field id="b" label="Master" placeholder="e.g. Regular"></violet-text-field>
            </div>
        `;
    await customElements.whenDefined("violet-text-field");
    await nextFrame();
    const a = document.getElementById("a") as VioletTextField;
    const b = document.getElementById("b") as VioletTextField;
    const frameA = a.shadowRoot?.querySelector(".control-frame") as HTMLElement;
    const frameB = b.shadowRoot?.querySelector(".control-frame") as HTMLElement;
    expect(frameA.getBoundingClientRect().width).toBeLessThanOrEqual(
      a.getBoundingClientRect().width + 0.5,
    );
    expect(frameB.getBoundingClientRect().width).toBeLessThanOrEqual(
      b.getBoundingClientRect().width + 0.5,
    );
    const parent = b.parentElement as HTMLElement;
    expect(frameB.getBoundingClientRect().right).toBeLessThanOrEqual(
      parent.getBoundingClientRect().right + 0.5,
    );
  });
});

describe("violet-text-field narrow column layout (#1587)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shrinks inside 1fr grid tracks and a 120px column without overflowing", async () => {
    document.body.innerHTML = `
            <div id="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;width:296px">
                <violet-text-field id="first" label="First name"></violet-text-field>
                <violet-text-field id="last" label="Last name"></violet-text-field>
            </div>
            <div id="narrow" style="width:120px;display:grid;grid-template-columns:1fr">
                <violet-text-field id="single" label="Code"></violet-text-field>
            </div>
        `;
    await customElements.whenDefined("violet-text-field");
    await nextFrame();

    const grid = document.getElementById("grid") as HTMLElement;
    const first = document.getElementById("first") as VioletTextField;
    const last = document.getElementById("last") as VioletTextField;
    const single = document.getElementById("single") as VioletTextField;

    expect(first.getBoundingClientRect().width).toBeLessThanOrEqual(144.5);
    expect(last.getBoundingClientRect().right).toBeLessThanOrEqual(
      grid.getBoundingClientRect().right + 0.5,
    );
    expect(single.getBoundingClientRect().width).toBeLessThanOrEqual(120.5);
    const singleFrame = single.shadowRoot?.querySelector(".control-frame") as HTMLElement;
    expect(singleFrame.getBoundingClientRect().width).toBeLessThanOrEqual(120.5);
  });
});

describe("violet-text-field field errors", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders no error before invalid is set, even with required and error-text", async () => {
    const { field } = await renderField({
      configure: (el) => {
        el.label = "Email";
        el.supportingText = "We only use it to sign you in.";
        el.errorText = "Enter a valid email address.";
        el.required = true;
      },
    });

    expect(field.shadowRoot?.querySelector(".error")).toBeNull();
    expect(field.shadowRoot?.querySelector(".supporting")?.textContent?.trim()).toBe(
      "We only use it to sign you in.",
    );
    expect(field.checkValidity()).toBe(false);
  });

  it("replaces supporting text with error-text while invalid, announces it, and links it as description", async () => {
    const { field } = await renderField({
      configure: (el) => {
        el.label = "Email";
        el.supportingText = "We only use it to sign you in.";
        el.setAttribute("error-text", "Enter a valid email address.");
      },
    });
    const hostHint = document.createElement("p");
    hostHint.id = "email-host-hint";
    hostHint.textContent = "Work email preferred.";
    document.body.prepend(hostHint);
    field.setAttribute("aria-describedby", "email-host-hint");

    field.invalid = true;
    await nextFrame();
    await nextFrame();

    const error = field.shadowRoot?.querySelector('[part~="error-message"]') as HTMLElement | null;
    expect(error?.textContent?.trim()).toBe("Enter a valid email address.");
    expect(error?.getAttribute("role")).toBe("alert");
    expect(field.shadowRoot?.querySelector(".supporting")).toBeNull();
    expect(Array.from(input(field).ariaDescribedByElements ?? [])).toEqual([hostHint, error]);
    expect(field.validationMessage).toBe("Enter a valid email address.");

    field.invalid = false;
    await nextFrame();
    await nextFrame();

    const supporting = field.shadowRoot?.querySelector(
      '[part~="supporting-text"]',
    ) as HTMLElement | null;
    expect(field.shadowRoot?.querySelector(".error")).toBeNull();
    expect(supporting?.textContent?.trim()).toBe("We only use it to sign you in.");
    expect(Array.from(input(field).ariaDescribedByElements ?? [])).toEqual([hostHint, supporting]);

    field.invalid = true;
    await nextFrame();
    await nextFrame();
    field.removeAttribute("error-text");
    await nextFrame();
    await nextFrame();

    expect(field.shadowRoot?.querySelector(".error")).toBeNull();
    expect(field.shadowRoot?.querySelector(".supporting")?.textContent?.trim()).toBe(
      "We only use it to sign you in.",
    );
  });

  it("falls back to the browser validation message when invalid without error-text", async () => {
    const { field } = await renderField({
      configure: (el) => {
        el.label = "Quantity";
        el.type = "number";
        el.min = "5";
        el.value = "3";
        el.supportingText = "Whole trays.";
        el.invalid = true;
      },
    });
    await nextFrame();

    const error = field.shadowRoot?.querySelector('[part~="error-message"]') as HTMLElement | null;
    expect(error?.textContent?.trim()).toBe(input(field).validationMessage);
    expect(error?.textContent?.trim()).not.toBe("");
    expect(error?.getAttribute("role")).toBe("alert");
    expect(field.shadowRoot?.querySelector(".supporting")).toBeNull();
  });

  it("renders no error message when invalid has neither error-text nor a failing native constraint", async () => {
    const { field } = await renderField({
      configure: (el) => {
        el.label = "Name";
        el.supportingText = "Shown on your badge.";
        el.invalid = true;
      },
    });
    await nextFrame();

    expect(field.shadowRoot?.querySelector(".error")).toBeNull();
    expect(field.shadowRoot?.querySelector(".supporting")?.textContent?.trim()).toBe(
      "Shown on your badge.",
    );
  });

  it("suppresses the error message while disabled or readonly and restores it when editable", async () => {
    const { field } = await renderField({
      configure: (el) => {
        el.label = "Email";
        el.supportingText = "Helper.";
        el.errorText = "Invalid email.";
        el.invalid = true;
        el.disabled = true;
      },
    });
    await nextFrame();

    expect(field.shadowRoot?.querySelector(".error")).toBeNull();
    expect(field.shadowRoot?.querySelector(".supporting")?.textContent?.trim()).toBe("Helper.");

    field.disabled = false;
    field.readonly = true;
    await nextFrame();
    expect(field.shadowRoot?.querySelector(".error")).toBeNull();

    field.readonly = false;
    await nextFrame();
    await nextFrame();
    expect(field.shadowRoot?.querySelector(".error")?.textContent?.trim()).toBe("Invalid email.");
    expect(field.shadowRoot?.querySelector(".supporting")).toBeNull();
  });

  it("suppresses the error message inside a disabled fieldset and restores it when re-enabled", async () => {
    document.body.innerHTML = "";
    const form = document.createElement("form");
    const fieldset = document.createElement("fieldset");
    fieldset.disabled = true;
    const field = document.createElement("violet-text-field") as VioletTextField;
    field.label = "Email";
    field.supportingText = "Helper.";
    field.errorText = "Invalid email.";
    field.invalid = true;
    fieldset.append(field);
    form.append(fieldset);
    document.body.append(form);
    await customElements.whenDefined("violet-text-field");
    await nextFrame();
    await nextFrame();

    expect(field.shadowRoot?.querySelector(".error")).toBeNull();
    expect(field.shadowRoot?.querySelector(".supporting")?.textContent?.trim()).toBe("Helper.");

    fieldset.disabled = false;
    await nextFrame();
    await nextFrame();

    expect(field.shadowRoot?.querySelector(".error")?.textContent?.trim()).toBe("Invalid email.");
    expect(field.shadowRoot?.querySelector(".supporting")).toBeNull();
  });

  it("falls back to the browser validation message when error-text is only whitespace", async () => {
    const { field } = await renderField({
      configure: (el) => {
        el.label = "Email";
        el.required = true;
        el.errorText = "   ";
        el.invalid = true;
      },
    });
    await nextFrame();
    await nextFrame();

    const error = field.shadowRoot?.querySelector('[part~="error-message"]') as HTMLElement | null;
    expect(error?.textContent?.trim()).toBe(input(field).validationMessage);
    expect(error?.textContent?.trim()).not.toBe("");
  });

  it("does not manufacture an error caption when the browser has no validation message, and tolerates removing value", async () => {
    const { field } = await renderField({
      configure: (el) => {
        el.label = "Name";
        el.supportingText = "Helper.";
        el.required = true;
        el.value = " ";
        el.invalid = true;
      },
    });
    await nextFrame();
    await nextFrame();

    expect(input(field).validationMessage).toBe("");
    expect(field.shadowRoot?.querySelector(".error")).toBeNull();
    expect(field.shadowRoot?.querySelector(".supporting")?.textContent?.trim()).toBe("Helper.");

    field.required = false;
    field.minLength = 5;
    field.value = "ab";
    await nextFrame();
    await nextFrame();

    expect(input(field).validationMessage).toBe("");
    expect(field.shadowRoot?.querySelector(".error")).toBeNull();

    field.setAttribute("value", "abc");
    expect(() => field.removeAttribute("value")).not.toThrow();
    await nextFrame();
    expect(field.shadowRoot?.querySelector(".error")).toBeNull();
  });

  it("updates number badInput errors on input and clears them on form reset", async () => {
    const { field, form } = await renderField({
      inForm: true,
      configure: (el) => {
        el.label = "Quantity";
        el.type = "number";
        el.supportingText = "Whole numbers.";
        el.invalid = true;
      },
    });
    await nextFrame();
    await nextFrame();

    expect(field.shadowRoot?.querySelector(".error")).toBeNull();

    input(field).focus();
    await userEvent.keyboard("-");
    await nextFrame();
    await nextFrame();

    expect(field.value).toBe("");
    expect(input(field).validity.badInput).toBe(true);
    const error = field.shadowRoot?.querySelector('[part~="error-message"]') as HTMLElement | null;
    expect(error?.textContent?.trim()).toBe(input(field).validationMessage);
    expect(error?.textContent?.trim()).not.toBe("");
    expect(field.shadowRoot?.querySelector(".supporting")).toBeNull();

    (form as HTMLFormElement).reset();
    await nextFrame();
    await nextFrame();

    expect(input(field).validity.badInput).toBe(false);
    expect(field.shadowRoot?.querySelector(".error")).toBeNull();
    expect(field.shadowRoot?.querySelector(".supporting")?.textContent?.trim()).toBe(
      "Whole numbers.",
    );
  });

  it("keeps displayErrorText read-only", async () => {
    const { field } = await renderField({
      configure: (el) => {
        el.label = "Name";
      },
    });

    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(field),
      "displayErrorText",
    );
    expect(descriptor?.set).toBeUndefined();
  });
});
