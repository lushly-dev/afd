import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { LoadedConfig } from './config.js';
import { resolveDefaultsVersion } from './defaults.js';
import {
	type ApprovalStatus,
	type CommandManifest,
	type CommandManifestEntry,
	DEFAULT_PATTERNS_LIBRARY,
	type DesignStateEntry,
	type DesignStateSource,
	type DesignStatesRequest,
	type DesignStatesResult,
	type UnmeasuredEntry,
} from './design-types.js';
import { parseDesignStatesRequest } from './design-validate.js';
import type { SpecimenHostError } from './host.js';
import { parseJobScenarioWithSources } from './job-source.js';
import { DEFAULT_PATTERN_LIBRARY } from './pattern-gates.js';
import { captureSetsDir, specimenDataDir } from './sets.js';

function typedError(
	code: string,
	message: string,
	suggestion: string,
	details?: Record<string, unknown>
): SpecimenHostError {
	const error = new Error(message) as SpecimenHostError;
	error.code = code;
	error.suggestion = suggestion;
	if (details !== undefined) error.details = details;
	return error;
}

function isContained(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ScenarioStepRef {
	step: number;
	command: string;
	description?: string;
}

function unquoteYamlScalar(raw: string): string {
	const trimmed = raw.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed.replace(/\s+#.*$/, '').trim();
}

/**
 * Indentation-aware YAML steps reader for AFD `.scenario.yaml` files.
 * Reads only direct `command:` and `description:` keys of top-level `steps:` sequence items,
 * supporting both indented and indentless sequences while ignoring nested `input:` / `expect:`
 * lists and keys.
 */
function parseYamlScenarioSteps(raw: string): ScenarioStepRef[] {
	const steps: ScenarioStepRef[] = [];
	const lines = raw.split(/\r?\n/);
	let inSteps = false;
	let stepIndent: number | null = null;
	let propIndent: number | null = null;
	let current: { command?: string; description?: string } | null = null;

	const flush = () => {
		if (current?.command) {
			steps.push({
				step: steps.length + 1,
				command: current.command,
				...(current.description ? { description: current.description } : {}),
			});
		}
		current = null;
		propIndent = null;
	};

	const parseStepProperty = (text: string) => {
		if (!current) return;
		const cmdMatch = /^command\s*:\s*(.+)$/.exec(text);
		if (cmdMatch?.[1]) {
			const val = unquoteYamlScalar(cmdMatch[1]);
			if (/^[a-zA-Z0-9._-]+$/.test(val)) current.command = val;
			return;
		}
		const descMatch = /^description\s*:\s*(.+)$/.exec(text);
		if (descMatch?.[1]) {
			const val = unquoteYamlScalar(descMatch[1]);
			if (val.length > 0 && val !== '>' && val !== '>-' && val !== '|' && val !== '|-') {
				current.description = val;
			}
		}
	};

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
		const indent = line.length - line.trimStart().length;

		if (!inSteps) {
			if (indent === 0 && /^steps\s*:\s*(?:#.*)?$/.test(trimmed)) {
				inSteps = true;
				stepIndent = null;
			}
			continue;
		}

		// Leaving top-level `steps:` when another top-level mapping key begins at column 0.
		if (indent === 0 && !trimmed.startsWith('- ') && trimmed !== '-') {
			flush();
			inSteps = false;
			stepIndent = null;
			continue;
		}

		// Establish sequence item indentation from the first `-` item under `steps:`.
		if (stepIndent === null) {
			if (trimmed === '-' || trimmed.startsWith('- ')) {
				stepIndent = indent;
			} else {
				// Non-sequence content under `steps:` ends the block.
				inSteps = false;
				continue;
			}
		}

		// A new direct step item begins ONLY at `stepIndent`.
		if (indent === stepIndent && (trimmed === '-' || trimmed.startsWith('- '))) {
			flush();
			current = {};
			const rest = trimmed.slice(1).trim();
			if (rest.length > 0) {
				// Direct sibling properties align with the first character after `- `.
				propIndent = indent + line.slice(indent).indexOf(rest);
				parseStepProperty(rest);
			}
			continue;
		}

		if (!current || indent <= stepIndent) continue;

		// Only direct properties of the step item (never deeper nested `input:` / `expect:` keys).
		if (propIndent === null) {
			propIndent = indent;
		}
		if (indent === propIndent) {
			parseStepProperty(trimmed);
		}
	}

	flush();
	return steps;
}

/** Parse commands from a JSON or AFD `.scenario.yaml` file without adding external deps. */
async function readScenarioCommands(
	config: LoadedConfig,
	scenarioPath: string
): Promise<ScenarioStepRef[]> {
	const base = dirname(config.file);
	const candidate = resolve(base, scenarioPath);
	const resolvedPath = await realpath(candidate).catch(() => candidate);
	if (!isContained(config.root, resolvedPath)) {
		throw typedError(
			'VALIDATION_ERROR',
			`Scenario path '${scenarioPath}' escapes the configured root.`,
			'Pass a scenario path inside the workspace root.'
		);
	}
	if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
		throw typedError(
			'VALIDATION_ERROR',
			`Scenario file not found: '${scenarioPath}'.`,
			'Check the scenario file path relative to specimen.config.json.'
		);
	}

	// Prefer configured jobSource plugins when present.
	if (config.jobSourceModules.length > 0) {
		try {
			const { loadJobSourceModule } = await import('./job-source.js');
			const sources = [];
			for (const modPath of config.jobSourceModules) {
				sources.push(...(await loadJobSourceModule(modPath)));
			}
			const parsed = await parseJobScenarioWithSources(sources, {
				root: config.root,
				base,
				entry: {
					id: 'design-states-scenario',
					title: scenarioPath,
					module: '.',
					exportName: 'default',
					job: {
						scenario: scenarioPath,
						target: 'app',
						captures: [{ after: 'step', name: 'step' }],
					},
				},
			});
			return parsed.steps.map((s) => ({
				step: s.step,
				command: s.command,
				...(s.description ? { description: s.description } : {}),
			}));
		} catch {
			// Fall back to direct JSON / YAML parsing below.
		}
	}

	let raw: string;
	try {
		raw = await readFile(resolvedPath, 'utf8');
	} catch {
		throw typedError(
			'VALIDATION_ERROR',
			`Scenario file could not be read: '${scenarioPath}'.`,
			'Check that the scenario path is a readable file inside the workspace root.'
		);
	}

	if (resolvedPath.endsWith('.json')) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw typedError(
				'VALIDATION_ERROR',
				`Invalid JSON in scenario file '${scenarioPath}'.`,
				'Fix JSON syntax in the scenario file and retry design-states.'
			);
		}
		if (!isPlainObject(parsed)) {
			throw typedError(
				'VALIDATION_ERROR',
				`Invalid scenario file '${scenarioPath}': expected a JSON object.`,
				'Format the JSON scenario as an object with a steps or commands array.'
			);
		}
		if (Array.isArray(parsed.steps)) {
			return parsed.steps
				.filter(
					(s): s is { step?: number; command: string; description?: string } =>
						isPlainObject(s) && typeof s.command === 'string' && s.command.trim().length > 0
				)
				.map((s, index) => ({
					step: typeof s.step === 'number' ? s.step : index + 1,
					command: s.command.trim(),
					...(typeof s.description === 'string' && s.description.length > 0
						? { description: s.description }
						: {}),
				}));
		}
		if (Array.isArray(parsed.commands)) {
			return parsed.commands
				.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
				.map((command, index) => ({ step: index + 1, command: command.trim() }));
		}
		return [];
	}

	return parseYamlScenarioSteps(raw);
}

