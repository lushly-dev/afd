/**
 * @fileoverview Serve the library over HTTP, from `scenarios/fixtures/library.json`, for
 * `afd connect`, `afd validate` and `afd scenario run`.
 *
 * - `PORT`: default 3100.
 * - `SEED_LIBRARY_FIXTURE`: a fixture file to start from instead.
 * - `SEED_LIBRARY_ACTOR=steward`: every call is the steward, a person, as a host that signed
 *   the steward in would say. Without it every call is an agent, and the steward's commands
 *   are refused.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMcpServer } from '@lushly-dev/afd-server';
import { createSeedLibrary } from './app.js';
import type { LibraryFixtureInput } from './fixture.js';
import { seedLibraryServerOptions } from './server.js';

const fixturePath =
	process.env.SEED_LIBRARY_FIXTURE ??
	fileURLToPath(new URL('../scenarios/fixtures/library.json', import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as LibraryFixtureInput;
const library = createSeedLibrary({ fixture });

const server = createMcpServer({
	...seedLibraryServerOptions(library, {
		port: Number(process.env.PORT ?? 3100),
		...(process.env.SEED_LIBRARY_ACTOR === 'steward' && {
			actor: { kind: 'human', id: 'steward', label: 'The steward' },
		}),
	}),
	transport: 'http',
});

await server.start();
console.error(`[seed-library] serving ${fixturePath} at ${server.getUrl()}`);
