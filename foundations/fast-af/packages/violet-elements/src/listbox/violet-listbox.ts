import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import "../option-group/violet-option-group";
import "../option/violet-option";
import type { VioletOption } from "../option/violet-option";
import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";
import {
    findTypeaheadMatch,
    getEnabledOptions,
    getNextEnabledIndex,
    getOwnedOptions,
    getSelectedOption,
    syncOptionSelection,
} from "./violet-selection-helpers";

let violetListboxId = 0;

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: grid;
        --_panel-min-inline: var(--violet-listbox-min-inline-size, 14rem);
        --_panel-max-block: var(--violet-listbox-max-block-size, 18rem);
        --_panel-padding: var(--violet-listbox-padding, var(--_space-inline-sm));
    }

    .control {
        box-sizing: border-box;
        display: grid;
        gap: 2px;
        min-inline-size: var(--_panel-min-inline);
        max-block-size: min(var(--_panel-max-block), 70vh);
        overflow: auto;
        padding: var(--_panel-padding);
        border: 1px solid var(--_border-subtle);
        border-radius: calc(var(--_radius-md) * 1.25);
        background: var(--_surface-card);
        box-shadow: var(--_shadow-control);
        outline: none;
    }

    .control:focus-visible {
        border-color: color-mix(in srgb, var(--_focus-ring) 45%, var(--_border-subtle));
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--_focus-ring) 35%, transparent);
    }

    :host([disabled]) .control {
        opacity: 0.65;
        cursor: not-allowed;
    }

    @media (forced-colors: active) {
        .control {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
            color: ButtonText;
            box-shadow: none;
        }

        .control:focus-visible {
            border-color: Highlight;
            box-shadow: 0 0 0 2px Highlight;
        }
    }
`;

const template = html<VioletListbox>`
    <div
        id="${x => x.listboxId}"
        class="control"
        part="control"
        role="listbox"
        tabindex="${x => (x.disabled ? "-1" : "0")}"
        aria-disabled="${x => String(x.disabled)}"
        aria-multiselectable="${x => (x.multiple ? "true" : null)}"
        aria-label="${x => x.label || x.getAttribute("aria-label") || "Options"}"
        @focus="${x => x.handleFocus()}"
        @keydown="${(x, c) => x.handleKeydown(c.event as KeyboardEvent)}"
    >
        <slot @slotchange="${x => x.handleSlotChange()}"></slot>
    </div>
