import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { JobScenario, JobSource, JobSourceContext, SpecimenEntry } from './types.js';
import { parseJobScenario } from './validate.js';

export type { JobSource, JobSourceContext } from './types.js';

const KNOWN_JOB_ERROR_CODES = new Set([
	'RUNNER_MISSING',
	'NOT_A_JOB',
	'JOB_SCENARIO_INVALID',
	'CAPTURE_STEP_UNKNOWN',
	'CAPTURE_STEP_AMBIGUOUS',
	'STEP_HAS_NO_DESCRIPTION',
]);

function scenarioError(code: string, message: string, suggestion: string): Error {
	const error = new Error(message) as Error & { code?: string; suggestion?: string };
	error.code = code;
	error.suggestion = suggestion;
	return error;
}

/** Declare a Node-side job scenario source with its type checked. */
export function defineJobSource(source: JobSource): JobSource {
	return source;
}

const isJobSource = (value: unknown): value is JobSource =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as JobSource).id === 'string' &&
	Boolean((value as JobSource).id) &&
	typeof (value as JobSource).parseScenario === 'function';

function within(root: string, target: string): boolean {
	const fromRoot = relative(root, target);
	return !(fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot));
}

/** Load one configured job source module (default-exporting a `JobSource` or an array of them). */
export async function loadJobSourceModule(modulePath: string): Promise<JobSource[]> {
	const version = createHash('sha256')
		.update(await readFile(modulePath))
		.digest('hex');
	const loaded = (await import(`${pathToFileURL(modulePath).href}?${version}`)) as {
		default?: unknown;
	};
	const sources = Array.isArray(loaded.default) ? loaded.default : [loaded.default];
	if (!sources.length || !sources.every(isJobSource)) {
		throw new Error(
			'Job source default export must be a JobSource (with id and parseScenario) or an array of them.'
		);
	}
	return sources;
}

/** Resolve and parse a job entry's scenario using the first matching `JobSource`. */
export async function parseJobScenarioWithSources(
	sources: readonly JobSource[],
	options: {
		root: string;
		base: string;
		entry: SpecimenEntry;
	}
): Promise<JobScenario> {
	if (!options.entry.job) {
		throw scenarioError(
			'NOT_A_JOB',
			`Specimen '${options.entry.id}' is not a job specimen.`,
			'Use specimen-list with kind: job to find job specimens, or specimen-render for a component specimen.'
		);
	}
	const scenarioPath = options.entry.job.scenario;
	const source = sources.find((candidate) =>
		candidate.supports ? candidate.supports(scenarioPath, options.entry) : true
	);
	if (!source) {
		throw scenarioError(
			'RUNNER_MISSING',
			`No job scenario parser is registered for '${scenarioPath}' (entry '${options.entry.id}').`,
			'Configure a jobSources plugin (such as @lushly-dev/specimen-afd-runner) or pass a parsed scenario to runJob().'
		);
	}
	const realRoot = await realpath(options.root);
	const lexicalRoot = resolve(options.root);
	const context: JobSourceContext = {
		root: realRoot,
		base: options.base,
		entry: options.entry,
		scenarioPath,
		async read(path: string) {
			const candidate = resolve(options.base, path);
			if (!within(lexicalRoot, candidate)) {
				throw scenarioError(
					'JOB_SCENARIO_INVALID',
					`Scenario file '${path}' escapes the configured root.`,
					'Keep job scenario files inside the configured Specimen project root.'
				);
			}
			let target: string;
			try {
				target = await realpath(candidate);
			} catch (error) {
				throw scenarioError(
					'JOB_SCENARIO_INVALID',
					`Cannot read scenario file '${path}': ${error instanceof Error ? error.message : String(error)}`,
					`Verify that '${path}' exists inside the project root and is readable.`
				);
			}
			if (!within(realRoot, target)) {
				throw scenarioError(
					'JOB_SCENARIO_INVALID',
					`Scenario file '${path}' escapes the configured root.`,
					'Keep job scenario files inside the configured Specimen project root.'
				);
			}
			return readFile(target, 'utf8');
		},
	};
	try {
		const raw = await source.parseScenario(context);
		return parseJobScenario(raw, `job scenario '${scenarioPath}'`);
	} catch (error) {
		const structured = error as Error & { code?: string; suggestion?: string };
		if (
			typeof structured.code === 'string' &&
			KNOWN_JOB_ERROR_CODES.has(structured.code) &&
			typeof structured.suggestion === 'string' &&
			structured.suggestion
		) {
			throw error;
		}
		const code =
			typeof structured.code === 'string' && KNOWN_JOB_ERROR_CODES.has(structured.code)
				? structured.code
				: 'JOB_SCENARIO_INVALID';
		const suggestion =
			typeof structured.suggestion === 'string' && structured.suggestion
				? structured.suggestion
				: `Check '${scenarioPath}' and fix any syntax, step numbering, or schema errors.`;
		throw scenarioError(code, error instanceof Error ? error.message : String(error), suggestion);
	}
}
