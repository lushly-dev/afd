/**
 * @fileoverview `scanSecrets` (phase 6 specification, 5.2): section 13's secrets looked for wherever a
 * development profile could have let one out.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SECRETS_DIRECTORY, TLS_DIRECTORY } from '../dev-files.js';

/** What the scan reads of a `DevHost`: its data directory and its logs. */
export interface ScannedHost {
	readonly data: string;
	logs(): string[];
}

/** A page whose storage the scan reads: Playwright's `Page` fits. */
export interface ScannedPage {
	evaluate(script: string): Promise<unknown>;
}

function filesBelow(directory: string): string[] {
	if (!existsSync(directory)) return [];
	const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
		a.name < b.name ? -1 : a.name > b.name ? 1 : 0
	);
	return entries.flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return filesBelow(path);
		return entry.isFile() ? [path] : [];
	});
}

function storeRows(path: string): string {
	const database = new DatabaseSync(path, { readOnly: true });
	try {
		const tables = database
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all() as Array<{ name: string }>;
		return tables
			.map(({ name }) =>
				JSON.stringify(database.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all())
			)
			.join('\n');
	} finally {
		database.close();
	}
}

/**
 * What a page holds in `localStorage` and every IndexedDB store it can open, as a script, since this
 * package has no DOM types: `Page.evaluate` takes one as a string.
 */
const PAGE_STORAGE = `(async () => {
	const parts = [];
	for (let index = 0; index < localStorage.length; index++) {
		const key = localStorage.key(index) ?? '';
		parts.push(key + '=' + localStorage.getItem(key));
	}
	for (const { name } of await indexedDB.databases()) {
		if (!name) continue;
		const database = await new Promise((done, fail) => {
			const request = indexedDB.open(name);
			request.onsuccess = () => done(request.result);
			request.onerror = () => fail(request.error);
		});
		for (const store of [...database.objectStoreNames]) {
			const rows = await new Promise((done, fail) => {
				const request = database.transaction(store).objectStore(store).getAll();
				request.onsuccess = () => done(request.result);
				request.onerror = () => fail(request.error);
			});
			parts.push(JSON.stringify(rows));
		}
		database.close();
	}
	return parts.join('\\n');
})()`;

/** The two files that hold the profile's own secrets: what the scan looks for, never where. */
const SECRET_FILES = [join(SECRETS_DIRECTORY, 'auth'), join(TLS_DIRECTORY, 'key.pem')];

/** A PEM file's base64 body, its lines joined: what would show if the key were copied anywhere. */
function pemBody(path: string): string {
	return readFileSync(path, 'utf8')
		.split('\n')
		.filter((line) => line && !line.startsWith('-----'))
		.join('');
}

/**
 * Scans for section 13's secrets: the bytes of every regular file under the data directory but the two
 * that hold the profile's own secrets (so the served files, the projection, the journal, `dev.json`,
 * `.lock`, every store with its `-wal` and `-journal` files, and any log written there), every store's
 * rows, the server's logs, and each page's `localStorage` and IndexedDB. It looks for the `known` secrets,
 * the profile's generated auth secret and its TLS key's body. `found` names each secret by its index in
 * `known` (or `auth secret`, `tls key`) and where it was found, never its value, so a failing assertion
 * cannot print one.
 */
export async function scanSecrets(
	host: ScannedHost,
	pages: readonly ScannedPage[],
	known: readonly string[]
): Promise<{ found: string[] }> {
	const places: Array<[string, string]> = [];
	const relative = (file: string) => file.slice(host.data.length + 1);
	for (const file of filesBelow(host.data)) {
		if (SECRET_FILES.includes(relative(file))) continue;
		places.push([`file ${relative(file)}`, readFileSync(file).toString('latin1')]);
	}
	// A store's rows too, since a value long enough spans its pages. Not `lock.sqlite`, which the server
	// holds exclusively: its bytes are read above, and it holds nothing but the time it was taken.
	for (const file of filesBelow(host.data).filter(
		(path) => path.endsWith('.sqlite') && !path.endsWith('lock.sqlite')
	))
		if (statSync(file).size > 0) places.push([`store ${relative(file)}`, storeRows(file)]);
	places.push(['the server log', host.logs().join('\n')]);
	for (const [index, page] of pages.entries())
		places.push([`page ${index}'s storage`, String(await page.evaluate(PAGE_STORAGE))]);
	const secrets: Array<[string, string]> = known.map((value, index) => [`known[${index}]`, value]);
	const generated = join(host.data, SECRETS_DIRECTORY, 'auth');
	if (existsSync(generated)) secrets.push(['auth secret', readFileSync(generated, 'utf8').trim()]);
	const key = join(host.data, TLS_DIRECTORY, 'key.pem');
	if (existsSync(key)) secrets.push(['tls key', pemBody(key)]);
	const found: string[] = [];
	for (const [name, value] of secrets) {
		if (value.length < 8) throw new Error(`${name} is too short to scan for.`);
		for (const [place, text] of places) if (text.includes(value)) found.push(`${name} in ${place}`);
	}
	return { found };
}
