/**
 * @fileoverview The scenario runner's fixture adapter for `app: seed-library`.
 *
 * No command creates a member, a variety or a lot, so the adapter loads a fixture into the
 * library's store directly instead of replaying commands, and stops the clock at its `now`.
 */

import type { AppAdapter } from '@lushly-dev/afd-testing';
import type { SeedLibrary } from './app.js';
import { type LibraryFixtureInput, libraryFixtureSchema } from './fixture.js';

/** An adapter that loads each scenario's fixture into the library `target()` returns. */
export function createSeedLibraryAdapter(target: () => SeedLibrary): AppAdapter {
	const commandNames = () => target().commands.map((command) => command.name);
	return {
		name: 'seed-library',
		version: '0.1.0',
		cli: { command: 'afd', inputFormat: 'json-arg', outputFormat: 'json' },
		fixture: {
			async apply(fixture) {
				target().load(fixture as LibraryFixtureInput);
				return { appliedCommands: [] };
			},
			async reset() {
				target().store.load(
					libraryFixtureSchema.parse({ app: 'seed-library', now: '1970-01-01T00:00:00Z' })
				);
			},
			async validate(fixture) {
				const parsed = libraryFixtureSchema.safeParse(fixture);
				return parsed.success
					? { valid: true }
					: {
							valid: false,
							errors: parsed.error.issues.map(
								(issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`
							),
						};
			},
		},
		commands: {
			list: commandNames,
			getDescription: (name) =>
				target().commands.find((command) => command.name === name)?.description ?? name,
		},
		errors: {
			list: () => [...new Set(target().commands.flatMap((command) => command.errors ?? []))],
			isRetryable: (code) => code === 'SERVICE_UNAVAILABLE',
		},
		jobs: { list: () => [] },
	};
}
