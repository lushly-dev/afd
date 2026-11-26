import { afterEach, describe, expect, it } from "vitest";
import { cdp, server } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "./violet-carousel.define";
import type { VioletCarousel } from "./violet-carousel";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function renderCarousel(markup?: string): Promise<VioletCarousel> {
  document.body.innerHTML =
    markup ??
    `
            <violet-carousel label="Test carousel">
                <section data-label="Slide one">Slide one</section>
                <section data-label="Slide two">Slide two</section>
                <section data-label="Slide three">Slide three</section>
            </violet-carousel>
        `;

  await customElements.whenDefined("violet-carousel");
  await nextFrame();
  await nextFrame();

  return document.querySelector("violet-carousel") as VioletCarousel;
}

describe("violet-carousel", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders pager dots for each slotted slide", async () => {
    const carousel = await renderCarousel();

    const dots = carousel.shadowRoot?.querySelectorAll(".dot");
    expect(dots?.length).toBe(3);
  });

  it("updates the active slide when next is clicked", async () => {
    const carousel = await renderCarousel();

    let emittedIndex = -1;
    carousel.addEventListener("slide-change", (event) => {
      emittedIndex = (event as CustomEvent<{ activeIndex: number }>).detail.activeIndex;
    });

    const nextButton = carousel.shadowRoot?.querySelector(
      "[part='next-button']",
    ) as HTMLButtonElement | null;
    nextButton?.click();
    await nextFrame();

    expect(carousel.activeIndex).toBe(1);
    expect(emittedIndex).toBe(1);
  });

  it("marks inactive slides inert and hidden", async () => {
    const carousel = await renderCarousel();
    const slides = Array.from(carousel.children) as HTMLElement[];

    expect(slides[0]?.hasAttribute("inert")).toBe(false);
    expect(slides[0]?.getAttribute("aria-hidden")).toBe("false");

    expect(slides[1]?.hasAttribute("inert")).toBe(true);
    expect(slides[1]?.getAttribute("aria-hidden")).toBe("true");
  });

  it("wraps to the first slide when loop is enabled", async () => {
    const carousel = await renderCarousel(`
            <violet-carousel label="Looping carousel" active-index="2" loop>
                <section data-label="Slide one">Slide one</section>
                <section data-label="Slide two">Slide two</section>
                <section data-label="Slide three">Slide three</section>
            </violet-carousel>
        `);

    const nextButton = carousel.shadowRoot?.querySelector(
      "[part='next-button']",
    ) as HTMLButtonElement | null;
    nextButton?.click();
    await nextFrame();

    expect(carousel.activeIndex).toBe(0);
  });

  it("supports multiple visible slides with a clamped leading index", async () => {
    const carousel = await renderCarousel(`
            <violet-carousel label="Card strip" slides-per-view="2" active-index="2">
                <section data-label="Slide one">Slide one</section>
                <section data-label="Slide two">Slide two</section>
                <section data-label="Slide three">Slide three</section>
            </violet-carousel>
        `);

    expect(carousel.activeIndex).toBe(1);
    expect(carousel.style.getPropertyValue("--_carousel-slides-per-view")).toBe("2");

    const slides = Array.from(carousel.children) as HTMLElement[];
    expect(slides[0]?.hasAttribute("inert")).toBe(true);
    expect(slides[1]?.hasAttribute("inert")).toBe(false);
    expect(slides[2]?.hasAttribute("inert")).toBe(false);
  });

  it("renders pager dots per reachable page in multi-card mode", async () => {
    const carousel = await renderCarousel(`
            <violet-carousel label="Card strip" slides-per-view="2">
                <section data-label="Slide one">Slide one</section>
                <section data-label="Slide two">Slide two</section>
                <section data-label="Slide three">Slide three</section>
            </violet-carousel>
        `);

    const dots = carousel.shadowRoot?.querySelectorAll(".dot");
    expect(dots?.length).toBe(2);
  });

  it("hides controls when all slides are already visible", async () => {
    const carousel = await renderCarousel(`
            <violet-carousel label="Fully visible strip" slides-per-view="2">
                <section data-label="Slide one">Slide one</section>
                <section data-label="Slide two">Slide two</section>
            </violet-carousel>
        `);

    const controls = carousel.shadowRoot?.querySelector(".controls") as HTMLElement | null;
    expect(controls?.hidden).toBe(true);
  });

  describe("native key handling", () => {
    it("does not cancel Tab, but cancels arrow navigation", async () => {
      const carousel = await renderCarousel();
      const viewport = carousel.shadowRoot?.querySelector(".viewport") as HTMLElement;
      const press = (key: string) => {
        const event = new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          composed: true,
        });
        viewport.dispatchEvent(event);
        return event;
      };

      expect(press("Tab").defaultPrevented).toBe(false);
      expect(press("a").defaultPrevented).toBe(false);
      expect(press("ArrowRight").defaultPrevented).toBe(true);
    });
  });

  if (isChromium)
    describe("coarse pointer sizing (#1569)", () => {
      async function emulateCoarsePointer(coarse: boolean): Promise<void> {
        const session = cdp() as unknown as {
          send(method: string, params?: object): Promise<unknown>;
        };
        if (coarse) {
          await session.send("Emulation.setTouchEmulationEnabled", {
            enabled: true,
            maxTouchPoints: 1,
          });
          await session.send("Emulation.setDeviceMetricsOverride", {
            width: 390,
            height: 844,
            deviceScaleFactor: 2,
            mobile: true,
          });
        } else {
          await session.send("Emulation.setTouchEmulationEnabled", { enabled: false });
          await session.send("Emulation.clearDeviceMetricsOverride");
        }
      }

      afterEach(async () => {
        await emulateCoarsePointer(false);
      });

      it("grows the carousel controls to the comfortable target size on coarse pointers", async () => {
        const carousel = await renderCarousel();
        const dot = carousel.shadowRoot?.querySelector(".dot") as HTMLButtonElement;
        const nextControl = carousel.shadowRoot
          ?.querySelector(".next-button")
          ?.shadowRoot?.querySelector("button") as HTMLButtonElement;

        expect(matchMedia("(any-pointer: coarse)").matches).toBe(false);
        expect(getComputedStyle(carousel).getPropertyValue("--_target-size").trim()).toBe("32px");
        expect(dot.getBoundingClientRect().width).toBeCloseTo(24, 0);
        expect(dot.getBoundingClientRect().height).toBeCloseTo(24, 0);
        expect(nextControl.getBoundingClientRect().height).toBeCloseTo(32, 0);

        await emulateCoarsePointer(true);
        await nextFrame();

        expect(matchMedia("(any-pointer: coarse)").matches).toBe(true);
        expect(getComputedStyle(carousel).getPropertyValue("--_target-size").trim()).toBe("44px");
        expect(dot.getBoundingClientRect().width).toBeCloseTo(44, 0);
        expect(dot.getBoundingClientRect().height).toBeCloseTo(44, 0);
        expect(nextControl.getBoundingClientRect().height).toBeCloseTo(44, 0);

        // An explicit --violet-target-size override still wins on coarse pointers.
        carousel.style.setProperty("--violet-target-size", "24px");
        await nextFrame();
        expect(getComputedStyle(carousel).getPropertyValue("--_target-size").trim()).toBe("24px");
        expect(dot.getBoundingClientRect().width).toBeCloseTo(24, 0);
        expect(dot.getBoundingClientRect().height).toBeCloseTo(24, 0);
      });
    });
});
