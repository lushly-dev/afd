import { afterEach, describe, expect, it } from "vitest";
import { cdp, server } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "./violet-progress.define";
import type { VioletProgress } from "./violet-progress";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function renderProgress(
  template = `<violet-progress label="Uploading field imagery" value="48" max="100"></violet-progress>`,
): Promise<VioletProgress> {
  document.body.innerHTML = template;
  await customElements.whenDefined("violet-progress");
  await nextFrame();
  return document.querySelector("violet-progress") as VioletProgress;
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

describe("violet-progress", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a determinate native progress element named by its label", async () => {
    const progress = await renderProgress();
    const native = progress.shadowRoot?.querySelector("progress") as HTMLProgressElement | null;
    const label = progress.shadowRoot?.querySelector(".label") as HTMLElement | null;

    expect(label?.id).toBe(progress.labelId);
    expect(label?.textContent?.trim()).toBe("Uploading field imagery");
    expect(native?.getAttribute("aria-labelledby")).toBe(progress.labelId);
    expect(native?.hasAttribute("aria-label")).toBe(false);
    expect(native?.getAttribute("value")).toBe("48");
    expect(progress.shadowRoot?.querySelector(".value-label")?.textContent?.trim()).toBe("48%");
  });

  it("falls back to aria-label='Progress' when no label is set, and toggles cleanly", async () => {
    const progress = await renderProgress(
      `<violet-progress value="25" max="100"></violet-progress>`,
    );
    const native = progress.shadowRoot?.querySelector("progress") as HTMLProgressElement | null;

    expect(progress.shadowRoot?.querySelector(".label")).toBeNull();
    expect(native?.hasAttribute("aria-labelledby")).toBe(false);
    expect(native?.getAttribute("aria-label")).toBe("Progress");

    progress.label = "Syncing records";
    await nextFrame();
    const label = progress.shadowRoot?.querySelector(".label") as HTMLElement | null;
    expect(label?.id).toBe(progress.labelId);
    expect(native?.getAttribute("aria-labelledby")).toBe(progress.labelId);
    expect(native?.hasAttribute("aria-label")).toBe(false);

    progress.label = "";
    await nextFrame();
    expect(native?.hasAttribute("aria-labelledby")).toBe(false);
    expect(native?.getAttribute("aria-label")).toBe("Progress");

    progress.label = "   ";
    await nextFrame();
    expect(progress.shadowRoot?.querySelector(".label")).toBeNull();
    expect(native?.hasAttribute("aria-labelledby")).toBe(false);
    expect(native?.getAttribute("aria-label")).toBe("Progress");
  });

  it("assigns distinct label ids to multiple progress bars on one page", async () => {
    document.body.innerHTML = `
            <violet-progress label="First upload" value="20"></violet-progress>
            <violet-progress label="Second upload" value="80"></violet-progress>
        `;
    await customElements.whenDefined("violet-progress");
    await nextFrame();
    const [first, second] = Array.from(
      document.querySelectorAll("violet-progress"),
    ) as VioletProgress[];
    expect(first.labelId).not.toBe(second.labelId);
    expect(first.shadowRoot?.querySelector("progress")?.getAttribute("aria-labelledby")).toBe(
      first.labelId,
    );
    expect(second.shadowRoot?.querySelector("progress")?.getAttribute("aria-labelledby")).toBe(
      second.labelId,
    );
  });

  it("has a fill colour with no theme installed", async () => {
    const progress = await renderProgress();
    expect(
      getComputedStyle(progress).getPropertyValue("--_progress-fill").trim().toLowerCase(),
    ).toBe("#1b5f80");
  });

  it("omits the value attribute for indeterminate progress", async () => {
    const progress = await renderProgress(
      `<violet-progress label="Loading summary" value=""></violet-progress>`,
    );
    const native = progress.shadowRoot?.querySelector("progress") as HTMLProgressElement | null;

    expect(native?.hasAttribute("value")).toBe(false);
    expect(progress.shadowRoot?.querySelector(".value-label")).toBeNull();
  });

  it("passes custom value text through to accessibility APIs", async () => {
    const progress = await renderProgress(
      `<violet-progress label="Irrigation capacity" value="2" max="4" value-text="Half capacity"></violet-progress>`,
    );
    const native = progress.shadowRoot?.querySelector("progress") as HTMLProgressElement | null;

    expect(native?.getAttribute("aria-valuetext")).toBe("Half capacity");
    expect(progress.shadowRoot?.querySelector(".value-label")?.textContent?.trim()).toBe("50%");
  });

  if (isChromium)
    describe("under reduced motion", () => {
      afterEach(async () => {
        await emulateMedia({ reducedMotion: false });
      });

      // #1583: the indeterminate bar kept sliding, only slower.
      for (const forcedColors of [false, true]) {
        it(`stops the indeterminate bar sliding${forcedColors ? " under forced colours" : ""}`, async () => {
          await emulateMedia({ reducedMotion: true, forcedColors });
          const progress = await renderProgress(
            `<violet-progress label="Loading summary" value=""></violet-progress>`,
          );
          const track = progress.shadowRoot?.querySelector(".progress") as HTMLElement;
          const bar = getComputedStyle(track, "::before");

          expect(matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(true);
          expect(bar.animationName).toBe("indeterminate-pulse");
          expect(bar.insetInlineStart).toBe("0px");
          // The whole track: the padding box, inside the border forced colours draw.
          expect(bar.inlineSize).toBe(`${track.clientWidth}px`);
          const keyframes = track
            .getAnimations({ subtree: true })
            .flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes());
          expect(keyframes.length).toBeGreaterThan(0);
          for (const frame of keyframes) {
            expect(
              Object.keys(frame).filter(
                (key) => !["offset", "easing", "composite", "computedOffset"].includes(key),
              ),
            ).toEqual(["opacity"]);
            // Never so faint that a Highlight fill on Canvas loses its contrast.
            expect(Number(frame.opacity)).toBeGreaterThanOrEqual(0.75);
          }
        });
      }

      it("keeps the bar sliding when motion is allowed", async () => {
        await emulateMedia({ reducedMotion: false });
        const progress = await renderProgress(
          `<violet-progress label="Loading summary" value=""></violet-progress>`,
        );
        const track = progress.shadowRoot?.querySelector(".progress") as HTMLElement;
        expect(getComputedStyle(track, "::before").animationName).toBe("indeterminate-slide");
      });
    });
});
