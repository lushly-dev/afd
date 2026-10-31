import { randomUUID } from 'node:crypto';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pause = () => new Promise((done) => setTimeout(done, 20));

/** Explicit diagnostic barrier; never active during ordinary resource acceptance. */
export function createCpuProfileControl(directory, runtimeIsolation) {
	if (!directory) return undefined;
	const roles = runtimeIsolation === 'process' ? ['coordinator', 'worker'] : ['coordinator'];
	const nonce = randomUUID();
	let identities;
	async function receipts(event) {
		const files = (await readdir(directory)).filter((name) => name.endsWith(`.${event}.json`));
		return Promise.all(
			files.map(async (name) => JSON.parse(await readFile(join(directory, name), 'utf8')))
		);
	}
	async function wait(event) {
		const deadline = Date.now() + 10_000;
		while (Date.now() < deadline) {
			const errors = await receipts('error');
			if (errors.length) throw new Error(`CPU profiler failed: ${JSON.stringify(errors)}`);
			const rows = await receipts(event);
			const selected = roles.map((role) =>
				rows.filter(
					(row) =>
						row.role === role &&
						(role === 'coordinator' ? row.pid === process.pid : row.ppid === process.pid) &&
						(event === 'ready' || row.nonce === nonce) &&
						(!identities ||
							identities.some((identity) => identity.role === role && identity.pid === row.pid))
				)
			);
			if (selected.some((matches) => matches.length > 1))
				throw new Error('Multiple CPU profilers match one role');
			if (selected.every((matches) => matches.length === 1)) return selected.map(([row]) => row);
			await pause();
		}
		throw new Error(`CPU profiler ${event} barrier exceeded 10000ms`);
	}
	async function marker(name) {
		const file = join(directory, `${name}.json`);
		await writeFile(
			`${file}.tmp`,
			`${JSON.stringify({ createdUtc: new Date().toISOString(), nonce })}\n`
		);
		await rename(`${file}.tmp`, file);
	}
	return {
		async start() {
			identities = await wait('ready');
			await marker('start');
			return wait('started');
		},
		async stop() {
			await marker('stop');
			return wait('stopped');
		},
	};
}
