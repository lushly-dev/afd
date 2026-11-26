import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "vitest/browser";

const isWebKit = server.browser === "webkit";

// WebKit's ElementInternals ARIA element-array getters filter out shadow-tree targets to [] when
// read back, while still distinguishing an assigned array ([]) from null; Chromium and Firefox
// return the shadow elements directly.
function expectInternalsElements(
  actual: readonly Element[] | null | undefined,
  expected: Element | null,
): void {
  expect(expected).toBeTruthy();
  if (isWebKit) {
    expect(actual).toEqual([]);
  } else {
    expect(actual).toEqual([expected]);
  }
}

import "./violet-radio.define";
import type { VioletRadio } from "./violet-radio";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function renderRadio(
  options: { inline?: boolean; label?: string; ariaLabel?: string } = {},
): Promise<VioletRadio> {
  document.body.innerHTML = "";

  const radio = document.createElement("violet-radio") as VioletRadio;
  radio.value = "direct";
  radio.inline = options.inline ?? false;

  if (options.ariaLabel) {
    radio.setAttribute("aria-label", options.ariaLabel);
  }

  if (options.label) {
    radio.textContent = options.label;
  }

  document.body.append(radio);

  await customElements.whenDefined("violet-radio");
  await nextFrame();

  return radio;
}

