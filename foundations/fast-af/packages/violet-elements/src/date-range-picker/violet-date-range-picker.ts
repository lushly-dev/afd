import { FASTElement, attr, css, html, observable, when } from "@lushly-dev/fast-element";

import "../calendar/violet-calendar";
import type { VioletCalendar } from "../calendar/violet-calendar";
import "../icon/violet-icon";
import { registerSystemCalendarIcon } from "../icon/generated/icons/system-calendar";
import { formatDisplayDate } from "../date-time/violet-date-utils";
import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";

export type VioletDateRangePickerSize = "compact" | "natural" | "comfortable";

let violetDateRangePickerCount = 0;
registerSystemCalendarIcon();

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
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--_space-inline-sm);
        inline-size: 100%;
        block-size: var(--_target-size);
        min-block-size: var(--_target-size);
        padding-inline: max(var(--_space-inline-md), calc(var(--_target-size) * 0.375));
        border: 1px solid var(--_border-subtle);
        border-radius: var(--_radius-md);
        background: var(--_surface-page);
        color: var(--color-text-primary, #18181b);
        box-shadow: var(--_shadow-control);
        cursor: pointer;
        font-family: inherit;
        font-size: var(--_control-body-size);
        line-height: var(--_type-body-line);
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

    :host([disabled]) .trigger {
        opacity: 0.65;
        cursor: not-allowed;
    }

    :host([invalid]) .trigger {
        border-color: var(--_danger-border);
    }

    .segment {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .segment.placeholder {
        color: var(--_text-muted);
    }

    .separator {
        color: var(--_text-muted);
    }

    .icon {
        display: inline-grid;
        place-items: center;
        color: var(--_text-muted);
    }

    .icon violet-icon {
        --violet-icon-size: max(0.9rem, calc(var(--_target-size) * 0.33));
    }

    .panel {
        box-sizing: border-box;
        position: fixed;
        inset: unset;
        z-index: var(--_layer-popover);
        inline-size: var(--_panel-inline-size, auto);
        max-inline-size: calc(100vw - 8px);
        padding: 0;
        border: 0;
        background: transparent;
    }

    .panel[hidden] {
        display: none;
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

    @media (forced-colors: active) {
        .trigger {
            border-color: ButtonText;
        }

        .trigger:focus-visible,
        .control-shell.open .trigger {
            outline: 2px solid Highlight;
            outline-offset: 1px;
        }

        :host([disabled]) .trigger {
            border-color: GrayText;
        }
    }
`;

const template = html<VioletDateRangePicker>`
    <div class="field" part="field">
        ${when(
            x => Boolean(x.label),
            html<VioletDateRangePicker>`<div class="label" part="label" id="${x => x.labelId}">${x => x.label}</div>`,
        )}
        <div class="${x => `control-shell${x.open ? " open" : ""}`}" part="control-shell">
            <button
                id="${x => x.triggerId}"
                class="trigger"
                part="trigger"
                type="button"
                ?disabled="${x => x.disabled}"
                aria-haspopup="dialog"
                aria-expanded="${x => String(x.open)}"
                aria-controls="${x => x.panelId}"
                aria-labelledby="${x => (x.label ? x.labelId : x.triggerId)}"
                aria-describedby="${x => x.describedBy || null}"
                aria-invalid="${x => x.invalid ? "true" : "false"}"
                @click="${x => x.toggleOpen()}"
                @keydown="${(x, c) => x.handleTriggerKeydown(c.event as KeyboardEvent)}"
            >
                <span class="${x => `segment${x.start ? "" : " placeholder"}`}">${x => x.startDisplay}</span>
                <span class="separator" aria-hidden="true">-</span>
                <span class="${x => `segment${x.end ? "" : " placeholder"}`}">${x => x.endDisplay}</span>
                <span class="icon" aria-hidden="true">
                    <violet-icon icon="system/calendar" decorative></violet-icon>
                </span>
            </button>

            <div
                id="${x => x.panelId}"
                class="panel"
                part="panel"
                hidden
                @keydown="${(x, c) => x.handlePanelKeydown(c.event as KeyboardEvent)}"
            >
                <violet-calendar
                    selection-mode="range"
                    locale="${x => x.locale}"
                    start="${x => x.start}"
                    end="${x => x.end}"
                    min="${x => x.min}"
                    max="${x => x.max}"
                    @change="${(x, c) => x.handleCalendarChange(c.event as CustomEvent<{ start?: string; end?: string }>)}"
                ></violet-calendar>
            </div>
        </div>
        ${when(
            x => Boolean(x.supportingText),
            html<VioletDateRangePicker>`<p class="supporting" part="supporting-text" id="${x => x.supportingId}">${x => x.supportingText}</p>`,
        )}
        ${when(
            x => Boolean(x.displayErrorText),
            html<VioletDateRangePicker>`<p class="error" part="error-message" id="${x => x.errorId}">${x => x.displayErrorText}</p>`,
        )}
    </div>
`;

/**
 * Shared-calendar date range picker.
 *
 * @summary Violet range picker for selecting a start and end date from one calendar surface.
 * @fires input - Emitted when the partial or complete range changes.
 * @fires change - Emitted when the partial or complete range changes.
 * @fires open-change - Emitted when the calendar popup opens or closes.
 */
export class VioletDateRangePicker extends FASTElement {
    @observable
    declare public open: boolean;

    declare public label: string;
    declare public supportingText: string;
    declare public errorText: string;
    declare public start: string;
    declare public end: string;
    declare public min: string;
    declare public max: string;
    declare public locale: string;
    declare public required: boolean;
    declare public disabled: boolean;
    declare public invalid: boolean;
    declare public size: VioletDateRangePickerSize;

    readonly #handleViewportChange = () => {
        if (this.open) {
            this.#positionPanel();
        }
    };

    readonly #handleDocumentPointerDown = (event: PointerEvent) => {
        if (!this.open) {
            return;
        }

        if (event.composedPath().includes(this)) {
            return;
        }

        this.hide();
    };

    public readonly triggerId: string;
    public readonly labelId: string;
    public readonly supportingId: string;
    public readonly errorId: string;
    public readonly panelId: string;

    public constructor() {
        super();
        this.open = false;
        this.label = "";
        this.supportingText = "";
        this.errorText = "";
        this.start = "";
        this.end = "";
        this.min = "";
        this.max = "";
        this.locale = "";
        this.required = false;
        this.disabled = false;
        this.invalid = false;
        this.size = "natural";

        violetDateRangePickerCount += 1;
        this.triggerId = `violet-date-range-picker-trigger-${violetDateRangePickerCount}`;
        this.labelId = `violet-date-range-picker-label-${violetDateRangePickerCount}`;
        this.supportingId = `violet-date-range-picker-supporting-${violetDateRangePickerCount}`;
        this.errorId = `violet-date-range-picker-error-${violetDateRangePickerCount}`;
        this.panelId = `violet-date-range-picker-panel-${violetDateRangePickerCount}`;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.ownerDocument.addEventListener("pointerdown", this.#handleDocumentPointerDown, true);
        window.addEventListener("resize", this.#handleViewportChange);
        window.addEventListener("scroll", this.#handleViewportChange, true);
        this.openChanged();
    }

    public disconnectedCallback(): void {
        this.ownerDocument.removeEventListener("pointerdown", this.#handleDocumentPointerDown, true);
        window.removeEventListener("resize", this.#handleViewportChange);
        window.removeEventListener("scroll", this.#handleViewportChange, true);
        super.disconnectedCallback();
    }

    public get value(): { start: string | null; end: string | null } {
        return {
            start: this.start || null,
            end: this.end || null,
        };
    }

    public get describedBy(): string {
        const ids = [
            this.supportingText ? this.supportingId : "",
            this.displayErrorText ? this.errorId : "",
        ].filter(Boolean);
        return ids.join(" ");
    }

    public get displayErrorText(): string {
        if (this.invalid) {
            return this.errorText || "Choose a valid date range.";
        }

        if (this.required && (!this.start || !this.end)) {
            return this.errorText || "Please choose a start and end date.";
        }

        return this.errorText;
    }

    public get startDisplay(): string {
        return this.start ? formatDisplayDate(this.locale, this.start) : "Start date";
    }

    public get endDisplay(): string {
        return this.end ? formatDisplayDate(this.locale, this.end) : "End date";
    }

    public openChanged(): void {
        if (!this.$fastController.isConnected) {
            return;
        }

        const panel = this.panelElement;
        if (!panel) {
            return;
        }

        panel.hidden = !this.open;
        if (this.open) {
            this.#positionPanel();
            requestAnimationFrame(() => {
                (this.calendarElement?.shadowRoot?.querySelector('[tabindex="0"]') as HTMLElement | null)?.focus();
            });
        }

        this.$emit("open-change", { open: this.open });
    }

    public toggleOpen(): void {
        if (this.disabled) {
            return;
        }

        this.open ? this.hide() : this.show();
    }

    public show(): void {
        if (!this.disabled) {
            this.open = true;
        }
    }

    public hide(): void {
        this.open = false;
    }

    public handleTriggerKeydown(event: KeyboardEvent): boolean {
        if (this.disabled) {
            return true;
        }

        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.show();
            return false;
        }

        if (event.key === "Escape" && this.open) {
            event.preventDefault();
            this.hide();
            return false;
        }

        // Let every other key (Tab, ...) keep its default action.
        return true;
    }

    /**
     * Dismisses the popup when Escape is pressed from anywhere inside the calendar and returns
     * focus to the trigger. A handled Escape is stopped so it does not also close an ancestor
     * dialog; Escape while closed and every other key are left alone.
     */
    public handlePanelKeydown(event: KeyboardEvent): boolean {
        if (event.key === "Escape" && this.open) {
            event.preventDefault();
            event.stopPropagation();
            this.hide();
            (this.shadowRoot?.getElementById(this.triggerId) as HTMLButtonElement | null)?.focus();
            return false;
        }

        return true;
    }

    public handleCalendarChange(event: CustomEvent<{ start?: string; end?: string }>): void {
        event.stopPropagation();
        this.start = event.detail?.start ?? "";
        this.end = event.detail?.end ?? "";
        this.$emit("input", this.value);
        this.$emit("change", this.value);

        if (this.start && this.end) {
            this.hide();
            (this.shadowRoot?.getElementById(this.triggerId) as HTMLButtonElement | null)?.focus();
        }
    }

    public checkValidity(): boolean {
        if (this.invalid) {
            return false;
        }

        if (this.required && (!this.start || !this.end)) {
            return false;
        }

        if (this.start && this.end && this.start > this.end) {
            return false;
        }

        return true;
    }

    private get panelElement(): HTMLElement | null {
        return this.shadowRoot?.querySelector(".panel") as HTMLElement | null;
    }

    private get calendarElement(): VioletCalendar | null {
        return this.shadowRoot?.querySelector("violet-calendar") as VioletCalendar | null;
    }

    #positionPanel(): void {
        const panel = this.panelElement;
        const trigger = this.shadowRoot?.querySelector(".trigger") as HTMLElement | null;
        if (!panel || !trigger) {
            return;
        }

        const rect = trigger.getBoundingClientRect();
        const inlineSize = Math.max(rect.width, 320);
        panel.style.inlineSize = `${inlineSize}px`;
        panel.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - inlineSize - 4))}px`;
        panel.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 360)}px`;
    }
}

attr({ mode: "boolean" })(VioletDateRangePicker.prototype, "open");
attr(VioletDateRangePicker.prototype, "label");
attr({ attribute: "supporting-text" })(VioletDateRangePicker.prototype, "supportingText");
attr({ attribute: "error-text" })(VioletDateRangePicker.prototype, "errorText");
attr(VioletDateRangePicker.prototype, "start");
attr(VioletDateRangePicker.prototype, "end");
attr(VioletDateRangePicker.prototype, "min");
attr(VioletDateRangePicker.prototype, "max");
attr(VioletDateRangePicker.prototype, "locale");
attr({ mode: "boolean" })(VioletDateRangePicker.prototype, "required");
attr({ mode: "boolean" })(VioletDateRangePicker.prototype, "disabled");
attr({ mode: "boolean" })(VioletDateRangePicker.prototype, "invalid");
attr(VioletDateRangePicker.prototype, "size");

if (!customElements.get("violet-date-range-picker")) {
    await FASTElement.define(VioletDateRangePicker, {
        name: "violet-date-range-picker",
        template,
        styles,
    });
}
