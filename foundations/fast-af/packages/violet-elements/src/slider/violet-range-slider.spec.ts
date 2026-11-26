import { afterEach, describe, expect, it } from "vitest";

import "./violet-range-slider.define";
import type { VioletRangeSlider } from "./violet-range-slider";

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
});