`;

export class VioletListbox extends FASTElement {
    @observable
    declare public activeValue: string;

    declare public label: string;
    declare public value: string;
    declare public disabled: boolean;
    declare public multiple: boolean;
    declare public selectionFollowsFocus: boolean;

    @observable
    declare public selectedValues: string[];

    public readonly listboxId: string;

    #typeaheadBuffer = "";
    #typeaheadTimer = 0;

    public constructor() {
        super();
        violetListboxId += 1;
        this.listboxId = `violet-listbox-${violetListboxId}`;
        this.label = "";
        this.value = "";
        this.activeValue = "";
        this.selectedValues = [];
        this.disabled = false;
        this.multiple = false;
        this.selectionFollowsFocus = false;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.addEventListener("request-select", this.handleRequestSelect as EventListener);
        this.handleSlotChange();
    }

    public disconnectedCallback(): void {
        this.removeEventListener("request-select", this.handleRequestSelect as EventListener);
        super.disconnectedCallback();
    }

    public get options(): VioletOption[] {
        return getOwnedOptions(this);
    }

    public get activeOptionId(): string {
        return this.options.find(option => option.value === this.activeValue)?.optionId ?? "";
    }

    public handleSlotChange(): void {
        const enabled = getEnabledOptions(this.options);
        if (this.multiple) {
            const derivedSelected =
                this.selectedValues.length > 0
                    ? this.selectedValues.filter(value => enabled.some(option => option.value === value))
                    : this.options.filter(option => option.selected && enabled.some(candidate => candidate === option)).map(option => option.value);

            this.selectedValues = derivedSelected;
            this.value = this.selectedValues[0] ?? "";

            if (!this.activeValue || !enabled.some(option => option.value === this.activeValue)) {
                this.activeValue = this.selectedValues[0] ?? enabled[0]?.value ?? "";
            }
        } else {
            const selected = getSelectedOption(this.options, this.value);
            const fallbackActive = selected?.value ?? enabled[0]?.value ?? "";

            if (!this.value && selected) {
                this.value = selected.value;
            }

            this.selectedValues = this.value ? [this.value] : [];

            if (!this.activeValue || !enabled.some(option => option.value === this.activeValue)) {
                this.activeValue = fallbackActive;
            }
        }

        this.#syncOptions();
    }

    public handleFocus(): void {
        if (this.disabled) {
            return;
        }

        if (!this.activeValue) {
            const selected = this.multiple
                ? this.selectedValues[0]
                : getSelectedOption(this.options, this.value)?.value;
            this.activeValue = selected ?? getEnabledOptions(this.options)[0]?.value ?? "";
        }

        this.#syncOptions();
        this.#scrollActiveIntoView();
    }

    public handleKeydown(event: KeyboardEvent): boolean {
        if (this.disabled) {
            return true;
        }

        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                this.#moveActive(1);
                return false;
            case "ArrowUp":
                event.preventDefault();
                this.#moveActive(-1);
                return false;
            case "Home":
                event.preventDefault();
                this.#setActive(getEnabledOptions(this.options)[0]?.value ?? "");
                return false;
            case "End": {
                event.preventDefault();
                const enabled = getEnabledOptions(this.options);
                this.#setActive(enabled.at(-1)?.value ?? "");
                return false;
            }
            case "Enter":
            case " ":
                event.preventDefault();
                if (this.activeValue) {
                    this.multiple ? this.toggleValue(this.activeValue) : this.selectValue(this.activeValue);
                }
                return false;
            case "a":
            case "A":
                if (this.multiple && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    this.toggleAll();
                    return false;
                }
                return true;
            default:
                if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
                    this.#queueTypeahead(event.key);
                }
                return true;
        }
    }

    public handleRequestSelect(event: CustomEvent<{ value?: string }>): void {
        event.stopPropagation();

        const nextValue = event.detail?.value ?? "";
        this.multiple ? this.toggleValue(nextValue) : this.selectValue(nextValue);
    }

    public valueChanged(): void {
        if (!this.multiple) {
            this.selectedValues = this.value ? [this.value] : [];
        }
        this.#syncOptions();
    }

    public activeValueChanged(): void {
        this.#syncOptions();
    }

    public selectedValuesChanged(): void {
        if (this.multiple) {
            this.value = this.selectedValues[0] ?? "";
        }

        this.#syncOptions();
    }

    public selectValue(nextValue: string, emit = true): void {
        const option = getEnabledOptions(this.options).find(candidate => candidate.value === nextValue) ?? null;
        if (!option) {
            return;
        }

        this.value = option.value;
        this.activeValue = option.value;
        this.#syncOptions();

        if (emit) {
            this.$emit("input", { value: this.value });
            this.$emit("change", { value: this.value });
        }
    }

    public toggleValue(nextValue: string, emit = true): void {
        const option = getEnabledOptions(this.options).find(candidate => candidate.value === nextValue) ?? null;
        if (!option) {
            return;
        }

        const selected = new Set(this.selectedValues);
        if (selected.has(option.value)) {
            selected.delete(option.value);
        } else {
            selected.add(option.value);
        }

        this.selectedValues = this.options.filter(candidate => selected.has(candidate.value)).map(candidate => candidate.value);
        this.activeValue = option.value;
        this.#syncOptions();

        if (emit) {
            this.$emit("input", { value: this.value, selectedValues: [...this.selectedValues] });
            this.$emit("change", { value: this.value, selectedValues: [...this.selectedValues] });
        }
    }

    public toggleAll(): void {
        const enabled = getEnabledOptions(this.options);
        const allSelected = enabled.every(option => this.selectedValues.includes(option.value));

        this.selectedValues = allSelected ? [] : enabled.map(option => option.value);
        this.activeValue = enabled[0]?.value ?? "";
        this.#syncOptions();
        this.$emit("input", { value: this.value, selectedValues: [...this.selectedValues] });
        this.$emit("change", { value: this.value, selectedValues: [...this.selectedValues] });
    }

    #moveActive(step: 1 | -1): void {
        const options = this.options;
        const currentIndex = options.findIndex(option => option.value === this.activeValue);
        const nextIndex = getNextEnabledIndex(options, currentIndex < 0 ? (step === 1 ? -1 : 0) : currentIndex, step);
        const nextValue = options[nextIndex]?.value ?? "";

        this.#setActive(nextValue);
    }

    #setActive(nextValue: string): void {
        this.activeValue = nextValue;
        this.#syncOptions();
        this.#scrollActiveIntoView();

        if (!this.multiple && this.selectionFollowsFocus && nextValue) {
            this.selectValue(nextValue);
        }
    }

    #queueTypeahead(key: string): void {
        window.clearTimeout(this.#typeaheadTimer);
        this.#typeaheadBuffer = `${this.#typeaheadBuffer}${key.toLowerCase()}`;

        const match = findTypeaheadMatch(this.options, this.#typeaheadBuffer, this.activeValue);
        if (match) {
            this.#setActive(match.value);
        }

        this.#typeaheadTimer = window.setTimeout(() => {
            this.#typeaheadBuffer = "";
        }, 500);
    }

    #scrollActiveIntoView(): void {
        const active = this.options.find(option => option.value === this.activeValue);
        active?.shadowRoot?.querySelector('[part="control"]')?.scrollIntoView({ block: "nearest" });
    }

    #syncOptions(): void {
        syncOptionSelection(this.options, this.multiple ? this.selectedValues : this.value, this.activeValue);
        const control = this.shadowRoot?.querySelector('[role="listbox"]');
        if (control) {
            control.ariaActiveDescendantElement =
                this.options.find(option => option.value === this.activeValue) ?? null;
        }
    }
}

attr(VioletListbox.prototype, "label");
attr(VioletListbox.prototype, "value");
attr({ mode: "boolean" })(VioletListbox.prototype, "disabled");
attr({ mode: "boolean" })(VioletListbox.prototype, "multiple");
attr({ mode: "boolean", attribute: "selection-follows-focus" })(VioletListbox.prototype, "selectionFollowsFocus");

if (!customElements.get("violet-listbox")) {
    await FASTElement.define(VioletListbox, {
        name: "violet-listbox",
        template,
        styles,
        shadowOptions: {
            delegatesFocus: true,
        },
    });
}
