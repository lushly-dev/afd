/**
 * @fileoverview The pond: an event-sourced simulation whose only stored state is its command
 * journal. See README.md for what the app keeps deterministic itself.
 */

export { type OpenedPond, type OpenPondOptions, openPond, PondReplayError } from './app.js';
export { createPondCommands } from './commands.js';
export {
	type Fish,
	MAX_RANDOM_READS,
	MAX_TICK_DAYS,
	POND_CAPACITY,
	Pond,
	SPECIES,
	type Species,
	type TickOutcome,
} from './pond.js';
