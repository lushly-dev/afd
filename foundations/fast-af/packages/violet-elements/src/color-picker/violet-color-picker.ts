import { FASTElement, attr, css, html, observable, repeat, when } from "@lushly-dev/fast-element";

import "../color-swatch/violet-color-swatch";
import "../icon/violet-icon";
import { registerSystemChevronRightIcon } from "../icon/generated/icons/system-chevron-right";
import { installFormDisabled } from "../foundations/violet-form-disabled";
import {
    clamp,
    hexToHsl,
    hslToHex,
    lightnessGradient,
    normalizeHexColor,
    saturationGradient,
} from "./violet-color-utils";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";

export type VioletColorPickerSize = "compact" | "natural" | "comfortable";

const DEFAULT_COLOR = "#c84f3b";
const DEFAULT_PRESETS = ["#244635", "#c84f3b", "#df7f44", "#d2b062", "#7c9d83", "#5f7ea6", "#7d5fa6", "#b95a7b"];

let violetColorPickerCount = 0;
registerSystemChevronRightIcon();

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        position: relative;
        display: grid;
    }

    :host([size="compact"]) {
        --violet-target-size: var(--_target-size-compact);
        --violet-control-label-size: var(--_type-label-size-compact);
        --violet-control-body-size: var(--_type-body-size-compact);
        --violet-control-caption-size: var(--_type-caption-size-compact);
    }

    :host([size="natural"]) {
        --violet-target-size: var(--_target-size-natural);
        --violet-control-label-size: var(--_type-label-size);
        --violet-control-body-size: var(--_type-body-size);
        --violet-control-caption-size: var(--_type-caption-size);
    }

    :host([size="comfortable"]) {
        --violet-target-size: var(--_target-size-comfortable);
        --violet-control-label-size: var(--_type-label-size);
        --violet-control-body-size: var(--_type-body-size);
        --violet-control-caption-size: var(--_type-caption-size);
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
    }

    .control-shell.open {
        z-index: var(--_layer-raised);
    }

    .trigger {
        box-sizing: border-box;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--_space-inline-md);
        inline-size: 100%;
        min-block-size: var(--_target-size);
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        padding-block: calc(var(--_space-stack-xs) + 2px);
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_radius-md);
        background: var(--_surface-page);
        color: inherit;
        box-shadow: var(--_shadow-control);
        cursor: pointer;
        text-align: start;
        transition:
            border-color var(--_duration-fast) var(--_easing-standard),
            box-shadow var(--_duration-base) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard);
    }

    .trigger:hover {
        border-color: var(--color-field-border-hover, rgba(28, 26, 13, 0.48));
    }

    .trigger:focus-visible,
    .control-shell.open .trigger {
        outline: none;
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px var(--_focus-ring);
        transform: translateY(calc(var(--_space-inline-sm) / -4));
    }

    :host([disabled]) .trigger,
    :host(:disabled) .trigger {
        opacity: 0.65;
        cursor: not-allowed;
    }

    :host([invalid]) .trigger,
    :host([data-invalid]) .trigger {
        border-color: var(--_danger-border);
    }

    .swatch {
        flex: 0 0 auto;
    }

    .trigger-copy {
        display: grid;
        gap: 1px;
        min-inline-size: 0;
    }

    .trigger-value {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        color: var(--color-text-primary, #18181b);
    }

    .trigger-value.placeholder {
        color: var(--_text-muted);
    }

    .trigger-meta {
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        color: var(--_text-muted);
    }

    .trigger-icon {
        display: inline-grid;
        place-items: center;
        color: var(--_text-muted);
        transition: transform var(--_duration-base) var(--_easing-standard);
    }

    .control-shell.open .trigger-icon {
        transform: rotate(90deg);
    }

    .trigger-icon violet-icon {
        --violet-icon-size: 1rem;
    }

    .panel {
        box-sizing: border-box;
        position: fixed;
        inset: unset;
        inline-size: min(26rem, calc(100vw - 8px));
        max-inline-size: calc(100vw - 16px);
        padding: var(--_space-stack-sm);
        border: 1px solid var(--_border-subtle);
        border-radius: calc(var(--_radius-md) * 2);
        background: var(--_surface-card);
        box-shadow: var(--_shadow-floating);
        color: inherit;
        z-index: var(--_layer-popover);
        gap: var(--_space-stack-sm);
        opacity: 0;
        transform: translateY(calc(var(--_space-stack-xs) * -1));
        transition:
            opacity var(--_duration-fast) var(--_easing-standard),
            transform var(--_duration-fast) var(--_easing-standard),
            display var(--_duration-fast) var(--_easing-standard) allow-discrete,
            overlay var(--_duration-fast) var(--_easing-standard) allow-discrete;
    }

    /*
     * Only lay the panel out while it is open. A base \`display\` would override the UA's
     * \`[popover]:not(:popover-open) { display: none }\`, leaving the closed panel laid out
     * (just transparent) and intercepting clicks meant for the trigger. The
     * \`display ... allow-discrete\` transition above keeps the fade-out.
     */
    .panel:popover-open,
    .panel.open {
        display: grid;
        opacity: 1;
        transform: translateY(0);

        @starting-style {
            opacity: 0;
            transform: translateY(calc(var(--_space-stack-xs) * -1));
        }
    }

    .panel::backdrop {
        background: transparent;
    }

    .panel-header {
        display: flex;
        align-items: center;
        gap: var(--_space-inline-md);
    }

    .preview-copy {
        display: grid;
        gap: 0;
        min-inline-size: 0;
    }

    .panel-title {
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        font-weight: 600;
        color: var(--color-text-primary, #18181b);
    }

    .hex-field {
        display: grid;
        gap: var(--_space-stack-2xs);
    }

    .field-label {
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        color: var(--_text-secondary);
    }

    .hex-input {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: calc(var(--_target-size) - 4px);
        padding-inline: max(var(--_space-inline-md), 0.75rem);
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_radius-md);
        background: var(--_surface-page);
        color: inherit;
        font: inherit;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
        box-shadow: var(--_shadow-control);
    }

    .hex-input:focus {
        outline: none;
    }

    .hex-input:focus-visible {
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px var(--_focus-ring);
    }

    .hex-hint {
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        color: var(--_text-muted);
    }

    .channels {
        display: grid;
        gap: var(--_space-stack-sm);
    }

    .channel {
        display: grid;
        gap: var(--_space-stack-2xs);
    }

    .channel-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--_space-inline-md);
    }

    .channel-value {
        font-size: var(--_control-caption-size);
        line-height: var(--_type-caption-line);
        color: var(--_text-muted);
    }

    .channel-input {
        appearance: none;
        -webkit-appearance: none;
        inline-size: 100%;
        block-size: 1.125rem;
        margin: 0;
        border: 0;
        background: transparent;
    }

    .channel-input:focus {
        outline: none;
    }

    .channel-input::-webkit-slider-runnable-track {
        block-size: 0.625rem;
        border-radius: var(--_radius-round, 9999px);
        background: var(--_channel-track, var(--_surface-subtle));
    }

    .channel-input::-moz-range-track {
        block-size: 0.625rem;
        border-radius: var(--_radius-round, 9999px);
        background: var(--_channel-track, var(--_surface-subtle));
    }

    .channel-input::-webkit-slider-thumb {
        appearance: none;
        -webkit-appearance: none;
        inline-size: 1rem;
        block-size: 1rem;
        margin-block-start: -0.1875rem;
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_radius-round, 9999px);
        background: var(--_surface-page);
        box-shadow: var(--_shadow-control);
    }

    .channel-input::-moz-range-thumb {
        inline-size: 1rem;
        block-size: 1rem;
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_radius-round, 9999px);
        background: var(--_surface-page);
        box-shadow: var(--_shadow-control);
    }

    .channel-input:focus-visible::-webkit-slider-thumb {
        box-shadow:
            var(--_shadow-control),
            0 0 0 2px var(--_focus-ring);
    }

    .channel-input:focus-visible::-moz-range-thumb {
        box-shadow:
            var(--_shadow-control),
            0 0 0 2px var(--_focus-ring);
    }

    .presets {
        display: grid;
        gap: var(--_space-stack-2xs);
    }

    .preset-grid {
        display: flex;
        flex-wrap: wrap;
        gap: var(--_space-inline-md);
    }

    .preset-button {
        display: inline-grid;
        place-items: center;
        padding: 0;
        border: 1px solid transparent;
        background: transparent;
        cursor: pointer;
        border-radius: var(--_radius-round, 9999px);
    }

    .preset-button[aria-pressed="true"] {
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 25%, transparent);
    }

    .preset-button:focus-visible {
        outline: none;
        border-color: color-mix(in srgb, var(--_focus-ring) 48%, var(--_border-subtle));
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 25%, transparent);
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

    .control-shell.open ~ .supporting,
    .control-shell.open ~ .error {
        visibility: hidden;
    }
