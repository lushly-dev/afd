import type { TrustSignals, Warning, WarningSeverity } from "./types.js";
import { TRUST_KEY } from "./types.js";

const warningSeverities: ReadonlySet<unknown> = new Set<WarningSeverity>([
    "info",
    "warning",
    "caution",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object") {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/**
 * Normalize untrusted warnings: non-arrays yield `undefined`; entries without a string
 * `code` and `message` are dropped; invalid `severity` / non-plain `details` are omitted.
 */
function sanitizeWarnings(value: unknown): Warning[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const warnings: Warning[] = [];
    for (const entry of value) {
        if (
            !isPlainObject(entry) ||
            typeof entry.code !== "string" ||
            typeof entry.message !== "string"
        ) {
            continue;
        }

        const warning: Warning = { code: entry.code, message: entry.message };
        if (warningSeverities.has(entry.severity)) {
            warning.severity = entry.severity as WarningSeverity;
        }
        if (isPlainObject(entry.details)) {
            warning.details = entry.details;
        }
        warnings.push(warning);
    }

    return warnings;
}

/**
 * Extract trust signals from a CustomEvent.
 * Returns empty object if no trust signals present.
 * @public
 */
export function getTrustSignals(event: CustomEvent): TrustSignals {
    const detail = event.detail;
    if (detail && typeof detail === "object" && TRUST_KEY in detail) {
        const trust = detail[TRUST_KEY];

        if (trust && typeof trust === "object") {
            const signals = trust as TrustSignals;
            const confidence = signals.confidence;
            const warnings = sanitizeWarnings(signals.warnings);
            return {
                ...(typeof confidence === "number" &&
                Number.isFinite(confidence) &&
                confidence >= 0 &&
                confidence <= 1
                    ? { confidence }
                    : {}),
                ...(typeof signals.reasoning === "string"
                    ? { reasoning: signals.reasoning }
                    : {}),
                ...(warnings !== undefined ? { warnings } : {}),
            };
        }
    }
    return {};
}

/**
 * Check if an event has trust signals.
 * @public
 */
export function hasTrustSignals(event: CustomEvent): boolean {
    const signals = getTrustSignals(event);
    return (
        signals.confidence !== undefined ||
        signals.reasoning !== undefined ||
        signals.warnings !== undefined
    );
}

/**
 * Wrap detail with trust signals.
 *
 * @remarks
 * - Plain objects are copied and the signals are added under {@link TRUST_KEY}.
 * - Anything else (primitives, arrays, Dates, class instances, ...) is wrapped in a
 *   `{ value, __trust }` envelope so it is never spread into a different shape.
 * - A `__trust` key already present on a plain-object detail is caller-supplied
 *   (often from parsed JSON) and is never kept: it is replaced by the real signals,
 *   or dropped when there are none, so detail data cannot forge trust signals.
 *
 * @internal
 */
export function wrapDetailWithTrust(detail: unknown, signals?: TrustSignals): unknown {
    const { confidence, reasoning } = signals ?? {};
    const warnings = Array.isArray(signals?.warnings) ? signals.warnings : undefined;

    if (confidence === undefined && reasoning === undefined && warnings === undefined) {
        if (isPlainObject(detail) && TRUST_KEY in detail) {
            const { [TRUST_KEY]: _forged, ...rest } = detail;
            return rest;
        }

        return detail; // No-op when no trust signals
    }

    if (
        confidence !== undefined &&
        (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    ) {
        throw new RangeError("Trust confidence must be a finite number from 0 to 1.");
    }

    const trust: TrustSignals = {};
    if (confidence !== undefined) trust.confidence = confidence;
    if (reasoning !== undefined) trust.reasoning = reasoning;
    if (warnings !== undefined)
        trust.warnings = warnings.map(warning => ({ ...warning }));

    if (isPlainObject(detail)) {
        const { [TRUST_KEY]: _forged, ...rest } = detail;
        return { ...rest, [TRUST_KEY]: trust };
    }

    // Wrap everything that is not a plain object in an envelope
    return { value: detail, [TRUST_KEY]: trust };
}
