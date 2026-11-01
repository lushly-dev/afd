import { attr, css, FASTElement, html, observable, repeat, when } from "@lushly-dev/fast-element";

import { violetFieldTokenDefaults } from "../theme/violet-token-defaults";
import type { VioletDataGridEditorOption } from "./violet-data-grid";
import { safeCssValue } from "./violet-data-grid-css";

let violetDataGridPillSelectInstanceCount = 0;

function isComposingKeyboardEvent(event: KeyboardEvent): boolean {
    return event.isComposing || event.keyCode === 229;
}

const styles = css`
    ${violetFieldTokenDefaults}

    :host {
        position: relative;
        display: inline-grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        color: var(--_text-primary);
        font-family: var(--violet-data-grid-font-family, "IBM Plex Sans", "Segoe UI", sans-serif);

        --_surface-page: var(--color-surface-page, #fffefa);
        --_surface-card: var(--color-surface-card, #faf9f5);
        --_surface-floating: var(--color-surface-floating, #f0efe6);
        --_surface-subtle: var(--color-surface-subtle, #f0efe6);
        --_border-subtle: var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        --_border-strong: var(--color-border-strong, rgba(28, 26, 13, 0.48));
        --_text-primary: var(--color-text-primary, #18181b);
        --_text-secondary: var(--color-text-secondary, #414651);
        --_text-muted: var(--color-text-muted, #616775);
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_radius-sm: var(--radius-sm, 2px);
        --_radius-md: var(--radius-md, 4px);
        --_shadow-floating: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
        --_pill-font-size: var(--violet-data-grid-pill-font-size, 0.8125rem);
        --_size-font-md: var(--size-font-md, 14px);
    }

    .root {
        position: relative;
        display: grid;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
    }

    .trigger {
        display: inline-flex;
        align-items: center;
        justify-content: flex-start;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.75rem;
        padding: 0;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }

    .trigger:focus-visible {
        outline: none;
    }

    .pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.3125rem;
        inline-size: fit-content;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.5rem;
        padding-inline: 0.625rem 0.5625rem;
        border: 1px solid transparent;
        border-radius: 999px;
        box-sizing: border-box;
        font-size: var(--_pill-font-size);
        font-weight: 400;
        line-height: 1;
    }

    .pill-label {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .pill[data-empty="true"] {
        background: var(--_surface-subtle);
        border-color: color-mix(in srgb, var(--_border-subtle) 85%, transparent);
        color: var(--_text-secondary);
    }

    .caret {
        inline-size: 0.375rem;
        block-size: 0.375rem;
        flex: 0 0 auto;
        margin-inline-start: 0.0625rem;
        border-inline-end: 1.25px solid currentColor;
        border-block-end: 1.25px solid currentColor;
        transform: translateY(-2.5px) rotate(45deg);
        opacity: 0.78;
    }

    .panel {
        position: absolute;
        inset-inline-start: 0;
        inset-block-start: calc(100% + 0.375rem);
        z-index: var(--_layer-popover);
        display: grid;
        gap: 0.5rem;
        inline-size: min(16rem, max(12rem, 100%));
        min-inline-size: 0;
        padding: 0.5rem;
        border: 1px solid color-mix(in srgb, var(--_border-strong) 50%, transparent);
        border-radius: var(--_radius-md);
        background: var(--_surface-floating);
        box-shadow: var(--_shadow-floating);
    }

    .search {
        inline-size: 100%;
        min-inline-size: 0;
        padding: 0.5rem 0.625rem;
        border: 1px solid var(--_border-subtle);
        border-radius: calc(var(--_radius-md) - 2px);
        background: var(--_surface-page);
        color: var(--_text-primary);
        font: inherit;
        font-size: var(--_size-font-md);
        outline: none;
        box-sizing: border-box;
    }

    .search:focus-visible {
        border-color: color-mix(in srgb, var(--_focus-ring) 55%, transparent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 25%, transparent);
    }

    .options {
        display: grid;
        gap: 0.375rem;
        max-block-size: 12rem;
        overflow: auto;
        padding: 0.125rem;
    }

    .option {
        display: grid;
        justify-items: start;
        padding: 0;
        border: none;
        background: transparent;
        color: inherit;
        text-align: start;
        cursor: pointer;
    }

    .option:focus-visible {
        outline: none;
    }

    .option:focus-visible .option-pill {
        box-shadow: 0 0 0 2px var(--_focus-ring);
    }

    .option-pill {
        display: inline-flex;
        align-items: center;
        min-inline-size: 0;
        max-inline-size: 100%;
        min-block-size: 1.625rem;
        padding-inline: 0.75rem;
        border: 1px solid transparent;
        border-radius: 999px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--_pill-font-size);
        font-weight: 400;
        line-height: 1;
    }

    .empty {
        padding: 0.5rem 0.25rem 0.25rem;
        color: var(--_text-secondary);
        font-size: var(--_size-font-sm);
    }

    .error-text {
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
`;