async function readCommandManifest(config: LoadedConfig): Promise<CommandManifest | undefined> {
	const manifestRel = config.config.commandManifest;
	if (!manifestRel) return undefined;
	const base = dirname(config.file);
	const candidate = resolve(base, manifestRel);
	const resolvedPath = await realpath(candidate).catch(() => candidate);
	if (!isContained(config.root, resolvedPath)) {
		throw typedError(
			'VALIDATION_ERROR',
			`Configured commandManifest '${manifestRel}' escapes the workspace root.`,
			'Set commandManifest in specimen.config.json to a path inside the workspace root.'
		);
	}
	if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
		throw typedError(
			'VALIDATION_ERROR',
			`Configured commandManifest not found: '${manifestRel}'.`,
			'Verify commandManifest in specimen.config.json points to a readable JSON file.'
		);
	}
	let raw: string;
	try {
		raw = await readFile(resolvedPath, 'utf8');
	} catch {
		throw typedError(
			'VALIDATION_ERROR',
			`Configured commandManifest could not be read: '${manifestRel}'.`,
			'Verify commandManifest in specimen.config.json points to a readable JSON file.'
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw typedError(
			'VALIDATION_ERROR',
			`Invalid JSON in commandManifest '${manifestRel}'.`,
			'Fix JSON syntax in the configured commandManifest file.'
		);
	}
	if (!isPlainObject(parsed) || !Array.isArray(parsed.commands)) {
		throw typedError(
			'VALIDATION_ERROR',
			`Invalid commandManifest '${manifestRel}': expected an object with a commands array.`,
			'Format the command manifest as { "commands": [...] }.'
		);
	}
	for (let i = 0; i < parsed.commands.length; i++) {
		const item = parsed.commands[i];
		const validString = typeof item === 'string' && item.trim().length > 0;
		const validObject =
			isPlainObject(item) && typeof item.name === 'string' && item.name.trim().length > 0;
		if (!validString && !validObject) {
			throw typedError(
				'VALIDATION_ERROR',
				`Invalid commandManifest '${manifestRel}': commands[${i}] must be a non-empty command name or object with a non-empty name.`,
				'Ensure every entry in commandManifest.commands is a non-empty string or an object with a string name.'
			);
		}
	}
	return parsed as unknown as CommandManifest;
}

