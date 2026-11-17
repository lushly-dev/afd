/**
 * @fileoverview Run one pond command against a journal file, rebuilding the pond from it first.
 *
 *   node dist/cli.js <command> [json input]
 *
 * POND_JOURNAL names the journal file (default `pond.jsonl` in the working directory).
 */

import { resolve } from 'node:path';
import { openPond, PondReplayError } from './app.js';

const [name = 'pond-status', json = '{}'] = process.argv.slice(2);
const journalPath = resolve(process.env.POND_JOURNAL ?? 'pond.jsonl');

try {
	const { replay, run } = await openPond({ journalPath });
	console.error(`Replayed ${replay.same} journal entries from ${journalPath}`);
	const result = await run(name, JSON.parse(json));
	console.log(JSON.stringify(result, null, 2));
	process.exitCode = result.success ? 0 : 1;
} catch (error) {
	if (error instanceof PondReplayError) {
		console.error(error.message);
		console.error(
			'The pond was not rebuilt. If the commands changed since the journal was written, run the version that wrote it, or start a new journal.'
		);
		process.exitCode = 2;
	} else {
		throw error;
	}
}
