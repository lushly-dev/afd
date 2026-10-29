export function normalizeMultiPickerValues(values: readonly unknown[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const value of values) {
        const nextValue = String(value ?? "").trim();
        if (!nextValue || seen.has(nextValue)) {
            continue;
        }

        seen.add(nextValue);
        normalized.push(nextValue);
    }

    return normalized;
}

export function parseMultiPickerValue(value: unknown): string[] {
    if (Array.isArray(value)) {
        return normalizeMultiPickerValues(value);
    }

    if (typeof value !== "string") {
        return [];
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) {
        return [];
    }

    try {
        const parsed = JSON.parse(trimmedValue) as unknown;
        if (Array.isArray(parsed)) {
            return normalizeMultiPickerValues(parsed);
        }
    } catch {
        // Fall through to a simple delimiter parse for integration surfaces
        // that pass plain strings instead of JSON.
    }

    return normalizeMultiPickerValues(trimmedValue.split(/\s*,\s*/u));
}

export function serializeMultiPickerValue(values: readonly unknown[]): string {
    return JSON.stringify(normalizeMultiPickerValues(values));
}