function normalizeManifestEntry(entry: string | CommandManifestEntry): CommandManifestEntry {
	return typeof entry === 'string' ? { name: entry.trim() } : { ...entry, name: entry.name.trim() };
}

function hasExplicitMetadata(entry: CommandManifestEntry): boolean {
	return (
		entry.states !== undefined ||
		entry.undoable !== undefined ||
		entry.destructive !== undefined ||
		entry.confirmPrompt !== undefined ||
		entry.approval !== undefined ||
		entry.executionTime !== undefined ||
		entry.batch !== undefined ||
		entry.returnsCollection !== undefined ||
		entry.returnsPlan !== undefined ||
		entry.returnsAlternatives !== undefined ||
		entry.returnsConfidence !== undefined ||
		entry.returnsSources !== undefined ||
		entry.returnsReasoning !== undefined ||
		entry.returnsWarnings !== undefined ||
		entry.errors !== undefined
	);
}

interface RawStateSpec {
	id: string;
	trigger: string;
	patternId: string;
	setup: string;
}

function defaultSetupForPattern(
	patternId: string,
	command: string,
	scenarioSetup?: string
): string {
	if (scenarioSetup) return scenarioSetup;
	switch (patternId) {
		case 'error-recovery':
			return `spec/wire/result-failure.json (${command} failure)`;
		case 'undo-offer':
			return `spec/wire/result-success-full.json (${command} undoCommand)`;
		case 'destructive-confirm':
			return `command:${command} (destructive confirmPrompt before call)`;
		case 'approval-request':
			return `command:${command} (APPROVAL_REQUIRED / approval gate)`;
		case 'progress-and-plan':
			return `spec/wire/result-success-full.json (${command} pending / plan)`;
		case 'batch-partial-failure':
			return `spec/wire/batch-result.json (${command} partial batch failure)`;
		case 'collection-states':
			return `command:${command} (empty, populated, and failed collection states)`;
		case 'alternatives-and-confidence':
			return `spec/wire/result-success-full.json (${command} alternatives and confidence)`;
		case 'evidence-and-sources':
			return `spec/wire/result-success-full.json (${command} reasoning and sources)`;
		case 'warnings-banner':
			return `spec/wire/result-success-full.json (${command} warnings)`;
		default:
			return `command:${command} (${patternId})`;
	}
}

