import { FASTElement, attr, css, html, observable, repeat, when } from "@lushly-dev/fast-element";

import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import {
    normalizeRatingMax,
    parseRatingValue,
    serializeRatingValue,
} from "./violet-data-grid-rating-values";

const STAR_PATH = "M12 2.2 14.9 8.2 21.5 9.1 16.8 13.6 17.9 20 12 16.8 6.1 20 7.2 13.6 2.5 9.1 9.1 8.2 12 2.2Z";

type VioletDataGridRatingChangeDetail = {
    rating: number | null;
    value: string;
};

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        position: relative;
        display: inline-grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        color: var(--_rating-filled);
        font-family: var(--violet-data-grid-font-family, "IBM Plex Sans", "Segoe UI", sans-serif);

        --_surface-page: var(--color-surface-page, #fffefa);
        --_surface-subtle: var(--color-surface-subtle, #f0efe6);
        --_text-secondary: var(--color-text-secondary, #414651);
        --_text-muted: var(--color-text-muted, #616775);
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_rating-filled: var(--color-state-warning-text, #92400E);
        --_rating-empty: color-mix(in srgb, var(--_text-muted) 36%, transparent);
        --_rating-hover: color-mix(in srgb, var(--_rating-filled) 82%, var(--_surface-page));
        --_radius-md: var(--radius-md, 4px);
        --_size-font-sm: var(--size-font-sm, 12px);
    }

    :host([disabled]) {
        opacity: 0.68;
    }

    .root {
        position: relative;
        display: grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
    }

    .control {
        display: inline-flex;
        align-items: center;
        gap: 0.125rem;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.75rem;
        padding-inline: 0.125rem;
        border-radius: 999px;
        outline: none;
        user-select: none;
        -webkit-user-select: none;
    }

    .control[data-interactive="true"] {
        cursor: pointer;
    }

    .control[data-interactive="true"]:hover .star[data-filled="false"] {
        color: color-mix(in srgb, var(--_rating-empty) 70%, var(--_rating-hover));
    }

    .control:focus-visible {
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 28%, transparent);
        background: color-mix(in srgb, var(--_surface-subtle) 52%, transparent);
    }

    .star {
        inline-size: 1.125rem;
        block-size: 1.125rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        color: var(--_rating-empty);
        transition:
            color var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .star[data-filled="true"] {
        color: var(--_rating-filled);
    }

    .control[data-interactive="true"] .star[data-filled="true"] {
        transform: translateY(-0.5px);
    }

    .star[data-current="true"] {
        transform: translateY(-1px) scale(1.02);
    }

    .star-shape {
        inline-size: 100%;
        block-size: 100%;
        fill: currentColor;
        stroke: color-mix(in srgb, currentColor 92%, var(--_surface-page));
        stroke-width: 1.25;
        vector-effect: non-scaling-stroke;
    }

    .summary {
        margin-inline-start: 0.25rem;
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
        line-height: 1;
        white-space: nowrap;
    }
`;

const interactiveTemplate = html<VioletDataGridRating>`
    <div
        class="control"
        part="control"
        data-interactive="true"
        role="slider"
        tabindex="0"
        aria-label="${x => x.controlLabel}"
        aria-valuemin="0"
        aria-valuemax="${x => String(x.resolvedMax)}"
        aria-valuenow="${x => String(x.rating ?? 0)}"
        aria-valuetext="${x => x.accessibleValueText}"
        @click="${(x, c) => {
            x.handleControlClick(c.event as MouseEvent);
            return true;
        }}"
        @keydown="${(x, c) => {
            x.handleControlKeydown(c.event as KeyboardEvent);
            return true;
        }}"
    >
        ${repeat(
            x => x.starValues,
            html<number, VioletDataGridRating>`
                <span
                    class="star"
                    part="star"
                    data-index="${x => String(x)}"
                    data-filled="${(x, c) => String(c.parent.isFilled(x))}"
                    data-current="${(x, c) => String(c.parent.rating === x)}"
                    aria-hidden="true"
                >
                    <svg class="star-shape" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="${STAR_PATH}"></path>
                    </svg>
                </span>
            `,
        )}
        <span class="summary" part="summary">${x => x.selectionSummary}</span>
    </div>
`;

const readonlyTemplate = html<VioletDataGridRating>`
    <div
        class="control"
        part="control"
        data-interactive="false"
        role="img"
        aria-label="${x => x.readonlyLabel}"
        aria-disabled="${x => x.disabled ? "true" : null}"
    >
        ${repeat(
            x => x.starValues,
            html<number, VioletDataGridRating>`
                <span
                    class="star"
                    part="star"
                    data-index="${x => String(x)}"
                    data-filled="${(x, c) => String(c.parent.isFilled(x))}"
                    data-current="${(x, c) => String(c.parent.rating === x)}"
                    aria-hidden="true"
                >
                    <svg class="star-shape" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="${STAR_PATH}"></path>
                    </svg>
                </span>
            `,
        )}
    </div>
`;

const template = html<VioletDataGridRating>`
    <div class="root" part="base">
        ${when(
            x => x.interactive,
            interactiveTemplate,
            readonlyTemplate,
        )}
    </div>
