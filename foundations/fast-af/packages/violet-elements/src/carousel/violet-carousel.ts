import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import { registerSystemChevronRightIcon } from "../icon/generated";
import "../icon/violet-icon";
import "../icon-button/violet-icon-button";
import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";
import { logicalArrowKey } from "../foundations/violet-direction";

type VioletCarouselSlide = {
    index: number;
    label: string;
};

const integerConverter = {
    fromView(value: string): number {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : 0;
    },
    toView(value: number): string {
        return String(value);
    },
};

function readIntegerAttribute(element: HTMLElement, name: string, fallback: number): number {
    const raw = element.getAttribute(name);
    if (!raw) {
        return fallback;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

registerSystemChevronRightIcon();

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        min-inline-size: 0;
        color: var(--_text-primary);

        --_carousel-gap: var(--_space-md);
        --_carousel-slide-gap: var(--_space-sm);
        --_carousel-slides-per-view: 1;
        --_carousel-radius: calc(var(--_radius-md) * 2);
        --_carousel-surface: var(--_surface-card);
        --_carousel-border: var(--_border-subtle);
        --_carousel-shadow: var(--_shadow-card);
        --_carousel-dot-size: 0.625rem;
        --_carousel-dot-active: var(--color-state-success-foreground, #245c36);
        --_carousel-dot-idle: color-mix(in srgb, var(--_text-muted) 32%, transparent);
    }

    :host([appearance="plain"]) {
        --_carousel-surface: transparent;
        --_carousel-border: transparent;
        --_carousel-shadow: none;
    }

    .root {
        display: grid;
        gap: var(--_carousel-gap);
    }

    .viewport {
        box-sizing: border-box;
        overflow-x: auto;
        overflow-y: hidden;
        min-inline-size: 0;
        border: 1px solid var(--_carousel-border);
        border-radius: var(--_carousel-radius);
        background: var(--_carousel-surface);
        box-shadow: var(--_carousel-shadow);
        scroll-behavior: smooth;
        scroll-snap-type: x mandatory;
        scrollbar-width: none;
        overscroll-behavior-x: contain;
        -webkit-overflow-scrolling: touch;
    }

    .viewport::-webkit-scrollbar {
        display: none;
    }

    .viewport:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: 2px;
    }

    .track {
        display: block;
        min-inline-size: 0;
    }

    .slides {
        display: flex;
        gap: var(--_carousel-slide-gap);
        min-inline-size: 100%;
    }

    ::slotted(*) {
        box-sizing: border-box;
        flex: 0 0 calc((100% - (var(--_carousel-slide-gap) * (var(--_carousel-slides-per-view) - 1))) / var(--_carousel-slides-per-view));
        min-inline-size: calc((100% - (var(--_carousel-slide-gap) * (var(--_carousel-slides-per-view) - 1))) / var(--_carousel-slides-per-view));
        inline-size: calc((100% - (var(--_carousel-slide-gap) * (var(--_carousel-slides-per-view) - 1))) / var(--_carousel-slides-per-view));
        scroll-snap-align: start;
        scroll-snap-stop: always;
    }

    .controls {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--_space-sm);
        min-inline-size: 0;
    }

    .controls[hidden],
    .pagination[hidden],
    .status[hidden] {
        display: none;
    }

    .previous-button violet-icon {
        transform: rotate(180deg);
    }

    .pagination {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--_space-sm);
        min-inline-size: 0;
        flex-wrap: wrap;
    }

    .dot {
        box-sizing: border-box;
        inline-size: calc(var(--_target-size) * 0.75);
        block-size: calc(var(--_target-size) * 0.75);
        min-inline-size: calc(var(--_target-size) * 0.75);
        min-block-size: calc(var(--_target-size) * 0.75);
        padding: 0;
        border: 0;
        border-radius: var(--_radius-round);
        background: transparent;
        color: inherit;
        display: inline-grid;
        place-items: center;
        cursor: pointer;
    }

    .dot::before {
        content: "";
        inline-size: var(--_carousel-dot-size);
        block-size: var(--_carousel-dot-size);
        border-radius: var(--_radius-round);
        background: var(--_carousel-dot-idle);
        transition:
            transform var(--_duration-fast) var(--_easing-standard),
            background-color var(--_duration-fast) var(--_easing-standard);
    }

    .dot:hover::before {
        transform: scale(1.08);
    }

    .dot[aria-pressed="true"]::before {
        background: var(--_carousel-dot-active);
        transform: scale(1.2);
    }

    .dot:focus-visible {
        outline: 2px solid var(--_focus-ring);
        outline-offset: 2px;
    }

    .sr-only {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
        border: 0;
    }

    @media (prefers-reduced-motion: reduce) {
        .viewport {
            scroll-behavior: auto;
        }
    }

    @media (forced-colors: active) {
        .viewport {
            forced-color-adjust: none;
            background: Canvas;
            border-color: ButtonText;
            box-shadow: none;
        }

        .dot::before {
            background: GrayText;
        }

        .dot[aria-pressed="true"]::before {
            background: Highlight;
        }
    }