function deriveStatesForEntry(entry: CommandManifestEntry, scenarioSetup?: string): RawStateSpec[] {
	// 1. Explicit state declarations in the command manifest take precedence verbatim.
	if (entry.states && entry.states.length > 0) {
		return entry.states.map((decl) => {
			const barePattern = decl.pattern.includes('/')
				? (decl.pattern.split('/').at(1) ?? decl.pattern)
				: decl.pattern;
			return {
				id: decl.id ?? barePattern,
				trigger: decl.trigger,
				patternId: decl.pattern,
				setup: decl.setup ?? defaultSetupForPattern(barePattern, entry.name, scenarioSetup),
			};
		});
	}

	// 2. Derive from explicit AFD contract metadata flags when present.
	if (hasExplicitMetadata(entry)) {
		const derived: RawStateSpec[] = [];
		const push = (patternId: string, trigger: string) => {
			if (derived.some((item) => item.patternId === patternId)) return;
			derived.push({
				id: patternId,
				trigger,
				patternId,
				setup: defaultSetupForPattern(patternId, entry.name, scenarioSetup),
			});
		};
		if (entry.errors && entry.errors.length > 0) {
			const first = entry.errors[0];
			const code = typeof first === 'string' ? first : first?.code;
			push('error-recovery', code ? `error.code === '${code}'` : 'result.success === false');
		}
		if (entry.undoable) {
			push('undo-offer', 'command.undoable / result.undoCommand');
		}
		if (entry.returnsCollection) {
			push('collection-states', 'result.data (collection empty / populated / failed)');
		}
		if (entry.batch) {
			push('batch-partial-failure', 'batch.summary.failureCount > 0');
		}
		if (
			entry.returnsPlan ||
			entry.executionTime === 'long-running' ||
			entry.executionTime === 'slow'
		) {
			push(
				'progress-and-plan',
				entry.returnsPlan ? 'result.plan' : `command.executionTime === '${entry.executionTime}'`
			);
		}
		if (entry.destructive || entry.confirmPrompt) {
			push(
				'destructive-confirm',
				entry.confirmPrompt ? 'command.destructive / command.confirmPrompt' : 'command.destructive'
			);
		}
		if (entry.approval) {
			push('approval-request', 'command.approval / APPROVAL_REQUIRED');
		}
		if (entry.returnsAlternatives || entry.returnsConfidence) {
			push('alternatives-and-confidence', 'result.alternatives / result.confidence');
		}
		if (entry.returnsSources || entry.returnsReasoning) {
			push('evidence-and-sources', 'result.reasoning / result.sources');
		}
		if (entry.returnsWarnings) {
			push('warnings-banner', 'result.warnings');
		}
		if (derived.length === 0) {
			push('error-recovery', 'result.success === false');
		}
		return derived;
	}

	// 3. Deterministic inference from AFD domain-action naming conventions for string-only manifests.
	const action = entry.name.split('-').at(-1) ?? entry.name;
	const inferred: RawStateSpec[] = [];
	const add = (patternId: string, trigger: string) => {
		inferred.push({
			id: patternId,
			trigger,
			patternId,
			setup: defaultSetupForPattern(patternId, entry.name, scenarioSetup),
		});
	};
	if (action === 'create' || action === 'add' || action === 'update' || action === 'set') {
		add('error-recovery', 'result.success === false');
		add('undo-offer', 'command.undoable / result.undoCommand');
	} else if (action === 'list' || action === 'search' || action === 'find' || action === 'query') {
		add('collection-states', 'result.data (empty / populated / failed)');
	} else if (action === 'import' || action === 'batch' || action === 'bulk') {
		add('batch-partial-failure', 'batch.summary.failureCount > 0');
		add('progress-and-plan', 'result.plan / long-running');
	} else if (
		action === 'delete' ||
		action === 'remove' ||
		action === 'clear' ||
		action === 'retire' ||
		action === 'purge'
	) {
		add('destructive-confirm', 'command.destructive / command.confirmPrompt');
	} else if (action === 'approve' || action === 'request') {
		add('approval-request', 'command.approval / APPROVAL_REQUIRED');
		add('error-recovery', 'result.success === false');
	} else if (action === 'suggest' || action === 'match' || action === 'recommend') {
		add('alternatives-and-confidence', 'result.alternatives / result.confidence');
		add('evidence-and-sources', 'result.reasoning / result.sources');
	} else {
		add('error-recovery', 'result.success === false');
	}
	return inferred;
}

