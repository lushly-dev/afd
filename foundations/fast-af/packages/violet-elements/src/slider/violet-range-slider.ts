import { FASTElement, attr, css, html, when } from "@lushly-dev/fast-element";

import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import { installFormDisabled } from "../foundations/violet-form-disabled";

export type VioletRangeSliderOrientation = "horizontal" | "vertical";

let violetRangeSliderCount = 0;

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        display: grid;

        --_selection-fill: color-mix(in srgb, var(--color-control-selected-foreground, #244635) 50%, var(--color-control-selected-background, #ddeadf));
        --_rail-background: var(--color-border-strong, rgba(28, 26, 13, 0.48));
        --_danger-border: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
        --_shadow-floating: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
        --_radius-full: var(--radius-round, 9999px);
        --_thumb-size: calc(var(--_target-size) * 0.625);
        --_track-size: calc(var(--_target-size) * 0.125);
        --_control-block-size: var(--_target-size);
        --_vertical-track-size: calc(var(--_target-size) * 4);
        --_tick-size: 6px;
        --_tick-color: var(--_rail-background);
        --_start-percent: 25%;
        --_end-percent: 75%;
    }

    .field {
        display: grid;
        gap: 0;
    }

    .label {
        color: var(--_text-secondary);
        font-size: var(--_control-label-size);
        font-weight: var(--_type-label-weight);
        line-height: var(--_type-label-line);
        margin-block-end: var(--_space-stack-xs);
    }

    .control-shell {
        position: relative;
        display: grid;
        align-items: center;
        inline-size: 100%;
        min-inline-size: 0;
        block-size: var(--_control-block-size);
        border-radius: var(--_radius-md);
    }

    :host([orientation="vertical"]) .control-shell {
        justify-items: center;
        inline-size: var(--_target-size);
        block-size: var(--_vertical-track-size);
    }

    .input {
        position: absolute;
        inset: 0;
        margin: 0;
        inline-size: 100%;
        block-size: 100%;
        appearance: none;
        -webkit-appearance: none;
        background: transparent;
        border: 0;
        opacity: 0;
        cursor: pointer;
        touch-action: none;
        pointer-events: none;
    }

    .input-start {
        pointer-events: auto;
        clip-path: inset(0 calc(100% - var(--_mid-percent)) 0 0);
    }

    .input-end {
        pointer-events: auto;
        clip-path: inset(0 0 0 var(--_mid-percent));
    }

    :host([orientation="vertical"]) .input {
        writing-mode: vertical-lr;
        direction: rtl;
    }

    :host([orientation="vertical"]) .input-start {
        clip-path: inset(calc(100% - var(--_mid-percent)) 0 0 0);
    }

    :host([orientation="vertical"]) .input-end {
        clip-path: inset(0 0 var(--_mid-percent) 0);
    }

    .visual {
        position: relative;
        display: grid;
        align-items: center;
        inline-size: 100%;
        block-size: 100%;
        pointer-events: none;
    }

    :host([orientation="vertical"]) .visual {
        justify-items: center;
    }

    .rail {
        position: relative;
        inline-size: 100%;
        block-size: var(--_track-size);
        border-radius: var(--_radius-full);
        background: var(--_rail-background);
        overflow: hidden;
    }

    :host([orientation="vertical"]) .rail {
        inline-size: var(--_track-size);
        block-size: 100%;
    }

    .fill {
        position: absolute;
        inset-inline-start: var(--_start-percent);
        inset-block-start: 0;
        inline-size: calc(var(--_end-percent) - var(--_start-percent));
        block-size: 100%;
        border-radius: inherit;
        background: var(--_selection-fill);
    }

    :host([orientation="vertical"]) .fill {
        inset-inline-start: 0;
        inset-block-start: auto;
        inset-block-end: var(--_start-percent);
        inline-size: 100%;
        block-size: calc(var(--_end-percent) - var(--_start-percent));
    }

    .ticks {
        display: none;
        position: absolute;
        inset-inline: 0;
        block-size: var(--_tick-size);
        inset-block-start: calc(50% - var(--_track-size) / 2 - var(--_tick-size) - 2px);
        pointer-events: none;
    }

    :host([show-ticks]) .ticks {
        display: block;
    }

    :host([orientation="vertical"]) .ticks {
        inset-block: 0;
        inset-inline: auto;
        inset-inline-start: calc(50% - var(--_track-size) / 2 - var(--_tick-size) - 2px);
        inline-size: var(--_tick-size);
        block-size: auto;
    }

    .thumb {
        position: absolute;
        inset-block-start: 50%;
        inline-size: var(--_thumb-size);
        block-size: var(--_thumb-size);
        border-radius: var(--_radius-full);
        background: var(--_surface-page);
        border: 1px solid var(--_border-subtle);
        box-shadow: var(--_shadow-floating);
        transform: translate(-50%, -50%);
        transition:
            transform var(--_duration-base) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard);
    }

    .thumb-start {
        inset-inline-start: var(--_start-percent);
    }

    .thumb-end {
        inset-inline-start: var(--_end-percent);
    }

    :host([orientation="vertical"]) .thumb {
        inset-inline-start: 50%;
        inset-block-start: auto;
        transform: translate(-50%, 50%);
    }

    :host([orientation="vertical"]) .thumb-start {
        inset-block-end: var(--_start-percent);
    }

    :host([orientation="vertical"]) .thumb-end {
        inset-block-end: var(--_end-percent);
    }

    .control-shell:has(.input-start:focus-visible) .thumb-start {
        box-shadow:
            var(--_shadow-floating),
            0 0 0 2px var(--_focus-ring);
    }

    .control-shell:has(.input-end:focus-visible) .thumb-end {
        box-shadow:
            var(--_shadow-floating),
            0 0 0 2px var(--_focus-ring);
    }

    :host([disabled]) .input,
    :host(:disabled) .input {
        cursor: not-allowed;
    }

    :host([disabled]) .control-shell,
    :host(:disabled) .control-shell {
        cursor: not-allowed;
    }

    :host([disabled]) .visual,
    :host(:disabled) .visual {
        opacity: 0.6;
    }

    :host([disabled]) .rail,
    :host(:disabled) .rail {
        background: color-mix(in srgb, var(--_rail-background) 55%, var(--_surface-page));
    }

    :host([disabled]) .fill,
    :host(:disabled) .fill {
        background: color-mix(in srgb, var(--_selection-fill) 55%, var(--_surface-page));
    }

    :host([disabled]) .thumb,
    :host(:disabled) .thumb {
        background: color-mix(in srgb, var(--_surface-page) 72%, var(--_surface-subtle));
        box-shadow: var(--_shadow-control);
    }

    :host([invalid]) .rail {
        outline: 1px solid var(--_danger-border);
        outline-offset: -1px;
    }

    .supporting,
    .error {
        margin: 0;
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
    }

    .supporting {
        color: var(--_text-muted);
        margin-block-start: var(--_space-stack-2xs);
    }

    .error {
        color: var(--color-state-danger-foreground, #b42318);
        margin-block-start: var(--_space-stack-2xs);
    }

    @media (forced-colors: active) {
        .rail {
            forced-color-adjust: none;
            background: ButtonText;
        }

        .fill {
            background: Highlight;
        }

        .thumb {
            background: HighlightText;
            border: 1px solid Highlight;
            box-shadow: none;
        }

        :host([disabled]) .rail,
        :host(:disabled) .rail {
            background: GrayText;
        }

        :host([disabled]) .fill,
        :host(:disabled) .fill {
            background: GrayText;
        }

        :host([disabled]) .thumb,
        :host(:disabled) .thumb {
            border-color: GrayText;
            background: Canvas;
        }
    }
`;

const template = html<VioletRangeSlider>`
    <div class="field" part="field">
        ${when(
            x => Boolean(x.label),
            html<VioletRangeSlider>`
                <label class="label" part="label" for="${x => x.inputStartId}">${x => x.label}</label>
            `,
        )}
        <div class="control-shell" part="control-shell" style="${x => x.controlStyle}">
            <input
                id="${x => x.inputStartId}"
                class="input input-start"
                part="input-start"
                type="range"
                min="${x => x.min}"
                max="${x => x.max}"
                step="${x => x.step}"
                name="${x => x.name}"
                :value="${x => x.value}"
                ?disabled="${x => x.effectiveDisabled}"
                ?required="${x => x.required}"
                aria-label="${x => x.labelStart}"
                aria-valuemin="${x => x.min}"
                aria-valuemax="${x => x.valueEnd}"
                aria-valuenow="${x => x.valueStart}"
                aria-describedby="${x => x.describedByIds}"
                aria-invalid="${x => x.invalid ? "true" : "false"}"
                aria-orientation="${x => x.orientation}"
                @pointerdown="${(x, c) => x.handlePointerDown(c.event as PointerEvent, "start")}"
                @input="${(x, c) => x.handleInput(c.event)}"
                @change="${(x, c) => x.handleCommit(c.event)}"
            />
            <input
                id="${x => x.inputEndId}"
                class="input input-end"
                part="input-end"
                type="range"
                min="${x => x.min}"
                max="${x => x.max}"
                step="${x => x.step}"
                name="${x => x.name}"
                :value="${x => x.valueEnd}"
                ?disabled="${x => x.effectiveDisabled}"
                aria-label="${x => x.labelEnd}"
                aria-valuemin="${x => x.valueStart}"
                aria-valuemax="${x => x.max}"
                aria-valuenow="${x => x.valueEnd}"
                aria-describedby="${x => x.describedByIds}"
                aria-invalid="${x => x.invalid ? "true" : "false"}"
                aria-orientation="${x => x.orientation}"
                @pointerdown="${(x, c) => x.handlePointerDown(c.event as PointerEvent, "end")}"
                @input="${(x, c) => x.handleInput(c.event)}"
                @change="${(x, c) => x.handleCommit(c.event)}"
            />
            <div class="visual" part="visual" aria-hidden="true">
                <div class="ticks" part="ticks" style="${x => x.tickStyle}"></div>
                <div class="rail" part="rail">
                    <div class="fill" part="fill"></div>
                </div>
                <div class="thumb thumb-start" part="thumb-start"></div>
                <div class="thumb thumb-end" part="thumb-end"></div>
            </div>
        </div>
        ${when(
            x => Boolean(x.supportingText),
            html<VioletRangeSlider>`
                <p class="supporting" id="${x => x.supportingTextId}" part="supporting-text">${x => x.supportingText}</p>
            `,
        )}
        ${when(
            x => Boolean(x.validationMessageText),
            html<VioletRangeSlider>`
                <p class="error" id="${x => x.errorTextId}" part="error-message">${x => x.validationMessageText}</p>
            `,
        )}
    </div>
`;

/**
 * Violet reusable range slider primitive with two thumbs.
 *
 * @summary Token-driven native-first dual-thumb range input with Violet rail, fill, thumbs, label, and supporting/error text.
 * @fires input - Emitted when either thumb value changes while dragging or using the keyboard.
 * @fires change - Emitted when either thumb value is committed.
 * @csspart field - Field wrapper.
 * @csspart label - Slider label text.
 * @csspart control-shell - Slider control wrapper.
 * @csspart input-start - Native range input for the lower thumb.
 * @csspart input-end - Native range input for the upper thumb.
 * @csspart visual - Visual wrapper for the custom rail and thumbs.
 * @csspart rail - Resting slider rail.
 * @csspart fill - Active filled portion of the rail between the two thumbs.
 * @csspart ticks - Tick marks along the rail.
 * @csspart thumb-start - Lower thumb.
 * @csspart thumb-end - Upper thumb.
 * @csspart supporting-text - Supporting helper text.
 * @csspart error-message - Visible error text.
 */
export class VioletRangeSlider extends FASTElement {
    public static readonly formAssociated = true;

    readonly #internals: ElementInternals;
    #defaultValueStart: string;
    #defaultValueEnd: string;
    #activeThumb: "start" | "end" | null;
    #activePointerId: number | null;

    public readonly inputStartId: string;
    public readonly inputEndId: string;
    public readonly supportingTextId: string;
    public readonly errorTextId: string;

    declare public label: string;
    declare public supportingText: string;
    declare public errorText: string;
    declare public valueStart: string;
    declare public valueEnd: string;
    declare public min: string;
    declare public max: string;
    declare public step: string;
    declare public name: string;
    declare public labelStart: string;
    declare public labelEnd: string;
    declare public required: boolean;
    declare public disabled: boolean;

    /**
     * True while an ancestor `<fieldset disabled>` disables the control.
     */
    declare public fieldsetDisabled: boolean;

    /**
     * Author `disabled` or fieldset-disabled.
     */
    declare public readonly effectiveDisabled: boolean;
    declare public invalid: boolean;
    declare public showTicks: boolean;
    declare public orientation: VioletRangeSliderOrientation;

    public constructor() {
        super();
        this.#internals = this.attachInternals();
        violetRangeSliderCount += 1;
        this.inputStartId = `violet-range-slider-${violetRangeSliderCount}-start`;
        this.inputEndId = `violet-range-slider-${violetRangeSliderCount}-end`;
        this.supportingTextId = `violet-range-slider-${violetRangeSliderCount}-supporting`;
        this.errorTextId = `violet-range-slider-${violetRangeSliderCount}-error`;
        this.#defaultValueStart = "";
        this.#defaultValueEnd = "";
        this.#activeThumb = null;
        this.#activePointerId = null;
        this.label = "";
        this.supportingText = "";
        this.errorText = "";
        this.valueStart = "25";
        this.valueEnd = "75";
        this.min = "0";
        this.max = "100";
        this.step = "1";
        this.name = "";
        this.labelStart = "Minimum";
        this.labelEnd = "Maximum";
        this.required = false;
        this.disabled = false;
        this.invalid = false;
        this.showTicks = false;
        this.orientation = "horizontal";
    }

    public get form(): HTMLFormElement | null {
        return this.#internals.form;
    }

    public get validity(): ValidityState {
        return this.#internals.validity;
    }

    public get validationMessage(): string {
        return this.#internals.validationMessage;
    }

    public get willValidate(): boolean {
        return this.#internals.willValidate;
    }

    public checkValidity(): boolean {
        return this.#internals.checkValidity();
    }

    public reportValidity(): boolean {
        return this.#internals.reportValidity();
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.#defaultValueStart = this.getAttribute("value-start") ?? this.valueStart;
        this.#defaultValueEnd = this.getAttribute("value-end") ?? this.valueEnd;
        this.#syncHostAttributes();
        this.#syncValues();
        this.#syncFormState();
    }

    public formResetCallback(): void {
        this.valueStart = this.#defaultValueStart || this.min || "0";
        this.valueEnd = this.#defaultValueEnd || this.max || "100";
        this.#syncValues();
        this.#syncFormState();
    }

    public valueStartChanged(): void {
        if (this.$fastController.isConnected) {
            this.#syncValues();
            this.#syncFormState();
        }
    }

    public valueEndChanged(): void {
        if (this.$fastController.isConnected) {
            this.#syncValues();
            this.#syncFormState();
        }
    }

    public minChanged(): void {
        if (this.$fastController.isConnected) {
            this.#syncValues();
            this.#syncFormState();
        }
    }

    public maxChanged(): void {
        if (this.$fastController.isConnected) {
            this.#syncValues();
            this.#syncFormState();
        }
    }

    public stepChanged(): void {
        if (this.$fastController.isConnected) {
            this.#syncValues();
        }
    }

    public disabledChanged(): void {
        if (this.$fastController.isConnected) {
            this.#syncHostAttributes();
            this.#syncFormState();
        }
    }

    public invalidChanged(): void {
        if (this.$fastController.isConnected) {
            this.#syncHostAttributes();
            this.#syncFormState();
        }
    }

    public orientationChanged(): void {
        if (this.$fastController.isConnected) {
            this.#syncHostAttributes();
        }
    }

    public get validationMessageText(): string {
        return this.invalid ? this.errorText || "Please choose a valid range." : "";
    }

    public get describedByIds(): string {
        return [this.supportingText ? this.supportingTextId : "", this.validationMessageText ? this.errorTextId : ""]
            .filter(Boolean)
            .join(" ");
    }

    public get value(): string {
        return this.valueStart;
    }

    public get controlStyle(): string {
        return `--_start-percent: ${this.startPercent}; --_end-percent: ${this.endPercent}; --_mid-percent: ${this.midPercent};`;
    }

    public get tickStyle(): string {
        const min = this.minAsNumber;
        const max = this.maxAsNumber;
        const step = this.stepAsNumber;
        const range = max - min;

        if (range <= 0 || step <= 0) {
            return "";
        }

        const count = Math.round(range / step);
        if (count < 2 || count > 50) {
            return "";
        }

        const stops: string[] = [];
        for (let i = 0; i <= count; i++) {
            const pct = (i / count) * 100;
            if (i === 0) {
                stops.push(
                    `var(--_tick-color) 0`,
                    `var(--_tick-color) 1px`,
                    `transparent 1px`,
                );
            } else if (i === count) {
                stops.push(
                    `transparent calc(100% - 1px)`,
                    `var(--_tick-color) calc(100% - 1px)`,
                    `var(--_tick-color) 100%`,
                );
            } else {
                stops.push(
                    `transparent calc(${pct}% - 0.5px)`,
                    `var(--_tick-color) calc(${pct}% - 0.5px)`,
                    `var(--_tick-color) calc(${pct}% + 0.5px)`,
                    `transparent calc(${pct}% + 0.5px)`,
                );
            }
        }

        const dir = this.orientation === "vertical" ? "to top" : "to right";
        return `background-image: linear-gradient(${dir}, ${stops.join(", ")});`;
    }

    public handleInput(event: Event): void {
        this.#handleThumbEvent(event, "input");
    }

    public handleCommit(event: Event): void {
        this.#handleThumbEvent(event, "change");
    }

    #handleThumbEvent(event: Event, phase: "input" | "change"): void {
        const input = event.currentTarget as HTMLInputElement | null;
        if (!input) return;

        const newValue = input.value;
        const numNew = Number.parseFloat(newValue);
        const isStart = input.classList.contains("input-start");

        if (isStart) {
            const numEnd = this.valueEndAsNumber;
            if (numNew > numEnd) {
                this.valueStart = String(numEnd);
                input.value = String(numEnd);
            } else {
                this.valueStart = newValue;
            }
        } else {
            const numStart = this.valueStartAsNumber;
            if (numNew < numStart) {
                this.valueEnd = String(numStart);
                input.value = String(numStart);
            } else {
                this.valueEnd = newValue;
            }
        }

        this.$emit(phase, { valueStart: this.valueStart, valueEnd: this.valueEnd });
    }

    public handlePointerDown(event: PointerEvent, thumb: "start" | "end"): void {
        if (this.effectiveDisabled || !this.#isPrimaryPointer(event)) {
            return;
        }

        event.preventDefault();
        this.#activeThumb = thumb;
        this.#activePointerId = event.pointerId;

        const input = thumb === "start" ? this.#inputStartControl : this.#inputEndControl;
        input?.focus({ preventScroll: true });

        this.#teardownPointerListeners();
        this.ownerDocument.addEventListener("pointermove", this.#handlePointerMove);
        this.ownerDocument.addEventListener("pointerup", this.#handlePointerEnd);
        this.ownerDocument.addEventListener("pointercancel", this.#handlePointerEnd);
        this.#syncPointerValue(event, "input");
    }

    public disconnectedCallback(): void {
        this.#teardownPointerListeners();
        super.disconnectedCallback();
    }

    #syncValues(): void {
        this.valueStart = this.#normalizeValue(this.valueStart);
        this.valueEnd = this.#normalizeValue(this.valueEnd);

        // Ensure start <= end
        const numStart = Number.parseFloat(this.valueStart);
        const numEnd = Number.parseFloat(this.valueEnd);
        if (Number.isFinite(numStart) && Number.isFinite(numEnd) && numStart > numEnd) {
            this.valueStart = this.valueEnd;
        }

        const inputStart = this.#inputStartControl;
        if (inputStart && inputStart.value !== this.valueStart) {
            inputStart.value = this.valueStart;
        }

        const inputEnd = this.#inputEndControl;
        if (inputEnd && inputEnd.value !== this.valueEnd) {
            inputEnd.value = this.valueEnd;
        }
    }

    #syncFormState(): void {
        if (this.effectiveDisabled) {
            this.#internals.setFormValue(null);
            this.#internals.setValidity({});
            return;
        }

        const formData = new FormData();
        const baseName = this.name || "range";
        formData.append(`${baseName}-start`, this.valueStart);
        formData.append(`${baseName}-end`, this.valueEnd);
        this.#internals.setFormValue(formData);

        if (this.invalid) {
            this.#internals.setValidity({ customError: true }, this.validationMessageText);
            return;
        }

        this.#internals.setValidity({});
    }

    #syncHostAttributes(): void {
        this.#reflectBooleanAttribute("disabled", this.disabled);
        this.#reflectBooleanAttribute("invalid", this.invalid);

        const nextOrientation = this.orientation === "vertical" ? "vertical" : "horizontal";
        if (this.getAttribute("orientation") !== nextOrientation) {
            this.setAttribute("orientation", nextOrientation);
        }
    }

    #reflectBooleanAttribute(name: string, value: boolean): void {
        if (this.hasAttribute(name) !== value) {
            this.toggleAttribute(name, value);
        }
    }

    #normalizeValue(rawValue: string): string {
        const min = this.minAsNumber;
        const max = this.maxAsNumber;
        const step = this.stepAsNumber;
        const parsed = Number.parseFloat(rawValue);
        const fallback = Number.isFinite(parsed) ? parsed : min;
        const clamped = Math.min(max, Math.max(min, fallback));

        if (!Number.isFinite(step) || step <= 0) {
            return String(clamped);
        }

        const stepped = Math.round((clamped - min) / step) * step + min;
        const precision = this.#decimalPlaces(step);
        return String(Number(stepped.toFixed(precision)));
    }

    #decimalPlaces(value: number): number {
        const [, fraction = ""] = String(value).split(".");
        return fraction.length;
    }

    #isPrimaryPointer(event: PointerEvent): boolean {
        return event.pointerType !== "mouse" || event.button === 0;
    }

    get #inputStartControl(): HTMLInputElement | null {
        return this.shadowRoot?.querySelector(".input-start") ?? null;
    }

    get #inputEndControl(): HTMLInputElement | null {
        return this.shadowRoot?.querySelector(".input-end") ?? null;
    }

    #syncPointerValue(event: PointerEvent, phase: "input" | "change"): void {
        const thumb = this.#activeThumb;
        if (!thumb) return;

        const input = thumb === "start" ? this.#inputStartControl : this.#inputEndControl;
        if (!input) return;

        const nextValue = this.#valueFromPointer(event, input);
        if (nextValue === null) return;

        if (thumb === "start") {
            const numEnd = this.valueEndAsNumber;
            const numNext = Number.parseFloat(nextValue);
            const clamped = numNext > numEnd ? String(numEnd) : nextValue;
            if (this.valueStart !== clamped) {
                this.valueStart = clamped;
            }
            if (input.value !== this.valueStart) {
                input.value = this.valueStart;
            }
        } else {
            const numStart = this.valueStartAsNumber;
            const numNext = Number.parseFloat(nextValue);
            const clamped = numNext < numStart ? String(numStart) : nextValue;
            if (this.valueEnd !== clamped) {
                this.valueEnd = clamped;
            }
            if (input.value !== this.valueEnd) {
                input.value = this.valueEnd;
            }
        }

        if (phase === "input") {
            this.$emit("input", { valueStart: this.valueStart, valueEnd: this.valueEnd });
        } else {
            this.$emit("change", { valueStart: this.valueStart, valueEnd: this.valueEnd });
        }
    }

    #valueFromPointer(event: PointerEvent, input: HTMLInputElement): string | null {
        const rect = input.getBoundingClientRect();
        const min = this.minAsNumber;
        const max = this.maxAsNumber;

        if (rect.width <= 0 || rect.height <= 0 || max <= min) {
            return null;
        }

        const ratio = this.orientation === "vertical"
            ? 1 - (event.clientY - rect.top) / rect.height
            : (event.clientX - rect.left) / rect.width;

        const boundedRatio = Math.min(1, Math.max(0, ratio));
        const rawValue = min + boundedRatio * (max - min);
        return this.#normalizeValue(String(rawValue));
    }

    #handlePointerMove = (event: PointerEvent): void => {
        if (event.pointerId !== this.#activePointerId) {
            return;
        }

        event.preventDefault();
        this.#syncPointerValue(event, "input");
    };

    #handlePointerEnd = (event: PointerEvent): void => {
        if (event.pointerId !== this.#activePointerId) {
            return;
        }

        event.preventDefault();
        this.#syncPointerValue(event, "change");

        this.#activeThumb = null;
        this.#activePointerId = null;
        this.#teardownPointerListeners();
    };

    #teardownPointerListeners(): void {
        this.ownerDocument.removeEventListener("pointermove", this.#handlePointerMove);
        this.ownerDocument.removeEventListener("pointerup", this.#handlePointerEnd);
        this.ownerDocument.removeEventListener("pointercancel", this.#handlePointerEnd);
    }

    get minAsNumber(): number {
        const parsed = Number.parseFloat(this.min);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    get maxAsNumber(): number {
        const parsed = Number.parseFloat(this.max);
        return Number.isFinite(parsed) ? parsed : 100;
    }

    get stepAsNumber(): number {
        const parsed = Number.parseFloat(this.step);
        return Number.isFinite(parsed) ? parsed : 1;
    }

    get valueStartAsNumber(): number {
        const parsed = Number.parseFloat(this.valueStart);
        return Number.isFinite(parsed) ? parsed : this.minAsNumber;
    }

    get valueEndAsNumber(): number {
        const parsed = Number.parseFloat(this.valueEnd);
        return Number.isFinite(parsed) ? parsed : this.maxAsNumber;
    }

    get startPercent(): string {
        const min = this.minAsNumber;
        const max = this.maxAsNumber;

        if (max <= min) {
            return "0%";
        }

        const ratio = (this.valueStartAsNumber - min) / (max - min);
        const percent = Math.min(1, Math.max(0, ratio)) * 100;
        return `${percent}%`;
    }

    get endPercent(): string {
        const min = this.minAsNumber;
        const max = this.maxAsNumber;

        if (max <= min) {
            return "100%";
        }

        const ratio = (this.valueEndAsNumber - min) / (max - min);
        const percent = Math.min(1, Math.max(0, ratio)) * 100;
        return `${percent}%`;
    }

    get midPercent(): string {
        const min = this.minAsNumber;
        const max = this.maxAsNumber;

        if (max <= min) {
            return "50%";
        }

        const startRatio = (this.valueStartAsNumber - min) / (max - min);
        const endRatio = (this.valueEndAsNumber - min) / (max - min);
        const midRatio = (startRatio + endRatio) / 2;
        const percent = Math.min(1, Math.max(0, midRatio)) * 100;
        return `${percent}%`;
    }
}

attr(VioletRangeSlider.prototype, "label");
attr({ attribute: "supporting-text" })(VioletRangeSlider.prototype, "supportingText");
attr({ attribute: "error-text" })(VioletRangeSlider.prototype, "errorText");
attr({ attribute: "value-start" })(VioletRangeSlider.prototype, "valueStart");
attr({ attribute: "value-end" })(VioletRangeSlider.prototype, "valueEnd");
attr(VioletRangeSlider.prototype, "min");
attr(VioletRangeSlider.prototype, "max");
attr(VioletRangeSlider.prototype, "step");
attr(VioletRangeSlider.prototype, "name");
attr({ attribute: "label-start" })(VioletRangeSlider.prototype, "labelStart");
attr({ attribute: "label-end" })(VioletRangeSlider.prototype, "labelEnd");
attr({ mode: "boolean" })(VioletRangeSlider.prototype, "required");
attr({ mode: "boolean" })(VioletRangeSlider.prototype, "disabled");
installFormDisabled(VioletRangeSlider.prototype);
attr({ mode: "boolean" })(VioletRangeSlider.prototype, "invalid");
attr({ attribute: "show-ticks", mode: "boolean" })(VioletRangeSlider.prototype, "showTicks");
attr(VioletRangeSlider.prototype, "orientation");

if (!customElements.get("violet-range-slider")) {
    await FASTElement.define(VioletRangeSlider, {
        name: "violet-range-slider",
        template,
        styles,
    });
}