describe("violet-radio", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("checks when clicked and emits a change-like state transition", async () => {
    const radio = await renderRadio({ label: "Direct seed" });
    const control = radio.shadowRoot?.querySelector(".root") as HTMLElement | null;

    expect(radio.checked).toBe(false);

    control?.click();
    await nextFrame();

    expect(radio.checked).toBe(true);
  });

  it.each([" ", "Enter"])(
    "supports native focus and standalone keyboard activation with %s",
    async (key) => {
      const radio = await renderRadio({
        inline: true,
        ariaLabel: "Compact direct seed option",
      });
      const previousControl = document.createElement("button");
      document.body.prepend(previousControl);

      previousControl.focus();
      expect(document.activeElement).toBe(previousControl);

      radio.focus();
      expect(document.activeElement).toBe(radio);
      radio.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key,
        }),
      );
      await nextFrame();

      expect(radio.checked).toBe(true);
      expect(radio.shadowRoot?.querySelector(".content")?.hasAttribute("hidden")).toBe(true);
      expect(radio.getAttribute("aria-label")).toBe("Compact direct seed option");
    },
  );

  describe("field errors", () => {
    it("renders no error before invalid is set", async () => {
      const radio = await renderRadio({ label: "Direct seed" });
      const supporting = document.createElement("span");
      supporting.slot = "supporting";
      supporting.textContent = "Sown straight into the bed.";
      radio.append(supporting);
      radio.errorText = "Choose an eligible option.";
      await nextFrame();

      expect(radio.shadowRoot?.querySelector(".error")).toBeNull();
      expect(radio.shadowRoot?.querySelector(".supporting")?.hasAttribute("hidden")).toBe(false);
    });

    it("replaces supporting text with error-text while invalid and announces it", async () => {
      const originalAttachInternals = HTMLElement.prototype.attachInternals;
      const captured: ElementInternals[] = [];
      const spy = vi.spyOn(HTMLElement.prototype, "attachInternals").mockImplementation(function (
        this: HTMLElement,
      ) {
        const attached = originalAttachInternals.call(this);
        if (this.tagName.toLowerCase() === "violet-radio") {
          captured.push(attached);
        }
        return attached;
      });

      try {
        const radio = await renderRadio({ label: "Direct seed" });
        const internals = captured[0];
        const supporting = document.createElement("span");
        supporting.slot = "supporting";
        supporting.textContent = "Sown straight into the bed.";
        radio.append(supporting);
        radio.setAttribute("error-text", "Choose an eligible option.");
        await nextFrame();
        await nextFrame();

        const supportingEl = radio.shadowRoot?.querySelector(
          '[part~="supporting-text"]',
        ) as HTMLElement | null;
        expectInternalsElements(internals?.ariaDescribedByElements, supportingEl);

        radio.invalid = true;
        await nextFrame();
        await nextFrame();

        const error = radio.shadowRoot?.querySelector(
          '[part~="error-message"]',
        ) as HTMLElement | null;
        expect(error?.textContent?.trim()).toBe("Choose an eligible option.");
        expect(error?.getAttribute("role")).toBe("alert");
        expect(supportingEl?.hasAttribute("hidden")).toBe(true);
        expect(internals?.ariaInvalid).toBe("true");
        expectInternalsElements(internals?.ariaDescribedByElements, error);

        radio.invalid = false;
        await nextFrame();
        await nextFrame();

        expect(radio.shadowRoot?.querySelector(".error")).toBeNull();
        expect(supportingEl?.hasAttribute("hidden")).toBe(false);
        expect(internals?.ariaInvalid).toBe("false");
        expectInternalsElements(internals?.ariaDescribedByElements, supportingEl);
      } finally {
        spy.mockRestore();
      }
    });

    it("suppresses the error message while disabled or group-disabled and reveals inline errors", async () => {
      const radio = await renderRadio({
        inline: true,
        ariaLabel: "Direct seed",
      });
      radio.errorText = "Not available for this crop.";
      radio.invalid = true;
      await nextFrame();
      await nextFrame();

      expect(radio.shadowRoot?.querySelector(".content")?.hasAttribute("hidden")).toBe(false);
      expect(radio.shadowRoot?.querySelector(".error")?.textContent?.trim()).toBe(
        "Not available for this crop.",
      );

      radio.setGroupDisabled(true);
      await nextFrame();
      expect(radio.shadowRoot?.querySelector(".error")).toBeNull();
      expect(radio.shadowRoot?.querySelector(".content")?.hasAttribute("hidden")).toBe(true);

      radio.setGroupDisabled(false);
      await nextFrame();
      expect(radio.shadowRoot?.querySelector(".error")?.textContent?.trim()).toBe(
        "Not available for this crop.",
      );

      radio.disabled = true;
      await nextFrame();
      expect(radio.shadowRoot?.querySelector(".error")).toBeNull();
    });

    it("suppresses the error message inside a disabled fieldset except within its first legend", async () => {
      document.body.innerHTML = "";
      const fieldset = document.createElement("fieldset");
      fieldset.disabled = true;
      const legend = document.createElement("legend");

      const legendRadio = document.createElement("violet-radio") as VioletRadio;
      legendRadio.textContent = "Legend choice";
      legendRadio.errorText = "Legend error.";
      legendRadio.invalid = true;
      legend.append(legendRadio);

      const bodyRadio = document.createElement("violet-radio") as VioletRadio;
      bodyRadio.textContent = "Body choice";
      const supporting = document.createElement("span");
      supporting.slot = "supporting";
      supporting.textContent = "Helper.";
      bodyRadio.append(supporting);
      bodyRadio.errorText = "Body error.";
      bodyRadio.invalid = true;

      fieldset.append(legend, bodyRadio);
      document.body.append(fieldset);
      await customElements.whenDefined("violet-radio");
      await nextFrame();
      await nextFrame();

      expect(legendRadio.effectiveDisabled).toBe(false);
      expect(legendRadio.shadowRoot?.querySelector(".error")?.textContent?.trim()).toBe(
        "Legend error.",
      );
      expect(bodyRadio.effectiveDisabled).toBe(true);
      expect(bodyRadio.shadowRoot?.querySelector(".error")).toBeNull();
      expect(bodyRadio.shadowRoot?.querySelector(".supporting")?.hasAttribute("hidden")).toBe(
        false,
      );

      fieldset.disabled = false;
      await nextFrame();
      await nextFrame();

      expect(bodyRadio.effectiveDisabled).toBe(false);
      expect(bodyRadio.shadowRoot?.querySelector(".error")?.textContent?.trim()).toBe(
        "Body error.",
      );
      expect(bodyRadio.shadowRoot?.querySelector(".supporting")?.hasAttribute("hidden")).toBe(true);

      fieldset.disabled = true;
      await nextFrame();
      await nextFrame();

      expect(bodyRadio.effectiveDisabled).toBe(true);
      expect(bodyRadio.shadowRoot?.querySelector(".error")).toBeNull();
    });

    it("preserves host aria-describedby by linking shadow errors via ariaErrorMessageElements", async () => {
      const originalAttachInternals = HTMLElement.prototype.attachInternals;
      const captured: ElementInternals[] = [];
      const spy = vi.spyOn(HTMLElement.prototype, "attachInternals").mockImplementation(function (
        this: HTMLElement,
      ) {
        const attached = originalAttachInternals.call(this);
        if (this.tagName.toLowerCase() === "violet-radio") {
          captured.push(attached);
        }
        return attached;
      });

      try {
        const radio = await renderRadio({ label: "Direct seed" });
        const internals = captured[0];
        const hostHint = document.createElement("p");
        hostHint.id = "radio-host-hint";
        hostHint.textContent = "Applies to this season.";
        document.body.prepend(hostHint);
        radio.setAttribute("aria-describedby", "radio-host-hint");
        radio.errorText = "Choose an eligible option.";
        radio.invalid = true;
        await nextFrame();
        await nextFrame();

        const error = radio.shadowRoot?.querySelector(
          '[part~="error-message"]',
        ) as HTMLElement | null;
        expect(radio.getAttribute("aria-describedby")).toBe("radio-host-hint");
        expect(internals?.ariaDescribedByElements).toBeNull();
        expectInternalsElements(internals?.ariaErrorMessageElements, error);

        radio.invalid = false;
        await nextFrame();
        await nextFrame();
        expect(internals?.ariaErrorMessageElements).toBeNull();

        radio.invalid = true;
        radio.removeAttribute("aria-describedby");
        await nextFrame();
        await nextFrame();
        const restoredError = radio.shadowRoot?.querySelector(
          '[part~="error-message"]',
        ) as HTMLElement | null;
        expectInternalsElements(internals?.ariaDescribedByElements, restoredError);
        expect(internals?.ariaErrorMessageElements).toBeNull();
      } finally {
        spy.mockRestore();
      }
    });

    it("keeps displayErrorText read-only", async () => {
      const radio = await renderRadio({ label: "Direct seed" });
      const descriptor = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(radio),
        "displayErrorText",
      );
      expect(descriptor?.set).toBeUndefined();
    });
  });

  it("includes the label's longest word in its minimum width inside a table cell (#1579)", async () => {
    document.body.innerHTML = `
            <table style="width: 1px;">
                <tr>
                    <td><violet-radio id="rd" value="archived">Include archived items</violet-radio></td>
                </tr>
            </table>
        `;
    await customElements.whenDefined("violet-radio");
    await nextFrame();

    const radio = document.getElementById("rd") as VioletRadio;
    const hostRect = radio.getBoundingClientRect();
    const label = radio.shadowRoot?.querySelector(".label") as HTMLElement;
    const control = radio.shadowRoot?.querySelector(".control-shell") as HTMLElement;

    expect(hostRect.width).toBeGreaterThan(control.getBoundingClientRect().width + 30);
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1);
  });
});
