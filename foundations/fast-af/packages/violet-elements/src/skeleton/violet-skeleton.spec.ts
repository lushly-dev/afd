import { afterEach, describe, expect, it } from "vitest";
import { cdp, server } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "./violet-skeleton.define";
import type { VioletSkeleton } from "./violet-skeleton";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function renderSkeleton(): Promise<VioletSkeleton> {
  document.body.innerHTML = "";
  const skeleton = document.createElement("violet-skeleton") as VioletSkeleton;
  document.body.append(skeleton);
  await customElements.whenDefined("violet-skeleton");
  await nextFrame();
  return skeleton;
}

/**
 * Emulates reduced motion, with a dark forced-colours theme when asked, or restores the media
 * Playwright emulates by default, so later spec files on the page do not follow the host.
 */
async function emulateMedia(media: {
  reducedMotion: boolean;
  forcedColors?: boolean;
}): Promise<void> {
  const session = cdp() as unknown as { send(method: string, params?: object): Promise<unknown> };
  await session.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "forced-colors", value: media.forcedColors ? "active" : "none" },
      { name: "prefers-color-scheme", value: media.forcedColors ? "dark" : "light" },
      { name: "prefers-reduced-motion", value: media.reducedMotion ? "reduce" : "no-preference" },
      { name: "prefers-contrast", value: "no-preference" },
    ],
  });
}

describe("violet-skeleton", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is hidden from assistive technology by default", async () => {
    const skeleton = await renderSkeleton();
    expect(skeleton.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders multiple bars for text-line placeholders", async () => {
    const skeleton = await renderSkeleton();
    skeleton.shape = "text";
    skeleton.lines = "3";
    await nextFrame();

    const bars = skeleton.shadowRoot?.querySelectorAll(".bar");
    expect(bars?.length).toBe(3);
  });

  if (isChromium)
    describe("under reduced motion", () => {
      afterEach(async () => {
        await emulateMedia({ reducedMotion: false });
      });

      // #1583: the shimmer kept running, only slower.
      for (const forcedColors of [false, true]) {
        it(`stops the shimmer${forcedColors ? " under forced colours" : ""}`, async () => {
          await emulateMedia({ reducedMotion: true, forcedColors });
          const skeleton = await renderSkeleton();
          skeleton.animated = true;
          skeleton.shape = "text";
          skeleton.lines = "3";
          await nextFrame();

          expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
          const bars = [...(skeleton.shadowRoot?.querySelectorAll(".bar") ?? [])] as HTMLElement[];
          expect(bars.length).toBe(3);
          for (const bar of bars) {
            expect(getComputedStyle(bar, "::after").animationName).toBe("none");
            expect(getComputedStyle(bar, "::after").display).toBe("none");
          }
          expect(skeleton.shadowRoot?.getAnimations()).toEqual([]);
        });
      }

      it("shimmers when motion is allowed", async () => {
        await emulateMedia({ reducedMotion: false });
        const skeleton = await renderSkeleton();
        skeleton.animated = true;
        await nextFrame();
        const bar = skeleton.shadowRoot?.querySelector(".bar") as HTMLElement;
        expect(getComputedStyle(bar, "::after").animationName).toBe("shimmer");
      });
    });
});
