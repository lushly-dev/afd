/**
 * Browser-side job and multi-checkpoint execution helpers for the Specimen runtime.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { LoadedConfig } from './config.js';
import { resolveContext } from './config.js';
import type { HostProcess, SpecimenHostError } from './host.js';
import { parseJobScenarioWithSources } from './job-source.js';
import {
	buildJobCaptureItems,
	type CheckpointCaptureInput,
	finalizeCheckpointsRun,
	finalizeJobRun,
	resolveJobCapturePlan,
	resolvePinnedBaseline,
} from './jobs.js';
import type { JobDriverResult } from './plugin.js';
import { dependencyIdentity, sourceState } from './provenance.js';
import { assertRealContained, specimenDataDir, type WriteCaptureSetItem } from './sets.js';
import type {
	AxeOutcome,
	BrowserObservation,
	CaptureCheckpoint,
	CheckpointsRequest,
	CheckpointsRun,
	JobRun,
	JobRunRequest,
	JobScenario,
	JobSource,
	Observation,
	ResolvedJobCapture,
	SpecimenContext,
	SpecimenEntry,
} from './types.js';
import { parseCheckpointsRequest, parseJobRunRequest } from './validate.js';

export interface HostCheckpointCapture {
	key: string | null;
	name: string;
	step: number | null;
	captured: BrowserObservation & { normalized: string };
	snapshot: string;
	screenshot: string | null;
	accessibility?: AxeOutcome | null;
	console?: { errors: string[]; warnings: string[] };
}

export interface HostJobRender {
	captured: BrowserObservation & { normalized: string };
	snapshot: string;
	screenshot: string | null;
	console: { errors: string[]; warnings: string[] };
	loaded: string[];
	browser: string;
	captures?: HostCheckpointCapture[];
	jobOutcome?: JobDriverResult | null;
}

export interface BuildObservationArgs {
	entry: SpecimenEntry;
	context: SpecimenContext;
	checkpointName: string;
	actionMode: CaptureCheckpoint['actionMode'];
	timeoutMs: number;
	clockBaseline: CaptureCheckpoint['baseline']['clock'];
	captured: BrowserObservation & { normalized: string };
	snapshot: string;
	screenshot: string | null;
	axe: AxeOutcome | undefined;
	console: { errors: string[]; warnings: string[] };
	loaded: string[];
	browser: string;
	source: { revision: string | null; dirty: boolean | null };
	dependencies: string;
}

export interface BenchJobHostDeps {
	config: LoadedConfig;
	hostGraceMs: number;
	ensureOpen: () => void;
	ensureHost: () => Promise<HostProcess>;
	getJobSources: () => Promise<JobSource[]>;
	buildObservation: (args: BuildObservationArgs) => Observation;
}

export async function executeJobInBrowser(
	deps: BenchJobHostDeps,
	args: {
		entry: SpecimenEntry;
		scenario: JobScenario;
		capturePlan: ResolvedJobCapture[];
		context: SpecimenContext;
		axe: boolean;
		timeoutMs: number;
		clockBaseline: CaptureCheckpoint['baseline']['clock'];
		pinClock: string | undefined;
		stagingDir: string;
	}
) {
	if (deps.config.plugins.length === 0) {
		const error: SpecimenHostError = new Error(
			`Job specimen '${args.entry.id}' requires a registered job driver plugin (such as '${args.entry.job?.runner ?? 'afd'}'), but no plugins are configured.`
		);
		error.code = 'RUNNER_MISSING';
		error.suggestion =
			'Configure a Specimen plugin providing the job driver and command runner (such as @lushly-dev/specimen-afd-runner) in specimen.config.json plugins.';
		throw error;
	}
	const screenshots: Record<string, string> = {};
	for (const cap of args.capturePlan) {
		screenshots[cap.key] = join(args.stagingDir, `step-${cap.step}.png`);
	}
	const runtime = await deps.ensureHost();
	let rendered: HostJobRender;
	let source: { revision: string | null; dirty: boolean | null };
	let dependencies: string;
	try {
		[rendered, [source, dependencies]] = await Promise.all([
			runtime.request(
				'render',
				{
					entry: args.entry,
					context: args.context,
					checkpoint: 'mount',
					timeoutMs: args.timeoutMs,
					screenshot: null,
					accessibility: args.axe,
					...(args.pinClock !== undefined ? { pinClock: args.pinClock } : {}),
					jobRun: {
						driver: args.entry.job?.runner ?? 'afd',
						target: args.entry.job?.target ?? 'app',
						scenario: args.scenario,
						capturePlan: args.capturePlan,
						screenshots,
					},
				},
				args.timeoutMs + deps.hostGraceMs
			) as Promise<HostJobRender>,
			Promise.all([sourceState(deps.config.root), dependencyIdentity(deps.config.root)]),
		]);
	} catch (error) {
		const structured = error as SpecimenHostError;
		const msg = error instanceof Error ? error.message : String(error);
		if (!structured.code && /No (?:job driver|command runner) '[^']+' is registered/i.test(msg)) {
			structured.code = 'RUNNER_MISSING';
			structured.suggestion =
				'Register a Specimen plugin that provides the requested job driver and command runner (such as @lushly-dev/specimen-afd-runner) in specimen.config.json plugins.';
		}
		throw error;
	}
	const driverResult = rendered.jobOutcome;
	if (!driverResult) {
		throw new Error(`Job driver returned no outcome for '${args.entry.id}'.`);
	}
	const capturedByKey = new Map<
		string,
		{ observation: Observation; screenshotSource: string | null }
	>();
	for (const point of rendered.captures ?? []) {
		const key = point.key ?? (point.step !== null ? `${args.entry.id}/${point.step}` : point.name);
		const obs = deps.buildObservation({
			entry: args.entry,
			context: args.context,
			checkpointName: point.name,
			actionMode: 'real-input',
			timeoutMs: args.timeoutMs,
			clockBaseline: args.clockBaseline,
			captured: point.captured,
			snapshot: point.snapshot,
			screenshot: point.screenshot,
			axe: args.axe ? (point.accessibility ?? undefined) : undefined,
			console: point.console ?? rendered.console,
			loaded: rendered.loaded,
			browser: rendered.browser,
			source,
			dependencies,
		});
		capturedByKey.set(key, { observation: obs, screenshotSource: point.screenshot });
	}
	return { driverResult, capturedByKey, source, dependencies };
}

export async function runJobForCaptureSet(
	deps: BenchJobHostDeps,
	args: {
		entry: SpecimenEntry;
		context: SpecimenContext;
		axe: boolean;
		stagingDir: string;
		timeoutMs?: number;
	}
): Promise<WriteCaptureSetItem[]> {
	const scenario = await parseJobScenarioWithSources(await deps.getJobSources(), {
		root: deps.config.root,
		base: dirname(deps.config.file),
		entry: args.entry,
	});
	const capturePlan = resolveJobCapturePlan(args.entry, scenario);
	const pinned = resolvePinnedBaseline(args.entry.job?.pin);
	const clockBaseline: CaptureCheckpoint['baseline']['clock'] =
		pinned.clock === 'real' ? 'real' : { pinned: pinned.clock };
	const { driverResult, capturedByKey } = await executeJobInBrowser(deps, {
		entry: args.entry,
		scenario,
		capturePlan,
		context: args.context,
		axe: args.axe,
		timeoutMs: args.timeoutMs ?? 30_000,
		clockBaseline,
		pinClock: pinned.clock !== 'real' ? pinned.clock : undefined,
		stagingDir: args.stagingDir,
	});
	const built = await buildJobCaptureItems({
		entry: args.entry,
		scenario,
		capturePlan,
		driverResult,
		capturedByKey,
	});
	return built.items;
}

export async function captureCheckpointsInRuntime(
	deps: BenchJobHostDeps,
	rawRequest: CheckpointsRequest
): Promise<CheckpointsRun> {
	deps.ensureOpen();
	const request = parseCheckpointsRequest(rawRequest);
	const entry = deps.config.entries.find((item) => item.id === request.id);
	if (!entry) throw new Error(`Specimen not found: ${request.id}`);
	if (entry.story) {
		throw new Error(
			`Multi-checkpoint capture applies to native specimens; '${entry.id}' is a retained story.`
		);
	}
	const context = resolveContext(request.context);
	const axe = request.axe ?? true;
	const timeoutMs = request.timeoutMs ?? 30_000;
	const pinned = resolvePinnedBaseline(request.pin);
	const clockBaseline: CaptureCheckpoint['baseline']['clock'] =
		pinned.clock === 'real' ? 'real' : { pinned: pinned.clock };
	const stagingDir = join(specimenDataDir(deps.config.root), 'tmp', randomUUID());
	await assertRealContained(
		deps.config.root,
		stagingDir,
		`Staging directory escapes root: ${stagingDir}`
	);
	await mkdir(stagingDir, { recursive: true });
	try {
		const runtime = await deps.ensureHost();
		const checkpointsPayload = (request.checkpoints ?? []).map((name) => ({ name }));
		const [rendered, [source, dependencies]] = await Promise.all([
			runtime.request(
				'render',
				{
					entry,
					context,
					checkpoint: 'mount',
					timeoutMs,
					screenshot: null,
					accessibility: axe,
					...(pinned.clock !== 'real' ? { pinClock: pinned.clock } : {}),
					checkpoints: checkpointsPayload,
					screenshotsDir: stagingDir,
				},
				timeoutMs + deps.hostGraceMs
			) as Promise<HostJobRender>,
			Promise.all([sourceState(deps.config.root), dependencyIdentity(deps.config.root)]),
		]);
		const rawCaptures = rendered.captures ?? [];
		const captures: CheckpointCaptureInput[] = rawCaptures.map((point, index) => {
			const step = point.step ?? index + 1;
			const key = point.key ?? `${entry.id}/${step}`;
			const obs = deps.buildObservation({
				entry,
				context,
				checkpointName: point.name,
				actionMode: point.name === 'mount' ? 'none' : 'real-input',
				timeoutMs,
				clockBaseline,
				captured: point.captured,
				snapshot: point.snapshot,
				screenshot: point.screenshot,
				axe: axe ? (point.accessibility ?? undefined) : undefined,
				console: point.console ?? rendered.console,
				loaded: rendered.loaded,
				browser: rendered.browser,
				source,
				dependencies,
			});
			return {
				key,
				name: point.name,
				step,
				observation: obs,
				screenshotSource: point.screenshot,
			};
		});
		return await finalizeCheckpointsRun({
			root: deps.config.root,
			id: entry.id,
			context,
			axe,
			...(request.pin ? { pin: request.pin } : {}),
			...(request.label !== undefined ? { label: request.label } : {}),
			revision: source.revision,
			dirty: source.dirty,
			captures,
		});
	} finally {
		await rm(stagingDir, { recursive: true, force: true });
	}
}

export async function runJobInRuntime(
	deps: BenchJobHostDeps,
	rawRequest: JobRunRequest
): Promise<JobRun> {
	deps.ensureOpen();
	const request = parseJobRunRequest(rawRequest);
	const entry = deps.config.entries.find((item) => item.id === request.id);
	if (!entry) throw new Error(`Specimen not found: ${request.id}`);
	if (!entry.job) {
		const error: SpecimenHostError = new Error(`Specimen '${entry.id}' is not a job specimen.`);
		error.code = 'NOT_A_JOB';
		error.suggestion =
			'Use specimen-list with kind: job to find job specimens, or specimen-render for a component specimen.';
		throw error;
	}
	const scenario =
		request.scenario ??
		(await parseJobScenarioWithSources(await deps.getJobSources(), {
			root: deps.config.root,
			base: dirname(deps.config.file),
			entry,
		}));
	const capturePlan = resolveJobCapturePlan(entry, scenario);
	const context = resolveContext(request.context);
	const axe = request.axe ?? true;
	const timeoutMs = request.timeoutMs ?? 30_000;
	const effectivePin = request.pin ?? entry.job.pin;
	const pinned = resolvePinnedBaseline(effectivePin);
	const clockBaseline: CaptureCheckpoint['baseline']['clock'] =
		pinned.clock === 'real' ? 'real' : { pinned: pinned.clock };
	const stagingDir = join(specimenDataDir(deps.config.root), 'tmp', randomUUID());
	await assertRealContained(
		deps.config.root,
		stagingDir,
		`Staging directory escapes root: ${stagingDir}`
	);
	await mkdir(stagingDir, { recursive: true });
	try {
		const { driverResult, capturedByKey, source } = await executeJobInBrowser(deps, {
			entry,
			scenario,
			capturePlan,
			context,
			axe,
			timeoutMs,
			clockBaseline,
			pinClock: pinned.clock !== 'real' ? pinned.clock : undefined,
			stagingDir,
		});
		return await finalizeJobRun({
			root: deps.config.root,
			entry,
			scenario,
			capturePlan,
			driverResult,
			capturedByKey,
			context,
			axe,
			...(effectivePin ? { pin: effectivePin } : {}),
			...(request.label !== undefined ? { label: request.label } : {}),
			revision: source.revision,
			dirty: source.dirty,
		});
	} finally {
		await rm(stagingDir, { recursive: true, force: true });
	}
}
