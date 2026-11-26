import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-range-slider.define";
import type { VioletRangeSlider } from "./violet-range-slider";

/** Layout positions round to device pixels, so geometry is compared to within one pixel. */
function expectWithinPixel(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/** The text a thumb's aria-labelledby names, in order, as its accessible name is built. */
function thumbName(slider: VioletRangeSlider, thumb: "start" | "end"): string {
  const root = slider.shadowRoot as ShadowRoot;
  const input = root.querySelector(`.input-${thumb}`) as HTMLInputElement;
  expect(input.hasAttribute("aria-label")).toBe(false);
  return (input.getAttribute("aria-labelledby") ?? "")
    .split(" ")
    .map((id) => root.getElementById(id)?.textContent?.trim() ?? `missing #${id}`)
    .join(" ");
}

async function renderRangeSlider(markup: string): Promise<VioletRangeSlider> {
  document.body.innerHTML = markup;
  await customElements.whenDefined("violet-range-slider");
  await nextFrame();
  return document.querySelector("violet-range-slider") as VioletRangeSlider;
}

describe("violet-range-slider", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("names each thumb with the visible label followed by its own label", async () => {
    const slider = await renderRangeSlider(
      `<violet-range-slider label="Price"></violet-range-slider>`,
    );
    expect(thumbName(slider, "start")).toBe("Price Minimum");
    expect(thumbName(slider, "end")).toBe("Price Maximum");

    slider.labelStart = "From";
    slider.labelEnd = "To";
    await nextFrame();
    expect(thumbName(slider, "start")).toBe("Price From");
    expect(thumbName(slider, "end")).toBe("Price To");
  });

  it("names each thumb by its own label when there is no visible label", async () => {
    const slider = await renderRangeSlider(`<violet-range-slider></violet-range-slider>`);
    expect(thumbName(slider, "start")).toBe("Minimum");
    expect(thumbName(slider, "end")).toBe("Maximum");
  });

  describe("in right-to-left", () => {
    async function renderRtl(): Promise<VioletRangeSlider> {
      return renderRangeSlider(
        `<div dir="rtl"><violet-range-slider label="Band" value-start="20" value-end="70" step="5"></violet-range-slider></div>`,
      );
    }

    function part(slider: VioletRangeSlider, selector: string): HTMLElement {
      return slider.shadowRoot?.querySelector(selector) as HTMLElement;
    }

    it("moves each thumb in the visual direction of the arrow keys", async () => {
      const slider = await renderRtl();

      part(slider, ".input-start").focus();
      await userEvent.keyboard("{ArrowLeft}");
      expect(slider.valueStart).toBe("25");

      part(slider, ".input-end").focus();
      await userEvent.keyboard("{ArrowRight}");
      expect(slider.valueEnd).toBe("65");
    });

    it("mirrors the fill and places the start thumb on the right", async () => {
      const slider = await renderRtl();
      const box = part(slider, ".visual").getBoundingClientRect();
      const centre = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return rect.left + rect.width / 2;
      };

      expectWithinPixel(centre(part(slider, ".thumb-start")), box.right - box.width * 0.2);
      expectWithinPixel(centre(part(slider, ".thumb-end")), box.right - box.width * 0.7);
      const fill = part(slider, ".fill").getBoundingClientRect();
      expectWithinPixel(fill.right, box.right - box.width * 0.2);
      expectWithinPixel(fill.left, box.right - box.width * 0.7);
    });

    it("gives each thumb's input the half of the track its thumb is on", async () => {
      const slider = await renderRtl();
      const box = part(slider, ".control-shell").getBoundingClientRect();
      const y = box.top + box.height / 2;
      const hit = (ratioFromRight: number) =>
        slider.shadowRoot?.elementFromPoint(box.right - box.width * ratioFromRight, y);

      expect(hit(0.1)).toBe(part(slider, ".input-start"));
      expect(hit(0.9)).toBe(part(slider, ".input-end"));
    });

    it("reads a pointer position from the right edge", async () => {
      const slider = await renderRtl();
      const input = part(slider, ".input-start");
      const rect = input.getBoundingClientRect();
      const pointer = {
        bubbles: true,
        composed: true,
        pointerId: 5,
        pointerType: "mouse",
        button: 0,
      };
      const clientX = rect.right - rect.width * 0.1;
      const clientY = rect.top + rect.height / 2;

      input.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, clientX, clientY }));
      document.dispatchEvent(new PointerEvent("pointerup", { ...pointer, clientX, clientY }));

      expect(slider.valueStart).toBe("10");
    });
  });
});
