/**
 * D2 (documents specification, 14 and section 1): a second document type lands with no shell change, so no
 * file of the kernel, the chrome or the web host's source names either type. A unit of the web host, outside
 * `src`, which step 13 leaves unchanged: `web` depends on the kernel and the chrome, so a change in any of the
 * three runs it. Beside `src/shell-independence.test.ts`, which holds the same for the project-scoped app.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = fileURLToPath(new URL('../../../', import.meta.url));
const SCANNED = ['kernel', 'chrome', 'web/src'];

/**
 * `notes-`, any command, element or package of notes; `notes` quoted, as an id is written in code, with
 * single, double or back quotes; and `checklist` in any case: id, title, code or name.
 */
const NAMED = /notes-|['"`]notes['"`]|checklist/i;

/**
 * The only lines let through, each by its file and its whole text, so a new line in either file still fails:
 * two pieces of the chrome's prose that are not the type, the design rules' component checklist and an
 * example of a type's plural title.
 */
const ALLOWED: ReadonlyArray<{ file: string; line: string }> = [
	{
		file: 'chrome/specimens/chrome.specimens.ts',
		line: " * The chrome's fixtures (component checklist item 5): the whole shell, and each part on its own.",
	},
	{
		file: 'chrome/src/sections/documents-sidebar.ts',
		line: "/** A type's title in the plural, as the tree names its branch: `Notes`, `Checklists`. */",
	},
];

function sources(directory: string): string[] {
	return readdirSync(directory).flatMap((name) => {
		const path = join(directory, name);
		if (['node_modules', 'dist', 'coverage', 'test-results'].includes(name)) return [];
		return statSync(path).isDirectory() ? sources(path) : [path];
	});
}

/** Every line naming a type in `files`, as `file:line: text`, but the allowed ones. */
function offenders(files: Record<string, string>): string[] {
	return Object.entries(files).flatMap(([file, text]) =>
		text
			.split('\n')
			.flatMap((line, index) =>
				NAMED.test(line) &&
				!ALLOWED.some((allowed) => allowed.file === file && allowed.line === line)
					? [`${file}:${index + 1}: ${line.trim()}`]
					: []
			)
	);
}

describe('the shell names no document type', () => {
	it('P2-D2: names `notes-`, a quoted `notes` and `checklist`, in any case, nowhere in kernel, chrome or web/src', () => {
		const files = Object.fromEntries(
			SCANNED.flatMap((directory) => sources(join(PACKAGES, directory))).map((path) => [
				// Keys use '/' on every system, as ALLOWED writes them.
				relative(PACKAGES, path).split(sep).join('/'),
				readFileSync(path, 'utf8'),
			])
		);
		expect(Object.keys(files).length).toBeGreaterThan(100);
		expect(offenders(files)).toEqual([]);
		// Each allowed line is still there, so the list cannot outlive what it lets through.
		for (const { file, line } of ALLOWED) expect(files[file]?.split('\n'), file).toContain(line);
	});

	it('P2-D2: the scan finds every form of the names, and lets through only the allowed lines', () => {
		for (const text of [
			'notes-editor',
			"type: 'checklist'",
			"title: 'Checklist'",
			'CHECKLIST_ITEM_EXISTS',
			'checklist-item-add',
			'apps/checklist',
			"type: 'notes'",
			'instance: "notes"',
			'type: `notes`',
			"['Notes', 'NOTES']",
		]) {
			expect(offenders({ 'kernel/src/planted.ts': text }), text).toHaveLength(1);
		}
		for (const text of ['notes, a type', 'the notes type', "a person's notes", 'notesCount'])
			expect(offenders({ 'kernel/src/planted.ts': text }), text).toEqual([]);
		// An allowed line passes only in its own file, and a changed line in that file fails.
		const [first] = ALLOWED as [{ file: string; line: string }];
		expect(offenders({ [first.file]: first.line })).toEqual([]);
		expect(offenders({ 'chrome/src/other.ts': first.line })).toHaveLength(1);
		expect(offenders({ [first.file]: `${first.line} checklist` })).toHaveLength(1);
	});
});
