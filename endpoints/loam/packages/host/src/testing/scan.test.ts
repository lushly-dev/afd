import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { temporaryDirectory } from '../test-support.js';
import { scanSecrets } from './scan.js';

const BEARER = 'bearer-value-0123456789';
const COOKIE = 'cookie-value-abcdefghij';
const GENERATED = 'generated-auth-secret-ABCDEFGHIJKLMNOPQRSTUV';

/** A data directory shaped like the profile's, a secret planted where the test names. */
async function host(
	plant: Partial<Record<'site' | 'journal' | 'store' | 'log' | 'lock', string>> = {}
) {
	const data = await temporaryDirectory();
	await mkdir(join(data, 'public', 'site', 'assets'), { recursive: true });
	await mkdir(join(data, 'secrets'));
	await writeFile(join(data, 'secrets', 'auth'), `${GENERATED}\n`);
	await writeFile(join(data, 'public', 'site', 'index.html'), '<!doctype html>');
	await writeFile(
		join(data, 'public', 'site', 'assets', 'a.js'),
		`export const a = "${plant.site ?? ''}";`
	);
	await writeFile(join(data, 'journal.jsonl'), `{"input":"${plant.journal ?? ''}"}\n`);
	const store = new DatabaseSync(join(data, 'loam.sqlite'));
	store.exec('CREATE TABLE records (tbl TEXT, id TEXT, value TEXT)');
	store.prepare('INSERT INTO records VALUES (?, ?, ?)').run('project', 'p1', plant.store ?? '{}');
	store.close();
	// The lock's file is never opened: the server holds it exclusively.
	await writeFile(join(data, 'lock.sqlite'), plant.lock ?? 'not a database');
	const logs = [`started ${plant.log ?? ''}`];
	return { data, logs: () => logs };
}

const page = (storage: string) => ({ evaluate: async () => storage });

describe('scanSecrets (5.2)', () => {
	it('finds nothing in a clean profile', async () => {
		expect(await scanSecrets(await host(), [page('theme=dark')], [BEARER, COOKIE])).toEqual({
			found: [],
		});
	});

	it('finds each known secret by value and reports it by name and place, never by value', async () => {
		const scanned = await scanSecrets(
			await host({ site: BEARER, journal: COOKIE, store: BEARER, log: COOKIE }),
			[page(`session=${COOKIE}`)],
			[BEARER, COOKIE]
		);
		expect(scanned.found).toEqual([
			'known[0] in served file public/site/assets/a.js',
			'known[0] in store loam.sqlite',
			'known[1] in file journal.jsonl',
			'known[1] in the server log',
			"known[1] in page 0's storage",
		]);
		expect(JSON.stringify(scanned)).not.toContain(BEARER);
		expect(JSON.stringify(scanned)).not.toContain(COOKIE);
	});

	it("finds the profile's generated secret by itself, and never reads the lock's file", async () => {
		const scanned = await scanSecrets(await host({ log: GENERATED, lock: GENERATED }), [], []);
		expect(scanned.found).toEqual(['auth secret in the server log']);
	});

	it('refuses a secret too short to scan for', async () => {
		await expect(scanSecrets(await host(), [], ['short'])).rejects.toThrow('too short');
	});
});