`;

const template = html<VioletCarousel>`
    <section class="root" part="root" role="region" aria-roledescription="carousel" aria-label="${x => x.label}">
        <div
            class="viewport"
            part="viewport"
            tabindex="0"
            @scroll="${x => x.handleViewportScroll()}"
            @keydown="${(x, c) => x.handleViewportKeydown(c.event as KeyboardEvent)}"
        >
            <div class="track" part="track">
                <slot class="slides" @slotchange="${x => x.handleSlidesSlotChange()}"></slot>
            </div>
        </div>

        <div class="controls" part="controls">
            <violet-icon-button
                class="previous-button"
                part="previous-button"
                appearance="quiet"
                label="Previous slide"
                @click="${x => x.previous()}"
            >
                <violet-icon icon="system/chevron-right" decorative></violet-icon>
            </violet-icon-button>

            <div class="pagination" part="pagination" role="group" aria-label="${x => `${x.label} slide navigation`}"></div>

            <violet-icon-button
                class="next-button"
                part="next-button"
                appearance="quiet"
                label="Next slide"
                @click="${x => x.next()}"
            >
                <violet-icon icon="system/chevron-right" decorative></violet-icon>
            </violet-icon-button>
        </div>

        <div class="status sr-only" part="status" aria-live="polite" aria-atomic="true"></div>
    </section>
