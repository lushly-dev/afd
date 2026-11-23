/**
 * @fileoverview The kernel's reshow mark (phase 5 specification, 7.2), in a module of its own so `late` and the
 * confirmations' chunk share one unforgeable symbol without `late` importing `confirmation-parts.ts`.
 */

import type { AskedPreviewV1 } from './confirmation-parts.js';

/**
 * The kernel's own mark that a confirmed run's preview changed since the person looked (phase 5 specification, 7.2):
 * a symbol, so no result a server or an app returns can carry it (the trust review's B2).
 */
export const RESHOW: unique symbol = Symbol('dev.loam/reshow');
export interface ReshowV1 {
	[RESHOW]: AskedPreviewV1;
}
