/**
 * Trust Events - AFD trust signals for component events.
 *
 * @packageDocumentation
 */

export type {
    TrustEmitOptions,
    TrustSignals,
    Warning,
    WarningSeverity,
} from "./types.js";
export { TRUST_KEY } from "./types.js";
export { getTrustSignals, hasTrustSignals } from "./utils.js";
