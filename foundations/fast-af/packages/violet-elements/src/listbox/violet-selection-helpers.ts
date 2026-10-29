import type { VioletOption } from "../option/violet-option";

export function normalizeMatchText(value: string): string {
    return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function isOptionDisabled(option: VioletOption): boolean {
    const group = option.closest("violet-option-group") as { disabled?: boolean } | null;
    return Boolean(option.disabled || group?.disabled);
}

export function getOwnedOptions(host: Element): VioletOption[] {
    const selector = host.localName;

    return Array.from(host.querySelectorAll("violet-option")).filter(
        (option): option is VioletOption => option.closest(selector) === host
    );
}

export function getEnabledOptions(options: VioletOption[]): VioletOption[] {
    return options.filter(option => !isOptionDisabled(option));
}

export function getSelectedOption(options: VioletOption[], value: string): VioletOption | null {
    if (!value) {
        return options.find(option => option.selected && !isOptionDisabled(option)) ?? null;
    }

    return options.find(option => option.value === value && !isOptionDisabled(option)) ?? null;
}

export function getNextEnabledIndex(options: VioletOption[], currentIndex: number, step: 1 | -1): number {
    if (options.length === 0) {
        return -1;
    }

    let index = currentIndex;

    for (let count = 0; count < options.length; count += 1) {
        index = (index + step + options.length) % options.length;

        if (options[index] && !isOptionDisabled(options[index])) {
            return index;
        }
    }

    return -1;
}

export function findTypeaheadMatch(
    options: VioletOption[],
    buffer: string,
    activeValue: string
): VioletOption | null {
    const enabled = getEnabledOptions(options);

    if (enabled.length === 0 || !buffer) {
        return null;
    }

    const normalized = normalizeMatchText(buffer.trim());
    const currentIndex = enabled.findIndex(option => option.value === activeValue);
    const ordered = currentIndex >= 0 ? [...enabled.slice(currentIndex + 1), ...enabled.slice(0, currentIndex + 1)] : enabled;

    return ordered.find(option => normalizeMatchText(option.labelText).startsWith(normalized)) ?? null;
}

export function syncOptionSelection(
    options: VioletOption[],
    selectedValues: string[] | string,
    activeValue: string
): void {
    const selection = new Set(Array.isArray(selectedValues) ? selectedValues : selectedValues ? [selectedValues] : []);

    for (const option of options) {
        option.groupDisabled = Boolean((option.closest("violet-option-group") as { disabled?: boolean } | null)?.disabled);
        option.selected = selection.has(option.value);
        option.active = activeValue !== "" && option.value === activeValue;
    }
}
