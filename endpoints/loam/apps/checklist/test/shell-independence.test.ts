/**
 * D2 (documents specification, 14 and section 1): a second document type lands with no shell change, so no
 * file of the kernel, the chrome or the web host's source names either type. The scan reads those packages
 * from here, as this package's own test; `scripts/affected/scope.mjs` names them as its inputs, so a change
 * there runs it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = fileURLToPath(new URL('../../../packages/', import.meta.url));
const SCANNED = ['kernel', 'chrome', 'web/src'];

/**
 * `notes-`, any command, element or package of notes; and `checklist`, as the type's id, commands, resource
 * and package spell it, case and all. Two words of the chrome's prose are not the type, so they pass: the
 * design rules' "component checklist", and `Checklists` as an example of a type's plural title.
 */
const NAMED = /notes-|(?<!component )checklist/;

function sources(directory: string): string[] {
	return readdirSync(directory).flatMap((name) => {
		const path = join(directory, name);
		if (['node_modules', 'dist', 'coverage', 'test-results'].includes(name)) return [];
		return statSync(path).isDirectory() ? sources(path) : [path];
	});
}

const offenders = (pattern: RegExp) =>
	SCANNED.flatMap((directory) => sources(join(PACKAGES, directory)))
		.filter((path) => pattern.test(readFileSync(path, 'utf8')))
		.map((path) => relative(PACKAGES, path));

describe('the shell names no document type', () => {
	it('P2-D2: names `notes-` and `checklist` nowhere in kernel, chrome or web/src', () => {
		const scanned = SCANNED.flatMap((directory) => sources(join(PACKAGES, directory)));
		expect(scanned.length).toBeGreaterThan(100);
		expect(offenders(NAMED)).toEqual([]);
	});

	it('P2-D2: the scan finds each name where it is, and lets the design rules’ word through', () => {
		for (const text of ['notes-editor', "type: 'checklist'", 'apps/checklist', 'checklist-get']) {
			expect(NAMED.test(text), text).toBe(true);
		}
		expect(NAMED.test('The component checklist, item 5')).toBe(false);
		expect(NAMED.test('in the plural: `Notes`, `Checklists`')).toBe(false);
		expect(NAMED.test('notes, a type')).toBe(false);
	});
});
