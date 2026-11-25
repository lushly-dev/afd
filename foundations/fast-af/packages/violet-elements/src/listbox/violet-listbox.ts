import { FASTElement, Observable, attr, css, html, observable, type PartialFASTElementDefinition, type FASTElementExtension } from "@lushly-dev/fast-element";

import type { VioletOption } from "../option/violet-option";
import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";
import {
    findOriginatingOption,
    findTypeaheadMatch,
    getEnabledOptions,
    getNextEnabledIndex,
    getOwnedOptions,
    getSelectedOption,
    isOptionDisabled,
    observeAttribute,
    reflectStringAttribute,
    resolveActiveOption,
    syncOptionSelection,
} from "./violet-selection-helpers";

let violetListboxId = 0;

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: grid;
        --_panel-min-inline: var(--violet-listbox-min-inline-size, 14rem);
        --_panel-max-block: var(--violet-listbox-max-block-size, 18rem);
        /* The surface block has no inline spacing; the panel's padding is the menu's and the select popup's. */
        --_space-inline-sm: var(--violet-space-inline-tight, 4px);
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
        /* The shadow is the edge. The border is kept, clear, for forced colours. */
        border: 1px solid transparent;
        border-radius: var(--_radius-lg);
        background: var(--_surface-card);
        box-shadow: var(--_shadow-card);
        outline: none;
    }

    .control:focus-visible {
        /* The keys are in this list while it has focus, so its active row draws its ring at >= 3:1. */
        --_option-active-ring: var(--_focus-ring);
        box-shadow:
            var(--_shadow-card),
            0 0 0 2px var(--_focus-ring);
    }

    :host([disabled]) .control {
        opacity: 0.5;
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
        @pointerdown="${x => x.handlePointerDown()}"
        @focus="${x => x.handleFocus()}"
        @keydown="${(x, c) => x.handleKeydown(c.event as KeyboardEvent)}"
    >
        <slot @slotchange="${x => x.handleSlotChange()}"></slot>
    </div>
`;

/**
 * Violet reusable listbox primitive.
 *
 * @summary Always-visible list of options for choosing one, or several with multiple.
 * @attr {string} [value=""] - The chosen option's value (or the first chosen value in multiple mode).
 * @slot - The options: violet-option and violet-option-group elements.
 * @fires input - Emitted when the selection changes.
 * @fires change - Emitted when the selection changes.
 * @csspart control - The focusable list element.
 */
export class VioletListbox extends FASTElement {
    #pressing = false;
    #explicitValue: string | null = null;
    #selectedOptions: VioletOption[] = [];
    #activeOption: VioletOption | null = null;
    #reflectingValue = false;
    #syncingActive = false;
    #syncingSelection = false;

    @observable
    declare public activeValue: string;

    declare public label: string;
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
        this.activeValue = "";
        this.selectedValues = [];
        this.disabled = false;
        this.multiple = false;
        this.selectionFollowsFocus = false;
    }

    public get value(): string {
        Observable.track(this, "value");
        return this.#explicitValue ?? "";
    }

    public set value(next: string) {
        const normalized = next === null || next === undefined ? null : String(next);
        this.#setExplicitValue(normalized, true);
    }

    public override attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
        if (name === "value") {
            if (!this.#reflectingValue) {
                this.#setExplicitValue(newValue, false);
            }
            return;
        }
        super.attributeChangedCallback(name, oldValue, newValue);
    }

    public connectedCallback(): void {
        super.connectedCallback();
        if (this.#explicitValue === null && this.hasAttribute("value")) {
            this.#explicitValue = this.getAttribute("value");
        } else if (this.#explicitValue !== null) {
            this.#reflectValueAttribute(this.#explicitValue);
        }
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
        return this.#activeOption?.optionId ?? "";
    }

    public handleSlotChange(): void {
        const options = this.options;
        const enabled = getEnabledOptions(options);
        let firstSelected: VioletOption | null = null;
        if (this.multiple) {
            const wanted = new Set(this.selectedValues);
            const surviving = this.#selectedOptions.filter(
                option => enabled.includes(option) && wanted.has(option.value)
            );
            const coveredValues = new Set(surviving.map(option => option.value));
            const added = enabled.filter(option => wanted.has(option.value) && !coveredValues.has(option.value));
            const derivedOptions =
                this.selectedValues.length > 0
                    ? enabled.filter(option => surviving.includes(option) || added.includes(option))
                    : this.#selectedOptions.length > 0
                      ? []
                      : enabled.filter(option => option.selected);
            this.#selectedOptions = derivedOptions;
            firstSelected = derivedOptions[0] ?? null;
            this.#syncingSelection = true;
            try {
                this.selectedValues = derivedOptions.map(option => option.value);
                this.#updateExplicitValue(derivedOptions[0]?.value ?? null, true);
            } finally {
                this.#syncingSelection = false;
            }
        } else {
            const current = this.#selectedOptions[0];
            const selected =
                current &&
                enabled.includes(current) &&
                (current.value === this.#explicitValue || !current.hasAttribute("value"))
                    ? current
                    : getSelectedOption(options, this.#explicitValue);
            this.#selectedOptions = selected ? [selected] : [];
            firstSelected = selected;
            this.#syncingSelection = true;
            try {
                if (selected && (this.#explicitValue === null || current === selected)) {
                    this.#updateExplicitValue(selected.value, true);
                }
                this.selectedValues = selected ? [selected.value] : [];
            } finally {
                this.#syncingSelection = false;
            }
        }

        const nextActive = resolveActiveOption(
            enabled,
            this.#activeOption,
            this.activeValue,
            firstSelected ?? enabled[0] ?? null
        );
        this.#applyActiveOption(nextActive);
    }

    public handleFocus(): void {
        if (this.disabled) {
            return;
        }

        const enabled = getEnabledOptions(this.options);
        if (!this.#activeOption || !enabled.includes(this.#activeOption)) {
            const selected = this.#selectedOptions.find(option => enabled.includes(option)) ?? null;
            this.#applyActiveOption(selected ?? enabled[0] ?? null);
        } else {
            this.#syncOptions();
        }
        // Focus from a press on the list leaves the scroll alone: bringing the active row into view
        // would move the row under the pointer before the press ends, and the click would miss it
        // (#712). Focus from the keyboard or from script still brings it into view.
        const pressed = this.#pressing;
        this.#pressing = false;
        if (!pressed) {
            this.#scrollActiveIntoView();
        }
    }

    /** Marks the focus a press on the list is about to give, so `handleFocus` does not scroll. */
    public handlePointerDown(): boolean {
        this.#pressing = true;
        // A press on a list that already has focus gives no focus event, so clear the mark in a
        // later task: the focus a press gives comes in this one, after the listeners have run.
        window.setTimeout(() => {
            this.#pressing = false;
        });
        return true;
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
                this.#setActiveOption(getEnabledOptions(this.options)[0] ?? null);
                return false;
            case "End": {
                event.preventDefault();
                const enabled = getEnabledOptions(this.options);
                this.#setActiveOption(enabled.at(-1) ?? null);
                return false;
            }
            case "Enter":
            case " ":
                event.preventDefault();
                if (this.#activeOption && !isOptionDisabled(this.#activeOption)) {
                    this.multiple
                        ? this.#toggleOption(this.#activeOption)
                        : this.#selectOption(this.#activeOption);
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

        const origin = findOriginatingOption(event, this.options);
        if (origin) {
            this.multiple ? this.#toggleOption(origin) : this.#selectOption(origin);
            return;
        }
        const nextValue = event.detail?.value ?? "";
        this.multiple ? this.toggleValue(nextValue) : this.selectValue(nextValue);
    }

    public activeValueChanged(): void {
        if (this.#syncingActive || !this.$fastController.isConnected) {
            return;
        }
        this.#activeOption = getEnabledOptions(this.options).find(option => option.value === this.activeValue) ?? null;
        this.#syncOptions();
    }

    public selectedValuesChanged(): void {
        if (this.#syncingSelection || !this.$fastController.isConnected || !this.multiple) {
            return;
        }

        const enabled = getEnabledOptions(this.options);
        const wanted = new Set(this.selectedValues);
        this.#selectedOptions = enabled.filter(option => wanted.has(option.value));

        this.#syncingSelection = true;
        try {
            this.#updateExplicitValue(this.selectedValues.length > 0 ? (this.selectedValues[0] ?? null) : null, true);
        } finally {
            this.#syncingSelection = false;
        }

        this.#syncOptions();
    }

    public selectValue(nextValue: string, emit = true): void {
        const option = getEnabledOptions(this.options).find(candidate => candidate.value === nextValue) ?? null;
        if (!option) {
            return;
        }

        this.#selectOption(option, emit);
    }

    public toggleValue(nextValue: string, emit = true): void {
        const option = getEnabledOptions(this.options).find(candidate => candidate.value === nextValue) ?? null;
        if (!option) {
            return;
        }

        this.#toggleOption(option, emit);
    }

    public toggleAll(): void {
        const enabled = getEnabledOptions(this.options);
        const allSelected = enabled.every(option => this.#selectedOptions.includes(option));

        this.#selectedOptions = allSelected ? [] : [...enabled];
        this.#syncingSelection = true;
        try {
            this.selectedValues = this.#selectedOptions.map(option => option.value);
            this.#updateExplicitValue(this.#selectedOptions[0]?.value ?? null, true);
        } finally {
            this.#syncingSelection = false;
        }
        this.#applyActiveOption(enabled[0] ?? null);
        this.$emit("input", { value: this.value, selectedValues: [...this.selectedValues] });
        this.$emit("change", { value: this.value, selectedValues: [...this.selectedValues] });
    }

    #selectOption(option: VioletOption, emit = true): void {
        this.#selectedOptions = [option];
        this.#syncingSelection = true;
        try {
            this.#updateExplicitValue(option.value, true);
            this.selectedValues = [option.value];
        } finally {
            this.#syncingSelection = false;
        }
        this.#applyActiveOption(option);

        if (emit) {
            this.$emit("input", { value: this.value });
            this.$emit("change", { value: this.value });
        }
    }

    #toggleOption(option: VioletOption, emit = true): void {
        const selected = new Set(this.#selectedOptions);
        if (selected.has(option)) {
            selected.delete(option);
        } else {
            selected.add(option);
        }

        this.#selectedOptions = this.options.filter(candidate => selected.has(candidate));
        this.#syncingSelection = true;
        try {
            this.selectedValues = this.#selectedOptions.map(candidate => candidate.value);
            this.#updateExplicitValue(this.#selectedOptions[0]?.value ?? null, true);
        } finally {
            this.#syncingSelection = false;
        }
        this.#applyActiveOption(option);

        if (emit) {
            this.$emit("input", { value: this.value, selectedValues: [...this.selectedValues] });
            this.$emit("change", { value: this.value, selectedValues: [...this.selectedValues] });
        }
    }

    #setExplicitValue(next: string | null, reflect: boolean): void {
        this.#updateExplicitValue(next, reflect);
        if (!this.$fastController.isConnected) {
            return;
        }
        if (!this.multiple) {
            const selected = next === null ? null : getSelectedOption(this.options, next);
            this.#selectedOptions = selected ? [selected] : [];
            this.#syncingSelection = true;
            try {
                this.selectedValues = selected ? [selected.value] : [];
            } finally {
                this.#syncingSelection = false;
            }
        }
        this.#syncOptions();
    }

    #updateExplicitValue(next: string | null, reflect: boolean): void {
        const previous = this.#explicitValue ?? "";
        this.#explicitValue = next;
        if (reflect) {
            this.#reflectValueAttribute(next);
        }
        if (previous !== (next ?? "")) {
            Observable.notify(this, "value");
        }
    }

    #reflectValueAttribute(next: string | null): void {
        this.#reflectingValue = true;
        try {
            reflectStringAttribute(this, "value", next);
        } finally {
            this.#reflectingValue = false;
        }
    }

    #moveActive(step: 1 | -1): void {
        const options = this.options;
        const currentIndex = this.#activeOption ? options.indexOf(this.#activeOption) : -1;
        const nextIndex = getNextEnabledIndex(options, currentIndex < 0 ? (step === 1 ? -1 : 0) : currentIndex, step);
        this.#setActiveOption(nextIndex >= 0 ? (options[nextIndex] ?? null) : null);
    }

    #setActiveOption(nextOption: VioletOption | null): void {
        this.#applyActiveOption(nextOption);
        this.#scrollActiveIntoView();

        if (!this.multiple && this.selectionFollowsFocus && nextOption) {
            this.#selectOption(nextOption);
        }
    }

    #applyActiveOption(nextOption: VioletOption | null): void {
        this.#activeOption = nextOption;
        this.#syncOptions();
        this.#syncingActive = true;
        try {
            this.activeValue = nextOption?.value ?? "";
        } finally {
            this.#syncingActive = false;
        }
    }

    #queueTypeahead(key: string): void {
        window.clearTimeout(this.#typeaheadTimer);
        this.#typeaheadBuffer = `${this.#typeaheadBuffer}${key.toLowerCase()}`;

        const match = findTypeaheadMatch(this.options, this.#typeaheadBuffer, this.#activeOption);
        if (match) {
            this.#setActiveOption(match);
        }

        this.#typeaheadTimer = window.setTimeout(() => {
            this.#typeaheadBuffer = "";
        }, 500);
    }

    #scrollActiveIntoView(): void {
        this.#activeOption?.shadowRoot?.querySelector('[part="control"]')?.scrollIntoView({ block: "nearest" });
    }

    #syncOptions(): void {
        syncOptionSelection(this.options, this.#selectedOptions, this.#activeOption);
        const control = this.shadowRoot?.querySelector('[role="listbox"]');
        if (control) {
            control.ariaActiveDescendantElement = this.#activeOption;
        }
    }
}

attr(VioletListbox.prototype, "label");
attr({ mode: "boolean" })(VioletListbox.prototype, "disabled");
attr({ mode: "boolean" })(VioletListbox.prototype, "multiple");
attr({ mode: "boolean", attribute: "selection-follows-focus" })(VioletListbox.prototype, "selectionFollowsFocus");

/** The FAST definition of `<violet-listbox>`; `defineVioletListbox` in `./violet-listbox.define` registers it. */
export const violetListboxDefinition = {
    name: "violet-listbox",
    template,
    styles,
    shadowOptions: {
        delegatesFocus: true,
    },
} satisfies PartialFASTElementDefinition;

/** The FAST extensions `<violet-listbox>` is defined with. */
export const violetListboxExtensions: FASTElementExtension[] = [observeAttribute("value")];
