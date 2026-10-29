export function normalizeReferencePickerValues(values: readonly unknown[]): string[] {
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

export function parseReferencePickerValue(value: unknown): string[] {
    if (Array.isArray(value)) {
        return normalizeReferencePickerValues(value);
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
            return normalizeReferencePickerValues(parsed);
        }
    } catch {
        // Fall through to a delimiter parse for integration surfaces that still
        // pass plain strings instead of a serialized array.
    }

    return normalizeReferencePickerValues(trimmedValue.split(/\s*,\s*/u));
}

export function serializeReferencePickerValue(values: readonly unknown[]): string {
    return JSON.stringify(normalizeReferencePickerValues(values));
}
