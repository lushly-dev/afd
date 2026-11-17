import { resolve } from 'node:path';
import { openPond, PondJournalError, PondReplayError } from './app.js';

const [name = 'pond-status', json = '{}'] = process.argv.slice(2);
const journalPath = resolve(process.env.POND_JOURNAL ?? 'pond.jsonl');

let input: unknown;
try {
	input = JSON.parse(json);
} catch {
	console.error(`The input is not JSON: ${json}`);
	console.error(
		'Usage: node dist/cli.js <command> [json input], e.g. pond-stock \'{"species":"koi"}\''
	);
	process.exit(2);
}

try {
	const { replay, run } = await openPond({ journalPath });
	console.error(`Replayed ${replay.same} journal entries from ${journalPath}`);
	const result = await run(name, input);
	console.log(JSON.stringify(result, null, 2));
	process.exitCode = result.success ? 0 : 1;
} catch (error) {
	if (error instanceof PondReplayError) {
		console.error(error.message);
		console.error(
			'The pond was not rebuilt. If the commands changed since the journal was written, run the version that wrote it, or start a new journal.'
		);
		process.exitCode = 2;
	} else if (error instanceof PondJournalError) {
		console.error(error.message);
		console.error(
			'The pond was not rebuilt. Repair or remove the damaged line, or start a new journal.'
		);
		process.exitCode = 2;
	} else {
		throw error;
	}
}
