import { resolve } from 'node:path';
import { climbSelection, observationClimbTree } from './climb.js';
import type { LoadedConfig } from './config.js';
import {
	buildPoint,
	computeSourceDigests,
	diffRecordedDigests,
	evaluatePointStaleness,
	formatPointContext,
	generatePointId,
	nearestComponentTag,
	normalizePointContextInput,
	POINT_SOURCE_DIGEST_LENGTH,
	pointError,
	readPointFile,
	resolvePointMove,
	specimenNotFoundError,
	writePointFile,
} from './point.js';
import { DEFAULT_PIN, parsePointer } from './pointer.js';
import type {
	Observation,
	PointCheckRequest,
	PointCheckResult,
	PointMoveRequest,
	PointRequest,
	PointResult,
	SpecimenContext,
	SpecimenEntry,
	Target,
} from './types.js';
import { parsePointCheckRequest, parsePointMoveRequest, parsePointRequest } from './validate.js';

/** Options passed to `capture()` when rendering for pointing commands. */
export interface PointCaptureOptions {
	resolveTarget?: Target;
	collectTexts?: boolean;
}

/** Build optional host-render payload fields for pointing options. */
export function pointRequestFields(options: PointCaptureOptions): Record<string, unknown> {
	return {
		...(options.resolveTarget ? { resolveTarget: options.resolveTarget } : {}),
		...(options.collectTexts ? { collectTexts: true } : {}),
	};
}

/** Raw pointing fields returned by the native host render reply. */
export interface PointRenderFields {
	loadedSources?: string[];
	resolvedTargetRef?: string | null;
	elementTexts?: Record<string, string> | null;
	slottedParents?: Record<string, string> | null;
}

/** Host-side metadata attached to a capture when pointing is active. */
export interface PointCaptureMeta {
	loadedSources: string[];
	resolvedTargetRef: string | null;
	elementTexts: Record<string, string>;
	slottedParents: Record<string, string>;
}

/** Normalize optional host render pointing fields into a concrete `PointCaptureMeta`. */
export function extractPointMeta(rendered: PointRenderFields): PointCaptureMeta {
	return {
		loadedSources: rendered.loadedSources ?? [],
		resolvedTargetRef: rendered.resolvedTargetRef ?? null,
		elementTexts: rendered.elementTexts ?? {},
		slottedParents: rendered.slottedParents ?? {},
	};
}

/** Build the pointing subset of the `BenchRuntime` surface. */
export function createPointApi(ensureOpen: () => void, host: PointHost) {
	return {
		async point(rawRequest: PointRequest): Promise<PointResult> {
			ensureOpen();
			return runPoint(host, rawRequest);
		},
		async pointCheck(rawRequest: PointCheckRequest): Promise<PointCheckResult> {
			ensureOpen();
			return runPointCheck(host, rawRequest);
		},
		async pointMove(rawRequest: PointMoveRequest): Promise<PointResult> {
			ensureOpen();
			return runPointMove(host, rawRequest);
		},
	};
}

/** Narrow bench view required by `runPoint`, `runPointCheck`, and `runPointMove`. */
export interface PointHost {
	config: LoadedConfig;
	capture(
		request: {
			id: string;
			context?: Partial<SpecimenContext>;
			checkpoint?: string;
			timeoutMs?: number;
		},
		options: { resolveTarget?: Target; collectTexts?: boolean }
	): Promise<{
		observation: Observation | null;
		outcome?: { status: string } | null;
		pointMeta: PointCaptureMeta;
	}>;
}

function computePointDigests(
	config: LoadedConfig,
	entry: SpecimenEntry,
	componentTag: string | undefined,
	loadedSources: readonly string[]
): Promise<Record<string, string>> {
	const paths: string[] = [
		config.file,
		...(config.manifestFile ? [config.manifestFile] : []),
		...(config.modules[entry.id] ? [config.modules[entry.id] as string] : []),
		...loadedSources,
	];
	const schemaModule = componentTag ? config.schemas[componentTag]?.module : undefined;
	if (schemaModule) {
		paths.push(resolve(config.manifestDirectory ?? config.root, schemaModule));
	}
	const overrides: Record<string, string> = {
		[config.file]: config.digest.slice(0, POINT_SOURCE_DIGEST_LENGTH),
		...(config.manifestFile && config.manifestDigest
			? { [config.manifestFile]: config.manifestDigest.slice(0, POINT_SOURCE_DIGEST_LENGTH) }
			: {}),
	};
	return computeSourceDigests(config.root, paths, overrides);
}

