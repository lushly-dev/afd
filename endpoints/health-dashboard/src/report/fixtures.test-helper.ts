/** Test helper: committed fixtures, read from disk (Node only). */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url));

export const fixture = (path: string) => readFileSync(join(FIXTURES, path), 'utf8');

export const fixtureNames = (directory: 'reports' | 'invalid') =>
	readdirSync(join(FIXTURES, directory))
		.filter((name) => name.endsWith('.json'))
		.sort();