`;

const template = html<VioletColorPicker>`
    <div class="field" part="field">
        ${when(
            x => Boolean(x.label),
            html<VioletColorPicker>`<label class="label" part="label" id="${x => x.labelId}">${x => x.label}</label>`,
        )}
        <div class="${x => x.controlShellClass}" part="control-shell">
            <button
                id="${x => x.triggerId}"
                class="trigger"
                part="trigger"
                type="button"
                ?disabled="${x => x.effectiveDisabled}"
                aria-controls="${x => x.panelId}"
                aria-describedby="${x => x.describedBy || null}"
                aria-expanded="${x => x.expandedText}"
                aria-haspopup="dialog"
                aria-invalid="${x => x.ariaInvalidText}"
                aria-labelledby="${x => x.labelledBy}"
                @click="${x => x.toggleOpen()}"
            >
                <violet-color-swatch
                    class="swatch"
                    part="swatch"
                    decorative
                    size="${x => x.swatchSize}"
                    value="${x => x.currentSelectedColor}"
                ></violet-color-swatch>
                <span class="trigger-copy">
                    <span class="${x => x.triggerValueClass}" id="${x => x.valueId}">${x => x.triggerValueText}</span>
                    <span class="trigger-meta">${x => x.triggerMetaText}</span>
                </span>
                <span class="trigger-icon" aria-hidden="true">
                    <violet-icon icon="system/chevron-right" decorative></violet-icon>
                </span>
            </button>
            <div
                id="${x => x.panelId}"
                class="${x => x.panelClass}"
                part="panel"
                popover="auto"
                role="dialog"
                aria-label="${x => x.panelLabel}"
                @toggle="${(x, c) => x.handleToggle(c.event as ToggleEvent)}"
            >
                <div class="panel-header" part="panel-header">
                    <violet-color-swatch value="${x => x.currentSelectedColor}" size="comfortable" decorative></violet-color-swatch>
                    <div class="preview-copy">
                        <div class="panel-title">${x => x.panelTitleText}</div>
                    </div>
                </div>
                <div class="hex-field">
                    <label class="field-label" for="${x => x.hexInputId}">Hex value</label>
                    <input
                        id="${x => x.hexInputId}"
                        class="hex-input"
                        part="hex-input"
                        type="text"
                        name="${x => x.name}"
                        inputmode="text"
                        spellcheck="false"
                        autocapitalize="off"
                        autocomplete="off"
                        :value="${x => x.value}"
                        ?disabled="${x => x.effectiveDisabled}"
                        ?required="${x => x.required}"
                        aria-invalid="${x => x.invalid ? "true" : "false"}"
                        aria-describedby="${x => x.hexHintId}"
                        @input="${(x, c) => x.handleInput(c.event)}"
                        @change="${(x, c) => x.handleCommit(c.event)}"
                        @blur="${(x, c) => x.handleCommit(c.event)}"
                    />
                    <div class="hex-hint" id="${x => x.hexHintId}">Use a 3- or 6-digit hex color.</div>
                </div>
                <div class="channels" part="channels">
                    <div class="channel">
                        <div class="channel-header">
                            <label class="field-label" for="${x => x.hueInputId}">Hue</label>
                            <span class="channel-value">${x => Math.round(x.hue)}deg</span>
                        </div>
                        <input
                            id="${x => x.hueInputId}"
                            class="channel-input"
                            style="--_channel-track: linear-gradient(90deg, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%);"
                            type="range"
                            min="0"
                            max="360"
                            step="1"
                            :value="${x => x.hue}"
                            @input="${(x, c) => x.handleHueInput(c.event)}"
                            @change="${(x, c) => x.handleHueCommit(c.event)}"
                        />
                    </div>
                    <div class="channel">
                        <div class="channel-header">
                            <label class="field-label" for="${x => x.saturationInputId}">Saturation</label>
                            <span class="channel-value">${x => Math.round(x.saturation)}%</span>
                        </div>
                        <input
                            id="${x => x.saturationInputId}"
                            class="channel-input"
                            style="${x => x.saturationTrackStyle}"
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            :value="${x => x.saturation}"
                            @input="${(x, c) => x.handleSaturationInput(c.event)}"
                            @change="${(x, c) => x.handleSaturationCommit(c.event)}"
                        />
                    </div>
                    <div class="channel">
                        <div class="channel-header">
                            <label class="field-label" for="${x => x.lightnessInputId}">Lightness</label>
                            <span class="channel-value">${x => Math.round(x.lightness)}%</span>
                        </div>
                        <input
                            id="${x => x.lightnessInputId}"
                            class="channel-input"
                            style="${x => x.lightnessTrackStyle}"
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            :value="${x => x.lightness}"
                            @input="${(x, c) => x.handleLightnessInput(c.event)}"
                            @change="${(x, c) => x.handleLightnessCommit(c.event)}"
                        />
                    </div>
                </div>
                <div class="presets" part="presets">
                    <div class="field-label">Suggested swatches</div>
                    <div class="preset-grid">
                        ${repeat(
                            x => x.presets,
                            html<string, VioletColorPicker>`
                                <button
                                    class="preset-button"
                                    type="button"
                                    aria-label="${(preset, c) => c.parent.presetAriaLabel(preset)}"
                                    aria-pressed="${(preset, c) => String(c.parent.currentDisplayColor === preset)}"
                                    @click="${(preset, c) => c.parent.applyPreset(preset)}"
                                >
                                    <violet-color-swatch decorative shape="circle" value="${preset => preset}"></violet-color-swatch>
                                </button>
                            `,
                        )}
                    </div>
                </div>
                <slot name="presets"></slot>
            </div>
        </div>
        ${when(
            x => Boolean(x.supportingText) && !x.isInvalid,
            html<VioletColorPicker>`<p class="supporting" part="supporting-text" id="${x => x.supportingId}">${x => x.supportingText}</p>`,
        )}
        ${when(
            x => Boolean(x.isInvalid && x.errorText),
            html<VioletColorPicker>`<p class="error" part="error-text" id="${x => x.errorId}">${x => x.errorText}</p>`,
        )}
    </div>