interface ResolvedPatternInfo {
	qualified: string;
	source: DesignStateSource;
	approvalStatus: ApprovalStatus;
}

function resolveStatePattern(
	config: LoadedConfig,
	rawPatternId: string,
	includeProposed: boolean,
	manifestLocalLibrary?: string
): ResolvedPatternInfo {
	const localLibrary =
		config.config.pack?.library ?? manifestLocalLibrary ?? DEFAULT_PATTERN_LIBRARY;
	const defaultQualified = rawPatternId.includes('/')
		? rawPatternId
		: `${DEFAULT_PATTERNS_LIBRARY}/${rawPatternId}`;
	const [ownerLibrary, patternName] = defaultQualified.split('/') as [string, string];

	// Check local patterns for product-owned or copied patterns when qualified as local or matching a binding.
	const localByName = new Map(
		(config.patterns?.patterns ?? []).map((item) => [item.pattern, item])
	);

	// Support future `patternBindings` on config (Phase B2) while keeping Phase B1 clean.
	const bindings = (config.config as { patternBindings?: Record<string, string> }).patternBindings;
	const boundTarget = bindings?.[defaultQualified];
	if (boundTarget) {
		const [targetLib, targetPat] = boundTarget.includes('/')
			? (boundTarget.split('/') as [string, string])
			: [localLibrary, boundTarget];
		const localCopy = targetLib === localLibrary ? localByName.get(targetPat) : undefined;
		const copyApproval: ApprovalStatus =
			(localCopy as { approvalStatus?: ApprovalStatus } | undefined)?.approvalStatus ?? 'approved';
		const isCopied = Boolean((localCopy as { derivedFrom?: unknown } | undefined)?.derivedFrom);
		// Proposed copies remain pending until approved unless caller explicitly requests includeProposed.
		if (copyApproval === 'approved' || includeProposed) {
			return {
				qualified: `${targetLib}/${targetPat}`,
				source: isCopied ? 'copied' : 'replaced',
				approvalStatus: copyApproval,
			};
		}
	}

	if (ownerLibrary === localLibrary) {
		const local = localByName.get(patternName);
		const localApproval: ApprovalStatus =
			(local as { approvalStatus?: ApprovalStatus } | undefined)?.approvalStatus ?? 'approved';
		const isCopied = Boolean((local as { derivedFrom?: unknown } | undefined)?.derivedFrom);
		return {
			qualified: defaultQualified,
			source: isCopied ? 'copied' : 'product',
			approvalStatus: localApproval,
		};
	}

	return {
		qualified: defaultQualified,
		source: ownerLibrary === DEFAULT_PATTERNS_LIBRARY ? 'default' : 'product',
		approvalStatus: 'approved',
	};
}

