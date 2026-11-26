/**
 * @fileoverview How `startDevHost` runs the development profile: by default as a child process
 * (`child-launcher.ts`), so a test can kill it; in this package's units, in-process.
 */

import type { ServerConfigV1 } from '@lushly-dev/loam-manifest/server';
import type { TestOAuthV1 } from '../provider.js';
import type { ChildReady } from './protocol.js';

export interface Launched {
	ready: ChildReady;
	/** Ends the profile: `SIGTERM` closes it and releases the lock, `SIGKILL` leaves it as a crash would. */
	stop(signal: 'SIGTERM' | 'SIGKILL'): Promise<void>;
}

/** Starts the profile for `deployment`, appending its log lines to `logs`. */
export type Launcher = (
	deployment: string,
	env: Record<string, string>,
	logs: string[],
	/** Tests only: the provider's rate limit, raised for a suite's many requests from one address (never off). */
	rateLimit?: { window: number; max: number },
	/** Tests only: the server configuration's `[limits]`, such as P6-H6's short relay limits. */
	limits?: ServerConfigV1['limits'],
	/** Tests only: phase 3's step 10's authorization server options, such as P3-H1's second resource. */
	testOAuth?: TestOAuthV1
) => Promise<Launched>;