const template = html<VioletDataGridPillSelect>`
    <div
        class="root"
        part="base"
        @focusout="${(x, c) => x.handleFocusOut(c.event as FocusEvent)}"
    >
        <button
            class="trigger"
            type="button"
            part="trigger"
            aria-label="${x => x.triggerLabel}"
            aria-haspopup="listbox"
            aria-controls="${x => x.panelId}"
            aria-expanded="${x => String(x.open)}"
            aria-invalid="${x => x.invalid ? "true" : null}"
            aria-errormessage="${x => x.invalid && x.errorText ? x.errorTextId : null}"
            @click="${x => x.handleTriggerClick()}"
            @keydown="${(x, c) => x.handleTriggerKeydown(c.event as KeyboardEvent)}"
        >
            <span
                class="pill"
                part="pill"
                data-empty="${x => String(!x.selectedOption)}"
                style="${x => x.selectedOptionStyle}"
            >
                <span class="pill-label">${x => x.selectedLabel}</span>
                <span class="caret" part="caret" aria-hidden="true"></span>
            </span>
        </button>

        ${when(
            x => x.invalid && Boolean(x.errorText),
            html<VioletDataGridPillSelect>`
                <span
                    class="error-text"
                    part="error-text"
                    role="${x => x.errorAnnouncement === "self" ? "alert" : null}"
                    id="${x => x.errorTextId}"
                >
                    ${x => x.errorText}
                </span>
            `
        )}

        ${when(
            x => x.open,
            html<VioletDataGridPillSelect>`
                <div class="panel" id="${x => x.panelId}" part="panel">
                    <input
                        class="search"
                        part="search"
                        type="search"
                        placeholder="Find an option"
                        aria-label="Find an option"
                        :value="${x => x.filterQuery}"
                        @input="${(x, c) => x.handleSearchInput(c.event)}"
                        @keydown="${(x, c) => x.handleSearchKeydown(c.event as KeyboardEvent)}"
                    />
                    <div class="options" part="options" role="listbox" aria-label="${x => x.controlLabel || x.placeholder || "Options"}">
                        ${repeat(
                            x => x.filteredOptions,
                            html<VioletDataGridEditorOption, VioletDataGridPillSelect>`
                                <button
                                    class="option"
                                    type="button"
                                    part="option"
                                    tabindex="-1"
                                    role="option"
                                    aria-selected="${(x, c) => String(c.parent.value === x.value)}"
                                    data-option-value="${x => x.value}"
                                    @click="${(x, c) => c.parent.selectOption(x.value)}"
                                    @keydown="${(x, c) => c.parent.handleOptionKeydown(c.event as KeyboardEvent, x.value)}"
                                >
                                    <span class="option-pill" part="option-pill" style="${(x, c) => c.parent.optionStyle(x)}">
                                        ${x => x.label}
                                    </span>
                                </button>
                            `
                        )}
                        ${when(
                            x => x.filteredOptions.length === 0,
                            html<VioletDataGridPillSelect>`
                                <div class="empty">No matching options</div>
                            `
                        )}
                    </div>
                </div>
            `
        )}
    </div>
`;

/**
 * Compact single-select editor for grid cells.
 *
 * @summary Grid-native pill selector with searchable options and keyboard navigation.
 * @fires input - Emitted when the selected option changes.
 * @fires change - Emitted when the selected option is committed.
 * @attr error-announcement - Selects whether this component or an integrating surface announces validation errors.
 * @csspart base - Root wrapper for the pill select.
 * @csspart error-text - Accessible validation error text.
 * @csspart trigger - Trigger button that opens the option list.
 * @csspart pill - Visible selected-value pill.
 * @csspart caret - Caret icon inside the pill.
 * @csspart panel - Floating option panel.
 * @csspart search - Search input inside the panel.
 * @csspart options - Listbox-style option container.
 * @csspart option - Interactive option row.
 * @csspart option-pill - Styled pill surface for each option.
 */
export class VioletDataGridPillSelect extends FASTElement {
    declare public value: string;

    declare public controlLabel: string;

    declare public placeholder: string;

    /** Marks the focused trigger as invalid. */
    declare public invalid: boolean;

    /** Validation explanation exposed from the focused trigger. */
    declare public errorText: string;

    /** Owns live announcement unless an integrating surface provides the alert. */
    declare public errorAnnouncement: "self" | "external";

    declare public options: VioletDataGridEditorOption[];

