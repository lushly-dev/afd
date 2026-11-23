/**
 * Browser-safe Specimen plugin entry: `@lushly-dev/specimen-afd-runner`.
 *
 * Registers the `'afd'` command runner and `'afd'` in-page job driver without
 * pulling any Node.js built-ins into Specimen's browser bundle.
 */

import type { SpecimenPlugin } from '@lushly-dev/specimen';
import own from '@lushly-dev/specimen-afd-runner/package.json' with { type: 'json' };
import { type AfdJobDriverOptions, createAfdJobDriver } from './driver.js';
import { AFD_RUNNER_ID, createAfdCommandRunner } from './runner.js';

export { type AfdJobDriverOptions, createAfdJobDriver } from './driver.js';
export {
	AFD_RUNNER_ID,
	type AfdCallableElement,
	createAfdCommandRunner,
	isCommandResult,
} from './runner.js';

/** Default Specimen plugin id for the AFD application-command runner. */
export const AFD_PLUGIN_ID = 'afd-runner' as const;

const PLUGIN_VERSION = own.version;

export interface AfdRunnerPluginOptions extends AfdJobDriverOptions {
	/** Override the plugin id (defaults to `'afd-runner'`). */
	id?: string;
}

/**
 * Create the Specimen plugin providing the `'afd'` command runner and `'afd'`
 * in-page job driver.
 */
export function afdRunner(options: AfdRunnerPluginOptions = {}): SpecimenPlugin {
	const runnerId = options.runner ?? AFD_RUNNER_ID;
	return {
		id: options.id ?? AFD_PLUGIN_ID,
		version: PLUGIN_VERSION,
		runners: {
			[runnerId]: createAfdCommandRunner(),
		},
		jobDrivers: {
			[runnerId]: createAfdJobDriver({
				runner: runnerId,
				...(options.adapter ? { adapter: options.adapter } : {}),
			}),
		},
	};
}

export default afdRunner;