/** Execute `specimen-point` against the bench host and persist the resulting point file. */
export async function runPoint(host: PointHost, rawRequest: PointRequest): Promise<PointResult> {
	const { config } = host;
	const request = parsePointRequest(rawRequest);
	const knownIds = config.entries.map((item) => item.id);

	if ('pointer' in request) {
		const parsed = parsePointer(request.pointer);
		const entry = config.entries.find((item) => item.id === parsed.specimen);
		if (!entry) throw specimenNotFoundError(parsed.specimen, knownIds);
		const requestedContext = normalizePointContextInput(parsed.context, 'pointer');
		const { observation, pointMeta } = await host.capture(
			{
				id: entry.id,
				context: requestedContext,
				...(parsed.checkpoint ? { checkpoint: parsed.checkpoint } : {}),
				...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
			},
			{ collectTexts: true }
		);
		if (!observation) throw new Error('The host returned no observation for specimen-point.');
		const { loadedSources, elementTexts, slottedParents } = pointMeta;
		const tree = observationClimbTree(observation.channels.elements, slottedParents);
		const hit = tree.get(parsed.ref);
		if (!hit) {
			throw pointError(
				'TARGET_NOT_FOUND',
				`Pointer ref '${parsed.ref}' was not found in specimen '${entry.id}'.`,
				'Point again in the review page, or name a role and name that exist.',
				{ count: 0, ref: parsed.ref }
			);
		}
		const climbed = climbSelection(hit, parsed.depth ? { depth: parsed.depth } : {});
		const componentTag = nearestComponentTag(climbed.selected, entry.component);
		const sourceDigests = await computePointDigests(config, entry, componentTag, loadedSources);
		const point = buildPoint({
			id: generatePointId(),
			entry,
			config,
			observation,
			selected: climbed.selected,
			...(climbed.accessible
				? {
						accessible: {
							...(climbed.accessible.role ? { role: climbed.accessible.role } : {}),
							...(climbed.accessible.name ? { name: climbed.accessible.name } : {}),
							from: climbed.accessible.from.value,
						},
					}
				: {}),
			elementTexts,
			slottedParents,
			context: formatPointContext(observation.manifest.context, requestedContext),
			...(parsed.checkpoint ? { checkpoint: parsed.checkpoint } : {}),
			pin: parsed.pin,
			sourceDigests,
		});
		await writePointFile(config.root, point);
		return { point };
	}

	const entry = config.entries.find((item) => item.id === request.id);
	if (!entry) throw specimenNotFoundError(request.id, knownIds);
	const requestedContext = normalizePointContextInput(request.context, 'request');
	const { observation, pointMeta } = await host.capture(
		{
			id: entry.id,
			context: requestedContext,
			...(request.checkpoint ? { checkpoint: request.checkpoint } : {}),
			...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
		},
		{ resolveTarget: request.target, collectTexts: true }
	);
	if (!observation) throw new Error('The host returned no observation for specimen-point.');
	const { loadedSources, resolvedTargetRef, elementTexts, slottedParents } = pointMeta;
	if (!resolvedTargetRef) {
		throw pointError(
			'TARGET_NOT_FOUND',
			`Target did not resolve to an element in specimen '${entry.id}'.`,
			'Point again in the review page, or name a role and name that exist.',
			{ count: 0 }
		);
	}
	const tree = observationClimbTree(observation.channels.elements, slottedParents);
	const hit = tree.get(resolvedTargetRef);
	if (!hit) {
		throw pointError(
			'TARGET_NOT_FOUND',
			`Resolved target '${resolvedTargetRef}' was not found in the captured tree for specimen '${entry.id}'.`,
			'Point again in the review page, or name a role and name that exist.',
			{ count: 0, ref: resolvedTargetRef }
		);
	}
	const climbed = climbSelection(hit);
	const componentTag = nearestComponentTag(climbed.selected, entry.component);
	const sourceDigests = await computePointDigests(config, entry, componentTag, loadedSources);
	const point = buildPoint({
		id: generatePointId(),
		entry,
		config,
		observation,
		selected: climbed.selected,
		...(climbed.accessible
			? {
					accessible: {
						...(climbed.accessible.role ? { role: climbed.accessible.role } : {}),
						...(climbed.accessible.name ? { name: climbed.accessible.name } : {}),
						from: climbed.accessible.from.value,
					},
				}
			: {}),
		elementTexts,
		slottedParents,
		context: formatPointContext(observation.manifest.context, requestedContext),
		...(request.checkpoint ? { checkpoint: request.checkpoint } : {}),
		pin: DEFAULT_PIN,
		sourceDigests,
	});
	await writePointFile(config.root, point);
	return { point };
}