`;

/**
 * Slotted, manual carousel for horizontally paging arbitrary content.
 *
 * @summary Scroll-snap based carousel with generated previous/next controls, pager dots, and accessible current-slide announcements.
 * @fires slide-change - Emitted when the active slide changes. Detail: `{ activeIndex, slide }`.
 * @fires change - Emitted after the active slide changes.
 * @slot - Slide content. Each top-level slotted element becomes one slide.
 * @csspart root - Carousel region wrapper.
 * @csspart viewport - Scrollable slide viewport.
 * @csspart track - Inline track that holds the slides.
 * @csspart controls - Footer row containing navigation and pagination.
 * @csspart previous-button - Built-in previous-slide icon button.
 * @csspart next-button - Built-in next-slide icon button.
 * @csspart pagination - Dot navigation wrapper.
 * @csspart dot - Individual pager button.
 * @csspart status - Screen-reader-only current slide announcement.
 */
export class VioletCarousel extends FASTElement {
    @observable
    declare public slideCount: number;

    public slides: VioletCarouselSlide[];
    declare public appearance: "framed" | "plain";
    declare public label: string;
    declare public activeIndex: number;
    declare public slidesPerView: number;
    declare public loop: boolean;

    #connected = false;
    #syncingFromScroll = false;
    #scrollFrame = 0;

    public constructor() {
        super();
        this.slides = [];
        this.slideCount = 0;
        this.appearance = "framed";
        this.label = "Carousel";
        this.activeIndex = 0;
        this.slidesPerView = 1;
        this.loop = false;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.activeIndex = readIntegerAttribute(this, "active-index", this.activeIndex || 0);
        this.slidesPerView = readIntegerAttribute(this, "slides-per-view", this.slidesPerView || 1);

        requestAnimationFrame(() => {
            if (!this.isConnected) {
                return;
            }

            this.#connected = true;
            this.#syncSlides();
            this.#applyActiveState({ scroll: false, emit: false });
        });
    }

    public disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#connected = false;

        if (this.#scrollFrame) {
            cancelAnimationFrame(this.#scrollFrame);
            this.#scrollFrame = 0;
        }
    }

    public activeIndexChanged(): void {
        if (!this.#connected) {
            return;
        }

        this.#applyActiveState({
            scroll: !this.#syncingFromScroll,
            emit: true,
        });
    }

    public slidesPerViewChanged(): void {
        if (!this.#connected) {
            return;
        }

        this.#applyActiveState({
            scroll: false,
            emit: false,
        });
    }

    public handleSlidesSlotChange(): void {
        this.#syncSlides();
        this.#applyActiveState({ scroll: false, emit: false });
    }

    public handleViewportScroll(): void {
        if (this.#scrollFrame) {
            return;
        }

        this.#scrollFrame = requestAnimationFrame(() => {
            this.#scrollFrame = 0;
            const nextIndex = this.#getNearestSlideIndex();

            if (nextIndex === this.activeIndex) {
                return;
            }

            this.#syncingFromScroll = true;
            this.activeIndex = nextIndex;
            this.#syncingFromScroll = false;
        });
    }

    public handleViewportKeydown(event: KeyboardEvent): boolean {
        if (event.defaultPrevented || this.slides.length < 2) {
            return true;
        }

        switch (logicalArrowKey(event.key, this)) {
            case "ArrowRight":
                event.preventDefault();
                this.next();
                return false;
            case "ArrowLeft":
                event.preventDefault();
                this.previous();
                return false;
            case "Home":
                event.preventDefault();
                this.goTo(0);
                return false;
            case "End":
                event.preventDefault();
                this.goTo(this.#maxStartIndex);
                return false;
            default:
                return true;
        }
    }

    public goTo(index: number): void {
        const nextIndex = this.#clampIndex(index);
        if (nextIndex === this.activeIndex) {
            return;
        }

        this.activeIndex = nextIndex;
    }

    public next(): void {
        if (this.slides.length < 2) {
            return;
        }

        if (this.loop) {
            this.goTo((this.activeIndex + 1) % (this.#maxStartIndex + 1));
            return;
        }

        this.goTo(this.activeIndex + 1);
    }

    public previous(): void {
        if (this.slides.length < 2) {
            return;
        }

        if (this.loop) {
            this.goTo((this.activeIndex - 1 + this.#maxStartIndex + 1) % (this.#maxStartIndex + 1));
            return;
        }

        this.goTo(this.activeIndex - 1);
    }

    public get canGoPrevious(): boolean {
        return this.slideCount > 1 && (this.loop || this.activeIndex > 0);
    }

    public get canGoNext(): boolean {
        return this.slideCount > 1 && (this.loop || this.activeIndex < this.#maxStartIndex);
    }

    public get currentSlideStatus(): string {
        if (this.slideCount < 1) {
            return "";
        }

        const start = this.#clampIndex(this.activeIndex);
        const visibleCount = this.#normalizedSlidesPerView;
        const end = Math.min(this.slideCount, start + visibleCount);
        const current = this.slides[start];

        if (visibleCount === 1) {
            return `${current?.label ?? `Slide ${start + 1}`} (${start + 1} of ${this.slideCount})`;
        }

        return `Showing slides ${start + 1} through ${end} of ${this.slideCount}`;
    }

    #syncSlides(): void {
        const slides = this.slideElements;

        slides.forEach((slide, index) => {
            slide.dataset.carouselIndex = String(index);
            slide.dataset.carouselLabel = this.#resolveSlideLabel(slide, index);
        });

        this.slides = slides.map((slide, index) => ({
            index,
            label: slide.dataset.carouselLabel ?? `Slide ${index + 1}`,
        }));
        this.slideCount = this.slides.length;
        this.#renderPagination();
        this.#syncChromeState();
    }

    #applyActiveState(options: { scroll: boolean; emit: boolean }): void {
        const clamped = this.#clampIndex(this.activeIndex);
        if (clamped !== this.activeIndex) {
            this.activeIndex = clamped;
            return;
        }

        const slides = this.slideElements;
        const activeSlide = slides[clamped] ?? null;

        slides.forEach((slide, index) => {
            const isActive = index >= clamped && index < clamped + this.#normalizedSlidesPerView;
            slide.toggleAttribute("data-active", isActive);
            slide.toggleAttribute("inert", !isActive);
            slide.setAttribute("aria-hidden", String(!isActive));
        });

        this.#syncPaginationState();
        this.#syncChromeState();

        if (options.scroll && activeSlide) {
            this.#scrollToSlide(activeSlide);
        }

        if (options.emit && activeSlide) {
            this.$emit("slide-change", {
                activeIndex: clamped,
                slide: activeSlide,
            });
            this.$emit("change");
        }
    }

    #scrollToSlide(slide: HTMLElement): void {
        const viewport = this.viewportElement;
        if (!viewport) {
            return;
        }

        const left = slide.offsetLeft;

        if (typeof viewport.scrollTo === "function") {
            viewport.scrollTo({
                left,
                behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            });
            return;
        }

        viewport.scrollLeft = left;
    }

    #getNearestSlideIndex(): number {
        const viewport = this.viewportElement;
        const slides = this.slideElements;

        if (!viewport || slides.length < 2) {
            return 0;
        }

        const currentOffset = viewport.scrollLeft;
        let nearestIndex = 0;
        let nearestDistance = Number.POSITIVE_INFINITY;

        slides.forEach((slide, index) => {
            const distance = Math.abs(slide.offsetLeft - currentOffset);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestIndex = index;
            }
        });

        return nearestIndex;
    }

    #resolveSlideLabel(slide: HTMLElement, index: number): string {
        return (
            slide.getAttribute("data-label") ??
            slide.getAttribute("aria-label") ??
            slide.getAttribute("title") ??
            `Slide ${index + 1}`
        );
    }

    #clampIndex(index: number): number {
        if (this.slideCount < 1) {
            return 0;
        }

        return Math.max(0, Math.min(index, this.#maxStartIndex));
    }

    get #normalizedSlidesPerView(): number {
        if (this.slideCount < 1) {
            return Math.max(1, this.slidesPerView || 1);
        }

        return Math.max(1, Math.min(this.slidesPerView || 1, this.slideCount));
    }

    get #maxStartIndex(): number {
        return Math.max(0, this.slideCount - this.#normalizedSlidesPerView);
    }

    get #pageStarts(): number[] {
        return Array.from({ length: this.#maxStartIndex + 1 }, (_, index) => index);
    }

    #renderPagination(): void {
        const pagination = this.paginationElement;
        if (!pagination) {
            return;
        }

        pagination.replaceChildren();

        this.#pageStarts.forEach(startIndex => {
            const button = document.createElement("button");
            button.className = "dot";
            button.part.add("dot");
            button.type = "button";
            const start = startIndex + 1;
            const end = Math.min(this.slideCount, startIndex + this.#normalizedSlidesPerView);
            button.setAttribute(
                "aria-label",
                this.#normalizedSlidesPerView === 1
                    ? `Go to ${this.slides[startIndex]?.label ?? `slide ${start}`}`
                    : `Go to slides ${start} through ${end}`,
            );
            button.addEventListener("click", () => {
                this.goTo(startIndex);
            });
            pagination.append(button);
        });

        this.#syncPaginationState();
    }

    #syncPaginationState(): void {
        const buttons = Array.from(this.shadowRoot?.querySelectorAll(".dot") ?? []) as HTMLButtonElement[];
        buttons.forEach((button, index) => {
            button.setAttribute("aria-pressed", String(this.#pageStarts[index] === this.activeIndex));
        });
    }

    #syncChromeState(): void {
        this.style.setProperty("--_carousel-slides-per-view", String(this.#normalizedSlidesPerView));
        const hasMultiplePages = this.#maxStartIndex > 0;

        const controls = this.controlsElement;
        if (controls) {
            controls.hidden = !hasMultiplePages;
        }

        const previousButton = this.previousButtonElement;
        if (previousButton) {
            previousButton.disabled = !this.canGoPrevious;
        }

        const nextButton = this.nextButtonElement;
        if (nextButton) {
            nextButton.disabled = !this.canGoNext;
        }

        const status = this.statusElement;
        if (status) {
            status.hidden = !hasMultiplePages;
            status.textContent = this.currentSlideStatus;
        }
    }

    private get viewportElement(): HTMLElement | null {
        return this.shadowRoot?.querySelector(".viewport") ?? null;
    }

    private get paginationElement(): HTMLElement | null {
        return this.shadowRoot?.querySelector(".pagination") ?? null;
    }

    private get controlsElement(): HTMLElement | null {
        return this.shadowRoot?.querySelector(".controls") ?? null;
    }

    private get previousButtonElement(): (HTMLElement & { disabled?: boolean }) | null {
        return this.shadowRoot?.querySelector(".previous-button") as (HTMLElement & { disabled?: boolean }) | null;
    }

    private get nextButtonElement(): (HTMLElement & { disabled?: boolean }) | null {
        return this.shadowRoot?.querySelector(".next-button") as (HTMLElement & { disabled?: boolean }) | null;
    }

    private get statusElement(): HTMLElement | null {
        return this.shadowRoot?.querySelector(".status") ?? null;
    }

    private get slideElements(): HTMLElement[] {
        const slot = this.shadowRoot?.querySelector("slot") as HTMLSlotElement | null;
        return (slot?.assignedElements({ flatten: true }) ?? []).filter(
            (node): node is HTMLElement => node instanceof HTMLElement,
        );
    }
}

attr(VioletCarousel.prototype, "appearance");
attr(VioletCarousel.prototype, "label");
attr({ attribute: "active-index", converter: integerConverter })(VioletCarousel.prototype, "activeIndex");
attr({ attribute: "slides-per-view", converter: integerConverter })(VioletCarousel.prototype, "slidesPerView");
attr({ mode: "boolean" })(VioletCarousel.prototype, "loop");

if (!customElements.get("violet-carousel")) {
    await FASTElement.define(VioletCarousel, {
        name: "violet-carousel",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}