`;

/**
 * Violet color picker built from a swatch trigger, textual value, and standard channel controls.
 *
 * @summary Token-driven color picker with a popover editor, hex value entry, and HSL channel sliders.
 * @fires input - Emitted when the selected color changes.
 * @fires change - Emitted when a committed color differs, ignoring case, from the last committed or author-set value.
 * @slot presets - Optional additional preset content rendered under the built-in swatches.
 */
export class VioletColorPicker extends FASTElement {
    public static readonly formAssociated = true;

    readonly #internals: ElementInternals;
    // The color `change` compares against: the last author-set or committed value, normalized.
    #committedColor = "";
    #applyingColor = false;
    readonly #handleViewportChange = () => {
        if (this.open) {
            this.positionPanel();
        }
    };

    public readonly labelId: string;
    public readonly triggerId: string;
    public readonly valueId: string;
    public readonly panelId: string;
    public readonly supportingId: string;
    public readonly errorId: string;
    public readonly hexInputId: string;
    public readonly hexHintId: string;
    public readonly hueInputId: string;
    public readonly saturationInputId: string;
    public readonly lightnessInputId: string;

    public open = false;
    public hue = 0;
    public saturation = 0;
    public lightness = 0;
    public hexDraft = "";
    public validationInvalid = false;

    declare public label: string;
    declare public value: string;
    declare public name: string;
    declare public supportingText: string;
    declare public errorText: string;
    declare public disabled: boolean;
    declare public required: boolean;
    declare public invalid: boolean;
    declare public size: VioletColorPickerSize;

    /**
     * True while an ancestor `<fieldset disabled>` disables the control.
     */
    declare public fieldsetDisabled: boolean;

    /**
     * Author `disabled` or fieldset-disabled.
     */
    declare public readonly effectiveDisabled: boolean;

    public constructor() {
        super();
        const id = violetColorPickerCount;
        violetColorPickerCount += 1;

        this.#internals = this.attachInternals();
        this.labelId = `violet-color-picker-label-${id}`;
        this.triggerId = `violet-color-picker-trigger-${id}`;
        this.valueId = `violet-color-picker-value-${id}`;
        this.panelId = `violet-color-picker-panel-${id}`;
        this.supportingId = `violet-color-picker-supporting-${id}`;
        this.errorId = `violet-color-picker-error-${id}`;
        this.hexInputId = `violet-color-picker-hex-${id}`;
        this.hexHintId = `violet-color-picker-hex-hint-${id}`;
        this.hueInputId = `violet-color-picker-hue-${id}`;
        this.saturationInputId = `violet-color-picker-saturation-${id}`;
        this.lightnessInputId = `violet-color-picker-lightness-${id}`;

        this.label = "";
        this.value = "";
        this.name = "";
        this.supportingText = "";
        this.errorText = "";
        this.disabled = false;
        this.required = false;
        this.invalid = false;
        this.size = "natural";

        this.syncFromColor(this.value);
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.#committedColor = this.currentSelectedColor;
        this.syncFromColor(this.value);
        this.#syncFormState();
        this.syncOpenState();
        window.addEventListener("resize", this.#handleViewportChange);
        window.addEventListener("scroll", this.#handleViewportChange, true);
    }

    public disconnectedCallback(): void {
        window.removeEventListener("resize", this.#handleViewportChange);
        window.removeEventListener("scroll", this.#handleViewportChange, true);
        super.disconnectedCallback();
    }

    public valueChanged(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        if (!this.#applyingColor) {
            this.#committedColor = this.currentSelectedColor;
        }

        this.syncFromColor(this.value);
        this.#syncFormState();
    }

    public disabledChanged(): void {
        if (this.effectiveDisabled && this.open) {
            this.close();
        }

        if (this.$fastController.isConnected) {
            this.#syncFormState();
        }
    }

    public requiredChanged(): void {
        if (this.$fastController.isConnected) {
            this.#syncFormState();
        }
    }

    public invalidChanged(): void {
        if (this.$fastController.isConnected) {
            this.#syncFormState();
        }
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

    public get presets(): string[] {
        return DEFAULT_PRESETS;
    }

    public get currentDisplayColor(): string {
        return normalizeHexColor(this.value) ?? hslToHex({ h: this.hue, s: this.saturation, l: this.lightness });
    }

    public get currentSelectedColor(): string {
        return normalizeHexColor(this.value) ?? "";
    }

    public get describedBy(): string {
        const ids: string[] = [];

        if (this.isInvalid && this.errorText) {
            ids.push(this.errorId);
        } else if (this.supportingText) {
            ids.push(this.supportingId);
        }

        return ids.join(" ");
    }

    public get labelledBy(): string {
        const ids: string[] = [];

        if (this.label) {
            ids.push(this.labelId);
        }

        ids.push(this.valueId);
        return ids.join(" ");
    }

    public get panelLabel(): string {
        return this.label ? `${this.label} color picker` : "Color picker";
    }

    public get panelTitleText(): string {
        return this.value ? "Selected color" : "No color selected";
    }

    public get controlShellClass(): string {
        return `control-shell${this.open ? " open" : ""}`;
    }

    public get panelClass(): string {
        return `panel${this.open ? " open" : ""}`;
    }

    public get expandedText(): string {
        return String(this.open);
    }

    public get ariaInvalidText(): string {
        return this.isInvalid ? "true" : "false";
    }

    public get isInvalid(): boolean {
        return this.invalid || this.validationInvalid;
    }

    public get swatchSize(): "compact" | "natural" | "comfortable" {
        return this.size;
    }

    public get triggerValueClass(): string {
        return this.value ? "trigger-value" : "trigger-value placeholder";
    }

    public get triggerValueText(): string {
        return this.value || "Choose color";
    }

    public get triggerMetaText(): string {
        return this.value ? "Adjust color" : "Select a color";
    }

    public get saturationTrackStyle(): string {
        return `--_channel-track: ${saturationGradient(this.hue, this.lightness)};`;
    }

    public get lightnessTrackStyle(): string {
        return `--_channel-track: ${lightnessGradient(this.hue, this.saturation)};`;
    }

    public toggleOpen(): void {
        if (this.effectiveDisabled) {
            return;
        }

        const panel = this.panelElement;

        if (!panel) {
            return;
        }

        if (panel.matches(":popover-open")) {
            panel.hidePopover();
        } else {
            panel.showPopover();
        }
    }

    public close(): void {
        if (this.panelElement?.matches(":popover-open")) {
            this.panelElement.hidePopover();
        }
    }

    public handleToggle(event: ToggleEvent): void {
        this.open = event.newState === "open";
        this.syncOpenState();

        if (this.open) {
            this.positionPanel();
            requestAnimationFrame(() => {
                this.positionPanel();
                this.hexInputElement?.focus();
                this.hexInputElement?.select();
            });
        } else {
            this.hexDraft = this.currentSelectedColor;
            this.syncHexInputValue();
        }
    }

    public handleHexInput(event: Event): void {
        const input = event.currentTarget as HTMLInputElement;
        this.hexDraft = input.value;

        const normalized = normalizeHexColor(input.value);

        // Preview only full six-digit colors while typing. Applying "#167", valid shorthand on the way to
        // "#1670ca", would rewrite the field to "#116677" under the caret. Commit expands shorthand.
        if (!normalized || input.value.trim().replace(/^#/, "").length !== 6) {
            return;
        }

        this.applyColor(normalized, true, false);
    }

    public handleInput(event: Event): void {
        this.handleHexInput(event);
    }

    public handleHexCommit(event: Event): void {
        const input = event.currentTarget as HTMLInputElement;
        const normalized = normalizeHexColor(input.value);

        if (!normalized) {
            this.hexDraft = this.currentSelectedColor;
            this.syncHexInputValue();
            return;
        }

        this.applyColor(normalized, true, true);
    }

    public handleCommit(event: Event): void {
        this.handleHexCommit(event);
    }

    public handleChannelInput(channel: "h" | "s" | "l", event: Event): void {
        const input = event.currentTarget as HTMLInputElement;
        const nextValue = Number(input.value);
        this.updateChannel(channel, nextValue);
        this.commitFromChannels(true, false);
    }

    public handleChannelCommit(channel: "h" | "s" | "l", event: Event): void {
        const input = event.currentTarget as HTMLInputElement;
        const nextValue = Number(input.value);
        this.updateChannel(channel, nextValue);
        this.commitFromChannels(true, true);
    }

    public handleHueInput(event: Event): void {
        this.handleChannelInput("h", event);
    }

    public handleHueCommit(event: Event): void {
        this.handleChannelCommit("h", event);
    }

    public handleSaturationInput(event: Event): void {
        this.handleChannelInput("s", event);
    }

    public handleSaturationCommit(event: Event): void {
        this.handleChannelCommit("s", event);
    }

    public handleLightnessInput(event: Event): void {
        this.handleChannelInput("l", event);
    }

    public handleLightnessCommit(event: Event): void {
        this.handleChannelCommit("l", event);
    }

    public applyPreset(color: string): void {
        this.applyColor(color, true, true);
    }

    public presetAriaLabel(color: string): string {
        return `Use ${color}`;
    }

    public formStateRestoreCallback(state: File | string | FormData | null): void {
        if (typeof state === "string") {
            this.value = state;
        }
    }

    public formResetCallback(): void {
        this.value = "";
        this.syncFromColor(this.value);
        this.#syncFormState();
    }

    public checkValidity(): boolean {
        return this.#internals.checkValidity();
    }

    public reportValidity(): boolean {
        return this.#internals.reportValidity();
    }

    private get panelElement(): HTMLElement | null {
        return this.shadowRoot?.querySelector(".panel") ?? null;
    }

    private get controlShellElement(): HTMLElement | null {
        return this.shadowRoot?.querySelector(".control-shell") ?? null;
    }

    private get hexInputElement(): HTMLInputElement | null {
        return this.shadowRoot?.querySelector(".hex-input") ?? null;
    }

    private syncFromColor(value: string): void {
        const normalized = normalizeHexColor(value);
        const hsl = hexToHsl(normalized || DEFAULT_COLOR);

        if (!hsl) {
            return;
        }

        this.hue = hsl.h;
        this.saturation = hsl.s;
        this.lightness = hsl.l;
        this.hexDraft = normalized ?? "";
        this.syncHexInputValue();
    }

    private updateChannel(channel: "h" | "s" | "l", value: number): void {
        switch (channel) {
            case "h":
                this.hue = clamp(value, 0, 360);
                break;
            case "s":
                this.saturation = clamp(value, 0, 100);
                break;
            case "l":
                this.lightness = clamp(value, 0, 100);
                break;
        }
    }

    private commitFromChannels(emitInput: boolean, emitChange: boolean): void {
        const next = hslToHex({
            h: this.hue,
            s: this.saturation,
            l: this.lightness,
        });

        this.applyColor(next, emitInput, emitChange);
    }

    private applyColor(color: string, emitInput: boolean, emitChange: boolean): void {
        const normalized = normalizeHexColor(color);

        if (!normalized) {
            return;
        }

        // Comparing normalized colors keeps an author's `#1670CA` from reading as an edit to `#1670ca`.
        const valueChanged = normalized !== this.currentSelectedColor;
        if (valueChanged) {
            this.#applyingColor = true;
            this.value = normalized;
            this.#applyingColor = false;
        }
        this.hexDraft = normalized;
        this.syncFromColor(normalized);
        this.#syncFormState();

        if (emitInput && valueChanged) {
            this.$emit("input", { value: normalized });
        }

        if (emitChange && normalized !== this.#committedColor) {
            this.#committedColor = normalized;
            this.$emit("change", { value: normalized });
        }
    }

    #syncFormState(): void {
        this.#internals.setFormValue(this.value || null);

        if (this.effectiveDisabled) {
            this.validationInvalid = false;
            this.removeAttribute("data-invalid");
            this.#internals.setValidity({});
            return;
        }

        if (this.invalid) {
            this.validationInvalid = true;
            this.setAttribute("data-invalid", "");
            this.#internals.setValidity({ customError: true }, this.errorText || "The selected color is invalid.");
            return;
        }

        if (this.required && !this.value) {
            this.validationInvalid = true;
            this.setAttribute("data-invalid", "");
            this.#internals.setValidity({ valueMissing: true }, this.errorText || "Select a color.");
            return;
        }

        this.validationInvalid = false;
        this.removeAttribute("data-invalid");
        this.#internals.setValidity({});
    }

    private syncHexInputValue(): void {
        const input = this.hexInputElement;

        if (!input || input.value === this.hexDraft) {
            return;
        }

        input.value = this.hexDraft;
    }

    private syncOpenState(): void {
        this.controlShellElement?.classList.toggle("open", this.open);
        this.panelElement?.classList.toggle("open", this.open);

        if (this.panelElement) {
            this.panelElement.style.opacity = this.open ? "1" : "0";
            this.panelElement.style.transform = this.open ? "translateY(0)" : "translateY(calc(var(--_space-stack-xs) * -1))";
        }
    }

    private positionPanel(): void {
        const panel = this.panelElement;
        const trigger = this.shadowRoot?.querySelector(".trigger") as HTMLButtonElement | null;

        if (!panel || !trigger) {
            return;
        }

        const rect = trigger.getBoundingClientRect();
        const viewportPadding = 8;
        const gap = 6;

        let left = rect.left;
        let top = rect.bottom + gap;
        const width = Math.min(Math.max(rect.width, 320), window.innerWidth - viewportPadding * 2);

        panel.style.width = `${width}px`;
        panel.style.left = `${Math.max(viewportPadding, left)}px`;
        panel.style.top = `${Math.max(viewportPadding, top)}px`;

        requestAnimationFrame(() => {
            const panelRect = panel.getBoundingClientRect();

            if (panelRect.right > window.innerWidth - viewportPadding) {
                left = Math.max(viewportPadding, window.innerWidth - panelRect.width - viewportPadding);
            }

            if (panelRect.bottom > window.innerHeight - viewportPadding) {
                top = Math.max(viewportPadding, rect.top - panelRect.height - gap);
            }

            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
        });
    }
}

attr(VioletColorPicker.prototype, "label");
attr(VioletColorPicker.prototype, "value");
attr(VioletColorPicker.prototype, "name");
attr({ attribute: "supporting-text" })(VioletColorPicker.prototype, "supportingText");
attr({ attribute: "error-text" })(VioletColorPicker.prototype, "errorText");
attr({ mode: "boolean" })(VioletColorPicker.prototype, "disabled");
installFormDisabled(VioletColorPicker.prototype);
attr({ mode: "boolean" })(VioletColorPicker.prototype, "required");
attr({ mode: "boolean" })(VioletColorPicker.prototype, "invalid");
attr(VioletColorPicker.prototype, "size");
observable(VioletColorPicker.prototype, "open");
observable(VioletColorPicker.prototype, "hue");
observable(VioletColorPicker.prototype, "saturation");
observable(VioletColorPicker.prototype, "lightness");
observable(VioletColorPicker.prototype, "hexDraft");
observable(VioletColorPicker.prototype, "validationInvalid");

if (!customElements.get("violet-color-picker")) {
    await VioletColorPicker.define({
        name: "violet-color-picker",
        template,
        styles,
    });
}