/** Execute `specimen-point-check` against the bench host. */
export async function runPointCheck(
	host: PointHost,
	rawRequest: PointCheckRequest
): Promise<PointCheckResult> {
	const { config } = host;
	const request = parsePointCheckRequest(rawRequest);
	const stored = await readPointFile(config.root, request.id);
	const changedFiles = await diffRecordedDigests(config.root, stored.source.digests);
	const entry = config.entries.find((item) => item.id === stored.specimen);
	if (!entry) return evaluatePointStaleness(stored, changedFiles, null);
	const requestedContext = normalizePointContextInput(stored.context, 'request');
	try {
		const { observation, pointMeta } = await host.capture(
			{
				id: entry.id,
				context: requestedContext,
				...(stored.checkpoint ? { checkpoint: stored.checkpoint } : {}),
				...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
			},
			{ collectTexts: true }
		);
		return evaluatePointStaleness(stored, changedFiles, observation, pointMeta.slottedParents);
	} catch (error) {
		if (changedFiles.length > 0) {
			return { status: 'stale', changed: changedFiles };
		}
		throw error;
	}
}

/** Execute `specimen-point-move` against the bench host and persist the new point file. */
export async function runPointMove(
	host: PointHost,
	rawRequest: PointMoveRequest
): Promise<PointResult> {
	const { config } = host;
	const request = parsePointMoveRequest(rawRequest);
	const stored = await readPointFile(config.root, request.id);
	const changedFiles = await diffRecordedDigests(config.root, stored.source.digests);
	if (changedFiles.length > 0) {
		throw pointError(
			'POINT_STALE',
			`Point ${stored.id} is stale (${changedFiles.join(', ')}).`,
			'Run specimen-point to point again.',
			{ id: stored.id, changed: changedFiles }
		);
	}
	const entry = config.entries.find((item) => item.id === stored.specimen);
	if (!entry) {
		const staleness = evaluatePointStaleness(stored, changedFiles, null);
		throw pointError(
			'POINT_STALE',
			`Point ${stored.id} is stale (${staleness.changed.join(', ')}).`,
			'Run specimen-point to point again.',
			{ id: stored.id, changed: staleness.changed }
		);
	}
	const requestedContext = normalizePointContextInput(stored.context, 'request');
	const { observation, pointMeta } = await host.capture(
		{
			id: entry.id,
			context: requestedContext,
			...(stored.checkpoint ? { checkpoint: stored.checkpoint } : {}),
			...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
		},
		{ collectTexts: true }
	);
	const { loadedSources, elementTexts, slottedParents } = pointMeta;
	const staleness = evaluatePointStaleness(stored, changedFiles, observation, slottedParents);
	if (staleness.status === 'stale' || !observation) {
		throw pointError(
			'POINT_STALE',
			`Point ${stored.id} is stale (${staleness.changed.join(', ')}).`,
			'Run specimen-point to point again.',
			{ id: stored.id, changed: staleness.changed }
		);
	}
	const moved = resolvePointMove(
		observation.channels.elements,
		stored.element.ref,
		request.to,
		request.index ?? 0,
		slottedParents
	);
	const componentTag = nearestComponentTag(moved.target, entry.component);
	const sourceDigests = await computePointDigests(config, entry, componentTag, loadedSources);
	const point = buildPoint({
		id: generatePointId(),
		entry,
		config,
		observation,
		selected: moved.target,
		...(moved.accessible ? { accessible: moved.accessible } : {}),
		elementTexts,
		slottedParents,
		context: formatPointContext(observation.manifest.context, requestedContext),
		...(stored.checkpoint ? { checkpoint: stored.checkpoint } : {}),
		pin: DEFAULT_PIN,
		sourceDigests,
	});
	await writePointFile(config.root, point);
	return { point };
}