`;

/**
 * Inline star rating editor for dense grid cells.
 *
 * @summary Grid-native rating control with immediate commit semantics for pointer and keyboard interaction.
 * @fires input - Emitted whenever the rating changes.
 * @fires change - Emitted whenever the rating is committed by pointer or keyboard interaction.
 * @csspart base - Root wrapper for the rating control.
 * @csspart control - Focusable interactive surface or readonly display row.
 * @csspart star - Individual star glyph.
 * @csspart summary - Compact numeric summary shown in interactive mode.
 */
export class VioletDataGridRating extends FASTElement {
    declare public disabled: boolean;

    declare public readonly: boolean;

    declare public ariaLabel: string;

    declare public rating: number | null;

    declare public max: number;

    public constructor() {
        super();
        this.disabled = false;
        this.readonly = false;
        this.ariaLabel = "";
        this.rating = null;
        this.max = 5;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.max = normalizeRatingMax(this.max);
        this.rating = parseRatingValue(this.rating, this.max);
    }

    public ratingChanged(): void {
        const normalizedRating = parseRatingValue(this.rating, this.max);
        if (normalizedRating !== this.rating) {
            this.rating = normalizedRating;
        }
    }

    public maxChanged(): void {
        const normalizedMax = normalizeRatingMax(this.max);
        if (normalizedMax !== this.max) {
            this.max = normalizedMax;
            return;
        }

        const normalizedRating = parseRatingValue(this.rating, normalizedMax);
        if (normalizedRating !== this.rating) {
            this.rating = normalizedRating;
        }
    }

    public get value(): string {
        return serializeRatingValue(this.rating, this.max);
    }

    public set value(nextValue: string) {
        const nextRating = parseRatingValue(nextValue, this.max);
        if (nextRating === this.rating) {
            return;
        }

        this.rating = nextRating;
    }

    public override focus(options?: FocusOptions): void {
        const control = this.shadowRoot?.querySelector<HTMLElement>('.control[tabindex="0"]');
        control?.focus(options);
    }

    public get resolvedMax(): number {
        return normalizeRatingMax(this.max);
    }

    public get starValues(): number[] {
        return Array.from({ length: this.resolvedMax }, (_, index) => index + 1);
    }

    public get interactive(): boolean {
        return !this.disabled && !this.readonly;
    }

    public get selectionSummary(): string {
        return this.rating === null ? "No rating" : `${this.rating}/${this.resolvedMax}`;
    }

    public get controlLabel(): string {
        return this.ariaLabel || "Rating";
    }

    public get accessibleValueText(): string {
        if (this.rating === null) {
            return `No rating, out of ${this.resolvedMax}`;
        }

        return `${this.rating} of ${this.resolvedMax}`;
    }

    public get readonlyLabel(): string {
        return `${this.controlLabel}: ${this.accessibleValueText}`;
    }

    public isFilled(index: number): boolean {
        return this.rating !== null && index <= this.rating;
    }

    public selectRating(nextRating: number | null): void {
        if (!this.interactive) {
            return;
        }

        const normalizedRating = parseRatingValue(nextRating, this.resolvedMax);
        if (normalizedRating === this.rating) {
            return;
        }

        this.rating = normalizedRating;
        this.emitSelectionChange();
    }

    public clearRating(): void {
        this.selectRating(null);
    }

    public handleControlClick(event: MouseEvent): void {
        if (!this.interactive) {
            return;
        }

        const star = event.composedPath().find((node): node is HTMLElement =>
            node instanceof HTMLElement && typeof node.dataset.index === "string"
        );

        if (!star) {
            return;
        }

        const clickedRating = parseRatingValue(star.dataset.index, this.resolvedMax);
        this.selectRating(clickedRating !== null && clickedRating === this.rating ? null : clickedRating);
    }

    public handleControlKeydown(event: KeyboardEvent): void {
        if (!this.interactive) {
            return;
        }

        switch (event.key) {
            case "ArrowRight":
            case "ArrowUp":
                event.preventDefault();
                this.selectRating(Math.min(this.resolvedMax, (this.rating ?? 0) + 1));
                break;
            case "ArrowLeft":
            case "ArrowDown":
                event.preventDefault();
                if (this.rating === null) {
                    return;
                }
                this.selectRating(this.rating > 1 ? this.rating - 1 : null);
                break;
            case "Home":
                event.preventDefault();
                this.selectRating(1);
                break;
            case "End":
                event.preventDefault();
                this.selectRating(this.resolvedMax);
                break;
            case "Backspace":
            case "Delete":
                event.preventDefault();
                this.clearRating();
                break;
            default:
                break;
        }
    }

    private emitSelectionChange(): void {
        const detail = {
            rating: this.rating,
            value: this.value,
        } satisfies VioletDataGridRatingChangeDetail;

        this.$emit("input", detail);
        this.$emit("change", detail);
    }
}

attr({ mode: "boolean" })(VioletDataGridRating.prototype, "disabled");
attr({ mode: "boolean" })(VioletDataGridRating.prototype, "readonly");
attr({ attribute: "aria-label", mode: "fromView" })(VioletDataGridRating.prototype, "ariaLabel");
observable(VioletDataGridRating.prototype, "rating");
observable(VioletDataGridRating.prototype, "max");

if (!customElements.get("violet-data-grid-rating")) {
    await FASTElement.define(VioletDataGridRating, {
        name: "violet-data-grid-rating",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}