function hasRecordedCaptureSet(root: string): boolean {
	const dir = captureSetsDir(root);
	if (!existsSync(dir)) return false;
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const manifestFile = join(dir, entry.name, 'manifest.json');
			if (existsSync(manifestFile) && statSync(manifestFile).isFile()) return true;
		}
	} catch {
		return false;
	}
	return false;
}

function hasRecordedWalk(root: string): boolean {
	const dir = join(specimenDataDir(root), 'walks');
	if (!existsSync(dir)) return false;
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isFile() && entry.name.endsWith('.json')) return true;
		}
	} catch {
		return false;
	}
	return false;
}

function buildUnmeasuredEntries(config: LoadedConfig, usedScenario: boolean): UnmeasuredEntry[] {
	const unmeasured: UnmeasuredEntry[] = [];
	const hasGateCases = (config.gateCases?.length ?? 0) > 0;
	const hasSpecimens = config.entries.length > 0;
	const hasCaptureSets = hasRecordedCaptureSet(config.root);

	if (!hasSpecimens || !hasGateCases || !hasCaptureSets) {
		unmeasured.push({
			area: 'screen-gates',
			reason: !hasSpecimens
				? 'No specimen setup cases or captures exist yet to run portable pattern gates.'
				: !hasGateCases
					? 'No specimen setup cases are bound to pattern gates yet.'
					: 'No specimen capture set has been recorded yet.',
			addToMeasure:
				'Bind specimen setups to these patterns and run specimen-capture and specimen-run.',
		});
	}

	const hasJobs = usedScenario || config.entries.some((entry) => entry.job !== undefined);
	if (!hasJobs) {
		unmeasured.push({
			area: 'job-scenarios',
			reason: 'No job scenarios are configured to verify end-to-end screen flows.',
			addToMeasure: 'Add a job scenario with specimen-job-create and run specimen-job-run.',
		});
	}

	if (!hasRecordedWalk(config.root)) {
		unmeasured.push({
			area: 'panel-walks',
			reason: 'No persona walks have run against rendered screens yet.',
			addToMeasure: 'Run panel-walk for each target modality once the screen is running.',
		});
	}

	return unmeasured;
}

/**
 * Name every screen state a set of commands or a job scenario can produce, mapped to the
 * approved pattern covering each state, with self-guiding `nextSteps` and `unmeasured` areas.
 */
