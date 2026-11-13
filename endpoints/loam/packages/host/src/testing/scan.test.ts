import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ensureCertificate } from '../dev-files.js';
import { temporaryDirectory } from '../test-support.js';
import { scanSecrets } from './scan.js';

const VALUE = 'planted-secret-0123456789';
const OTHER = 'other-secret-abcdefghij';
const GENERATED = 'generated-auth-secret-ABCDEFGHIJKLMNOPQRSTUV';

type Place = 'site' | 'journal' | 'store' | 'wal' | 'dev' | 'lock' | 'log';

/** A data directory shaped like the profile's, the value planted in each place the test names. */
async function host(plant: readonly Place[] = [], value = VALUE) {
	const data = await temporaryDirectory();
	const at = (place: Place) => (plant.includes(place) ? value : '');
	await mkdir(join(data, 'public', 'site', 'assets'), { recursive: true });
	await mkdir(join(data, 'secrets'));
	await writeFile(join(data, 'secrets', 'auth'), `${GENERATED}\n`);
	await writeFile(join(data, 'public', 'site', 'index.html'), '<!doctype html>');
	await writeFile(
		join(data, 'public', 'site', 'assets', 'a.js'),
		`export const a = "${at('site')}";`
	);
	await writeFile(join(data, 'journal.jsonl'), `{"input":"${at('journal')}"}\n`);
	const store = new DatabaseSync(join(data, 'loam.sqlite'));
	store.exec('CREATE TABLE records (tbl TEXT, id TEXT, value TEXT)');
	store.prepare('INSERT INTO records VALUES (?, ?, ?)').run('project', 'p1', at('store') || '{}');
	store.close();
	await writeFile(join(data, 'loam.sqlite-wal'), `frame ${at('wal')}`);
	await writeFile(join(data, 'dev.json'), `{"port":8443,"note":"${at('dev')}"}`);
	await writeFile(join(data, '.lock'), `{"pid":1,"host":"${at('lock')}"}`);
	const logs = [`started ${at('log')}`];
	return { data, logs: () => logs };
}

const page = (storage: string) => ({ evaluate: async () => storage });

describe('scanSecrets (5.2)', () => {
	it('finds nothing in a clean profile, though the profile holds its own secrets', async () => {
		const clean = await host();
		await ensureCertificate(clean.data);
		expect(await scanSecrets(clean, [page('theme=dark')], [VALUE, OTHER])).toEqual({ found: [] });
	});

	it('finds a known secret by value in every place it can be, and names each place, never the value', async () => {
		const scanned = await scanSecrets(
			await host(['site', 'journal', 'store', 'wal', 'dev', 'lock', 'log']),
			[page(`session=${VALUE}`)],
			[OTHER, VALUE]
		);
		expect(scanned.found).toEqual([
			'known[1] in file .lock',
			'known[1] in file dev.json',
			'known[1] in file journal.jsonl',
			'known[1] in file loam.sqlite',
			'known[1] in file loam.sqlite-wal',
			'known[1] in file public/site/assets/a.js',
			'known[1] in store loam.sqlite',
			'known[1] in the server log',
			"known[1] in page 0's storage",
		]);
		expect(JSON.stringify(scanned)).not.toContain(VALUE);
		expect(JSON.stringify(scanned)).not.toContain(OTHER);
	});

	it("finds the profile's generated secret and its TLS key wherever a copy is, but not in their own files", async () => {
		const leaked = await host(['log', 'wal'], GENERATED);
		const { key } = await ensureCertificate(leaked.data);
		const { readFileSync } = await import('node:fs');
		const body = readFileSync(key, 'utf8')
			.split('\n')
			.filter((line) => line && !line.startsWith('-----'))
			.join('');
		await writeFile(join(leaked.data, 'copied-key.txt'), `oops ${body}`);
		const scanned = await scanSecrets(leaked, [], []);
		expect(scanned.found).toEqual([
			'auth secret in file loam.sqlite-wal',
			'auth secret in the server log',
			'tls key in file copied-key.txt',
		]);
	});

	it("reads the lock's bytes but never opens it as a store", async () => {
		const held = await host(['lock']);
		await writeFile(join(held.data, 'lock.sqlite'), `not a database ${VALUE}`);
		expect((await scanSecrets(held, [], [VALUE])).found).toContain('known[0] in file lock.sqlite');
	});

	it('refuses a secret too short to scan for', async () => {
		await expect(scanSecrets(await host(), [], ['short'])).rejects.toThrow('too short');
	});
});