    declare public open: boolean;

    declare public filterQuery: string;

    private readonly instanceId = ++violetDataGridPillSelectInstanceCount;

    readonly #handleDocumentPointerDown = (event: PointerEvent) => {
        if (!this.open) {
            return;
        }

        const path = event.composedPath();
        if (path.includes(this)) {
            return;
        }

        this.close();
    };

    readonly #handleFocusOut = (event: FocusEvent) => {
        this.handleFocusOut(event);
    };

    public constructor() {
        super();
        this.options = [];
        this.invalid = false;
        this.errorText = "";
        this.errorAnnouncement = "self";
        this.open = false;
        this.filterQuery = "";
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.addEventListener("focusout", this.#handleFocusOut);
        this.ownerDocument.addEventListener("pointerdown", this.#handleDocumentPointerDown, true);
        this.openChanged();
    }

    public disconnectedCallback(): void {
        this.ownerDocument.removeEventListener("pointerdown", this.#handleDocumentPointerDown, true);
        this.removeEventListener("focusout", this.#handleFocusOut);
        super.disconnectedCallback();
    }

    public get selectedOption(): VioletDataGridEditorOption | null {
        return this.options.find(option => option.value === this.value) ?? null;
    }

    public get selectedLabel(): string {
        return this.selectedOption?.label || this.value || this.placeholder || "Select an option";
    }

    public get triggerLabel(): string {
        return this.controlLabel ? `${this.controlLabel}: ${this.selectedLabel}` : this.selectedLabel;
    }

    public get selectedOptionStyle(): string {
        return this.selectedOption ? this.optionStyle(this.selectedOption) : "";
    }

    public get filteredOptions(): VioletDataGridEditorOption[] {
        const query = this.filterQuery.trim().toLowerCase();
        if (!query) {
            return this.options;
        }

        return this.options.filter(option => {
            const haystack = [option.label, option.value, ...(option.keywords ?? [])]
                .join(" ")
                .toLowerCase();
            return haystack.includes(query);
        });
    }

    public get panelId(): string {
        return `${this.localName}-panel-${this.instanceId}`;
    }

    public get errorTextId(): string {
        return `${this.localName}-error-${this.instanceId}`;
    }

    public handleTriggerClick(): void {
        if (this.open) {
            this.close();
            return;
        }

        this.openPanel("search");
    }

    public handleTriggerKeydown(event: KeyboardEvent): boolean {
        if (isComposingKeyboardEvent(event)) {
            return true;
        }

        if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            this.openPanel(this.value ? "selected" : "first");
            return false;
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            this.openPanel(this.value ? "selected" : "last");
            return false;
        }

        if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            this.open ? this.close() : this.openPanel("search");
            return false;
        }

        return true;
    }

    public handleSearchInput(event: Event): boolean {
        const target = event.target as HTMLInputElement | null;
        this.filterQuery = target?.value ?? "";
        return true;
    }

    public handleSearchKeydown(event: KeyboardEvent): boolean {
        if (isComposingKeyboardEvent(event)) {
            return true;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            this.focusTrigger();
            return false;
        }

        if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            this.focusOptionByIndex(0);
            return false;
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            this.focusOptionByIndex(this.filteredOptions.length - 1);
            return false;
        }

        return true;
    }

    public handleOptionKeydown(event: KeyboardEvent, value: string): boolean {
        if (isComposingKeyboardEvent(event)) {
            return true;
        }

        const currentIndex = this.filteredOptions.findIndex(option => option.value === value);

        if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            this.focusOptionByIndex(Math.min(currentIndex + 1, this.filteredOptions.length - 1));
            return false;
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            if (currentIndex <= 0) {
                this.focusSearch();
                return false;
            }

            this.focusOptionByIndex(currentIndex - 1);
            return false;
        }

        if (event.key === "Home") {
            event.preventDefault();
            event.stopPropagation();
            this.focusOptionByIndex(0);
            return false;
        }

        if (event.key === "End") {
            event.preventDefault();
            event.stopPropagation();
            this.focusOptionByIndex(this.filteredOptions.length - 1);
            return false;
        }

        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            this.focusTrigger();
            return false;
        }

        if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            this.selectOption(value);
            return false;
        }

        return true;
    }

    public handleFocusOut(event: FocusEvent): boolean {
        const relatedTarget = event.relatedTarget as Node | null;
        if (relatedTarget && (relatedTarget === this || this.shadowRoot?.contains(relatedTarget))) {
            return true;
        }

        this.close();
        return true;
    }

    public openChanged(): void {
        this.triggerElement()?.setAttribute("tabindex", this.open ? "-1" : "0");
    }

    public selectOption(value: string): void {
        if (this.value === value) {
            this.close();
            this.focusTrigger();
            return;
        }

        this.value = value;
        this.close();
        this.$emit("input");
        this.$emit("change");
        this.focusTrigger();
    }

    public optionStyle(option: VioletDataGridEditorOption): string {
        const style = this.resolveOptionVisuals(option);
        return `background:${style.background};color:${style.foreground};border-color:${style.borderColor};`;
    }

    private close(): void {
        this.open = false;
        this.filterQuery = "";
    }

    private focusTrigger(): void {
        requestAnimationFrame(() => {
            this.triggerElement()?.focus();
        });
    }

    private openPanel(focusTarget: "search" | "first" | "last" | "selected"): void {
        this.open = true;

        requestAnimationFrame(() => {
            switch (focusTarget) {
                case "search":
                    this.focusSearch(true);
                    break;
                case "first":
                    this.focusOptionByIndex(0);
                    break;
                case "last":
                    this.focusOptionByIndex(this.filteredOptions.length - 1);
                    break;
                case "selected": {
                    this.focusOptionByIndex(this.selectedOptionIndex());
                    break;
                }
            }
        });
    }

    private focusSearch(selectText = false): void {
        const search = this.searchElement();
        search?.focus();
        if (selectText) {
            search?.select();
        }
    }

    private focusOptionByIndex(index: number): void {
        const options = this.optionElements();
        if (!options.length) {
            return;
        }

        const clampedIndex = Math.max(0, Math.min(index, options.length - 1));
        options[clampedIndex]?.focus();
    }

    private triggerElement(): HTMLButtonElement | null {
        return this.shadowRoot?.querySelector(".trigger") as HTMLButtonElement | null;
    }

    private searchElement(): HTMLInputElement | null {
        return this.shadowRoot?.querySelector(".search") as HTMLInputElement | null;
    }

    private optionElements(): HTMLButtonElement[] {
        return Array.from(
            this.shadowRoot?.querySelectorAll<HTMLButtonElement>(".option") ?? []
        );
    }

    private selectedOptionIndex(): number {
        const selectedIndex = this.filteredOptions.findIndex(option => option.value === this.value);
        return selectedIndex >= 0 ? selectedIndex : 0;
    }

    private resolveOptionVisuals(option: VioletDataGridEditorOption): {
        background: string;
        foreground: string;
        borderColor: string;
    } {
        if (option.background || option.foreground || option.borderColor) {
            return {
                background: safeCssValue("background", option.background) ?? "var(--_surface-subtle)",
                foreground: safeCssValue("color", option.foreground) ?? "var(--_text-primary)",
                borderColor: safeCssValue("border-color", option.borderColor) ?? "transparent",
            };
        }

        switch (option.tone) {
            case "teal":
                return {
                    background: "#0b7280",
                    foreground: "#ffffff",
                    borderColor: "transparent",
                };
            case "green":
                return {
                    background: "#176c27",
                    foreground: "#ffffff",
                    borderColor: "transparent",
                };
            case "olive":
                return {
                    background: "#547d46",
                    foreground: "#f5fbf2",
                    borderColor: "transparent",
                };
            case "gold":
                return {
                    background: "#8b6b24",
                    foreground: "#fff7de",
                    borderColor: "transparent",
                };
            case "blue":
                return {
                    background: "#416b89",
                    foreground: "#ffffff",
                    borderColor: "transparent",
                };
            case "gray":
                return {
                    background: "#606672",
                    foreground: "#f6f7fa",
                    borderColor: "transparent",
                };
            default:
                return {
                    background: "color-mix(in srgb, var(--_surface-subtle) 90%, white)",
                    foreground: "var(--_text-primary)",
                    borderColor: "color-mix(in srgb, var(--_border-subtle) 80%, transparent)",
                };
        }
    }
}

attr(VioletDataGridPillSelect.prototype, "value");
attr({ attribute: "control-label" })(VioletDataGridPillSelect.prototype, "controlLabel");
attr(VioletDataGridPillSelect.prototype, "placeholder");
attr({ mode: "boolean" })(VioletDataGridPillSelect.prototype, "invalid");
attr({ attribute: "error-text" })(VioletDataGridPillSelect.prototype, "errorText");
attr({ attribute: "error-announcement" })(VioletDataGridPillSelect.prototype, "errorAnnouncement");
observable(VioletDataGridPillSelect.prototype, "options");
observable(VioletDataGridPillSelect.prototype, "open");
observable(VioletDataGridPillSelect.prototype, "filterQuery");

if (!customElements.get("violet-data-grid-pill-select")) {
    await FASTElement.define(VioletDataGridPillSelect, {
        name: "violet-data-grid-pill-select",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}