export async function runDesignStates(
	config: LoadedConfig,
	rawRequest: DesignStatesRequest = {}
): Promise<DesignStatesResult> {
	const request = parseDesignStatesRequest(rawRequest);
	const hasCommands = request.commands !== undefined && request.commands.length > 0;
	const hasScenario = request.scenario !== undefined;

	if (!hasCommands && !hasScenario) {
		throw typedError(
			'NO_COMMANDS',
			'No commands or scenario were provided to design-states.',
			'Pass at least one command name in commands or a scenario path in scenario.'
		);
	}

	const manifest = await readCommandManifest(config);
	const defaultsVersion = resolveDefaultsVersion(
		config.config.defaults ?? manifest?.defaultsVersion
	);
	const includeProposed = request.includeProposed ?? false;

	const manifestByName = new Map<string, CommandManifestEntry>();
	if (manifest) {
		for (const rawEntry of manifest.commands) {
			const entry = normalizeManifestEntry(rawEntry);
			manifestByName.set(entry.name, entry);
		}
	}

	// Collect ordered target commands (with optional scenario step setup text).
	const targets: Array<{ command: string; scenarioSetup?: string }> = [];
	const seenCommands = new Set<string>();
	if (hasCommands && request.commands) {
		for (const command of request.commands) {
			if (seenCommands.has(command)) continue;
			seenCommands.add(command);
			targets.push({ command });
		}
	}
	if (hasScenario && request.scenario) {
		const steps = await readScenarioCommands(config, request.scenario);
		if (steps.length === 0 && targets.length === 0) {
			throw typedError(
				'NO_COMMANDS',
				`Scenario '${request.scenario}' declared no commands.`,
				'Pass at least one command name in commands or a scenario file with steps.'
			);
		}
		for (const step of steps) {
			if (seenCommands.has(step.command)) continue;
			seenCommands.add(step.command);
			const stepLabel = step.description
				? `${request.scenario}#step-${step.step}: ${step.description}`
				: `${request.scenario}#step-${step.step}`;
			targets.push({ command: step.command, scenarioSetup: stepLabel });
		}
	}

	// Validate target commands against the configured command manifest when present.
	if (manifest) {
		for (const target of targets) {
			if (!manifestByName.has(target.command)) {
				const available = [...manifestByName.keys()].slice(0, 8).join(', ');
				throw typedError(
					'TARGET_COMMAND_NOT_FOUND',
					`Command '${target.command}' is not declared in the product's command manifest.`,
					`Check the product's command manifest${available ? ` (known commands: ${available})` : ''} or pass a command declared by the application.`,
					{ command: target.command }
				);
			}
		}
	}

	const allStates: Array<{ cursor: string; entry: DesignStateEntry }> = [];

	for (const target of targets) {
		const manifestEntry = manifestByName.get(target.command) ?? { name: target.command };
		const rawStates = deriveStatesForEntry(manifestEntry, target.scenarioSetup);
		for (const rawState of rawStates) {
			const resolved = resolveStatePattern(
				config,
				rawState.patternId,
				includeProposed,
				manifest?.localLibrary
			);
			if (!includeProposed && resolved.approvalStatus !== 'approved') continue;
			// Strictly unique, collision-free cursor independent of state id punctuation.
			const cursor = `s:${allStates.length + 1}`;
			allStates.push({
				cursor,
				entry: {
					id: rawState.id,
					command: target.command,
					trigger: rawState.trigger,
					pattern: resolved.qualified,
					source: resolved.source,
					approvalStatus: resolved.approvalStatus,
					setup: rawState.setup,
				},
			});
		}
	}

	let sliced = allStates;
	if (request.after !== undefined) {
		const idx = sliced.findIndex((item) => item.cursor === request.after);
		if (idx < 0) {
			throw typedError(
				'VALIDATION_ERROR',
				`Unknown design-states pagination cursor: '${request.after}'.`,
				'Pass the exact next cursor returned by a previous design-states call.'
			);
		}
		sliced = sliced.slice(idx + 1);
	}

	let next: string | undefined;
	if (request.limit !== undefined && sliced.length > request.limit) {
		const page = sliced.slice(0, request.limit);
		next = page.at(-1)?.cursor;
		sliced = page;
	}

	const states = sliced.map((item) => item.entry);
	const uniquePatterns = [...new Set(states.map((s) => s.pattern))];
	const consumer = request.consumer ?? manifest?.consumer;
	const consumerNote = consumer ? ` with consumer '${consumer}'` : '';
	const nextSteps: string[] = [
		uniquePatterns.length > 0
			? `Call umbel: components-brief${consumerNote} with patterns [${uniquePatterns.join(', ')}] to load the approved pattern guidance before building the screen.`
			: 'Call umbel: components-brief to load component and pattern guidance before building the screen.',
		'Bind screen specimens to each pattern setup and run specimen-validate and specimen-run to verify portable gates.',
	];
	if (next !== undefined) {
		nextSteps.push(`Pass after: '${next}' to design-states to read the next page of states.`);
	}

	return {
		defaultsVersion,
		states,
		...(next === undefined ? {} : { next }),
		nextSteps,
		unmeasured: buildUnmeasuredEntries(config, hasScenario),
	};
}
