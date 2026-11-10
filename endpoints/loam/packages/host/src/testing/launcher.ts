/**
 * @fileoverview How `startDevHost` runs the development profile: by default as a child process
 * (`child-launcher.ts`), so a test can kill it; in this package's units, in-process.
 */

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
	logs: string[]
) => Promise<Launched>;
