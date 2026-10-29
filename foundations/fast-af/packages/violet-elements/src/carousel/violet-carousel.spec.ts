import { afterEach, describe, expect, it } from "vitest";

import "./violet-carousel";
import type { VioletCarousel } from "./violet-carousel";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
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
        carousel.addEventListener("slide-change", event => {
            emittedIndex = (event as CustomEvent<{ activeIndex: number }>).detail.activeIndex;
        });

        const nextButton = carousel.shadowRoot?.querySelector("[part='next-button']") as HTMLButtonElement | null;
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

        const nextButton = carousel.shadowRoot?.querySelector("[part='next-button']") as HTMLButtonElement | null;
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
                const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true });
                viewport.dispatchEvent(event);
                return event;
            };

            expect(press("Tab").defaultPrevented).toBe(false);
            expect(press("a").defaultPrevented).toBe(false);
            expect(press("ArrowRight").defaultPrevented).toBe(true);
        });
    });
});
