/**
 * Severity of a {@link Warning}.
 * @public
 */
export type WarningSeverity = "info" | "warning" | "caution";

/**
 * A non-fatal issue surfaced alongside an event.
 *
 * @remarks
 * Local stub that mirrors the `Warning` type of AFD's `CommandResult`; it can be
 * re-exported from `@lushly-dev/afd-core` once that package is a dependency.
 *
 * @public
 */
export interface Warning {
    /** Machine-readable warning code. */
    code: string;
    /** Human-readable warning message. */
    message: string;
    /** Optional severity. Unknown values are dropped when signals are read. */
    severity?: WarningSeverity;
    /** Optional structured details. Only plain objects are kept when signals are read. */
    details?: Record<string, unknown>;
}

/**
 * Trust signals attached to component events.
 * @public
 */
export interface TrustSignals {
    /** Confidence level 0-1. Higher = more certain. */
    confidence?: number;
    /** Human-readable explanation of why this event occurred. */
    reasoning?: string;
    /** Non-fatal issues to surface to the user. An empty array is preserved. */
    warnings?: Warning[];
}

/**
 * Extended emit options with trust signals.
 * @public
 */
export interface TrustEmitOptions extends Omit<CustomEventInit, "detail">, TrustSignals {}

/**
 * Property key (the string `"__trust"`) under which trust metadata is stored in
 * event detail.
 * @public
 */
export const TRUST_KEY = "__trust" as const;
