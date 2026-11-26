import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-slider.define";
import type { VioletSlider } from "./violet-slider";

/** Layout positions round to device pixels, so geometry is compared to within one pixel. */
function expectWithinPixel(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function renderSlider(
  options: {
    value?: string;
    min?: string;
    max?: string;
    step?: string;
    orientation?: "horizontal" | "vertical";
    invalid?: boolean;
    errorText?: string;
  } = {},
): Promise<VioletSlider> {
  document.body.innerHTML = "";

  const slider = document.createElement("violet-slider") as VioletSlider;
  slider.label = "Moisture threshold";
  slider.supportingText = "Adjust irrigation automation.";
  slider.value = options.value ?? "50";
  slider.min = options.min ?? "0";
  slider.max = options.max ?? "100";
  slider.step = options.step ?? "5";
  slider.orientation = options.orientation ?? "horizontal";
  slider.invalid = options.invalid ?? false;
  slider.errorText = options.errorText ?? "";

  document.body.append(slider);

  await customElements.whenDefined("violet-slider");
  await nextFrame();

  return slider;
}

describe("violet-slider", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("normalizes programmatic values against min, max, and step", async () => {
    const slider = await renderSlider({
      value: "43",
      min: "10",
      max: "90",
      step: "10",
    });

    expect(slider.value).toBe("40");
    expect(slider.controlStyle).toContain("--_slider-percent");
  });

  it("updates value from the native range input and emits commit state", async () => {
    const slider = await renderSlider();
    const input = slider.shadowRoot?.querySelector(
      'input[type="range"]',
    ) as HTMLInputElement | null;

    input!.value = "70";
    input?.dispatchEvent(new Event("input", { bubbles: true }));
    await nextFrame();

    expect(slider.value).toBe("70");

    input!.value = "80";
    input?.dispatchEvent(new Event("change", { bubbles: true }));
    await nextFrame();

    expect(slider.value).toBe("80");
  });

  it("wires vertical orientation and visible error semantics to the native input", async () => {
    const slider = await renderSlider({
      orientation: "vertical",
      invalid: true,
      errorText: "Keep moisture within the target band.",
    });

    const input = slider.shadowRoot?.querySelector(
      'input[type="range"]',
    ) as HTMLInputElement | null;

    expect(input?.getAttribute("aria-orientation")).toBe("vertical");
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(input?.getAttribute("aria-describedby")).toBe(slider.errorTextId);
    expect(slider.shadowRoot?.getElementById(slider.supportingTextId)).toBeNull();
    expect(slider.shadowRoot?.getElementById(slider.errorTextId)?.getAttribute("role")).toBe(
      "alert",
    );
  });

  describe("in right-to-left", () => {
    async function renderRtl(
      value: string,
    ): Promise<{ slider: VioletSlider; input: HTMLInputElement }> {
      const slider = await renderSlider({ value });
      slider.setAttribute("dir", "rtl");
      await nextFrame();
      return { slider, input: slider.shadowRoot?.querySelector(".input") as HTMLInputElement };
    }

    it("moves the value in the visual direction of the arrow keys", async () => {
      const { slider, input } = await renderRtl("50");
      input.focus();

      await userEvent.keyboard("{ArrowRight}");
      expect(slider.value).toBe("45");

      await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
      expect(slider.value).toBe("55");
    });

    it("mirrors the fill and centres the thumb on the value measured from the right", async () => {
      const { slider } = await renderRtl("25");
      const visual = slider.shadowRoot?.querySelector(".visual") as HTMLElement;
      const fill = slider.shadowRoot?.querySelector(".fill") as HTMLElement;
      const thumb = slider.shadowRoot?.querySelector(".thumb") as HTMLElement;
      const box = visual.getBoundingClientRect();
      const rail =
        (
          slider.shadowRoot?.querySelector(".rail") as HTMLElement | null
        )?.getBoundingClientRect() ?? new DOMRect();
      const thumbBox = thumb.getBoundingClientRect();

      expectWithinPixel(fill.getBoundingClientRect().right, rail.right);
      expectWithinPixel(fill.getBoundingClientRect().width, rail.width * 0.25);
      expectWithinPixel(thumbBox.left + thumbBox.width / 2, box.right - box.width * 0.25);
    });

    it("reads a pointer position from the right edge", async () => {
      const { slider, input } = await renderRtl("50");
      const rect = input.getBoundingClientRect();
      const pointer = {
        bubbles: true,
        composed: true,
        pointerId: 3,
        pointerType: "mouse",
        button: 0,
      };
      const clientX = rect.right - rect.width * 0.2;
      const clientY = rect.top + rect.height / 2;

      input.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, clientX, clientY }));
      document.dispatchEvent(new PointerEvent("pointerup", { ...pointer, clientX, clientY }));

      expect(slider.value).toBe("20");
    });
  });
});
