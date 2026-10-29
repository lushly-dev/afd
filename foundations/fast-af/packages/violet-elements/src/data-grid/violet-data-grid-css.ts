/**
 * Guards consumer-supplied values (column widths, option colours) that the grid
 * interpolates into inline `style` strings. A value is only accepted when it is
 * a single valid value for the property: anything that could close the
 * declaration or open another one (`;`, braces, comments, `url(`) is refused.
 */
export function safeCssValue(property: string, value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed || /[;{}\\]|\/\*|url\s*\(|expression\s*\(/i.test(trimmed)) {
        return undefined;
    }

    if (typeof CSS !== "undefined" && typeof CSS.supports === "function" && !CSS.supports(property, trimmed)) {
        return undefined;
    }

    return trimmed;
}
