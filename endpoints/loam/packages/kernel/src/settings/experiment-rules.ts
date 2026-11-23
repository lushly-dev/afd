/**
 * @fileoverview The pure rules of experiments (phase 4 specification, 5.1 to 5.3; D119, D155): an experiment's
 * declaration as the kernel holds it, the enablements, and `experimentOn`, which decides whether an experiment is on
 * for one person from its stage, its `changes` digest and the two enablements alone. No store and no clock: a replay
 * reads the same store and manifests, and decides the same (5.3). Nothing here is an input to any access decision; a
 * gate decides presence, never permission (P4-E2).
 */

import type { ExperimentStageV1, ExperimentV1 } from '@lushly-dev/loam-manifest';

/** An experiment one loaded app declares, with its full id, its owner and the digest of its `changes` (5.2). */
export interface DeclaredExperimentV1 extends ExperimentV1 {
	/** `<plugin.id>.<id>`. */
	fullId: string;
	/** The instance that declares it. */
	owner: string;
	plugin: string;
	/** `sha256:<hex>` of `changes`, as it is shown. */
	digest: string;
}

/**
 * A person's own choice, in their `loam.settings` (5.2): turned on with the `changes` they were shown, or turned off,
 * an opt-out of the workspace's enablement (D155), which holds whatever the `changes` become. `told` is the digest the
 * person was last told had changed, so the notice of 5.2 is sent once.
 */
export interface PersonEnablementV1 {
	on: boolean;
	digest: string;
	told?: string;
	/** When it was made, which a removal at or after it voids (5.1's "a re-shipped id revives nothing"). */
	at?: number;
}

/** An owner's enablement for the workspace, a row of the `experiment-enablement` table, `<workspace>/<fullId>`. */
export interface WorkspaceEnablementV1 {
	id: string;
	workspace: string;
	experiment: string;
	digest: string;
	updatedAt: number;
	updatedBy: string;
	told?: string;
}

/** What decided an experiment's state for the person (5.4): its stage, the person, the workspace, or nothing yet. */
export type ExperimentByV1 = 'stage' | 'person' | 'workspace' | null;

/** An experiment's state for one person (architecture section 5, amended): its stage, then its enablement. */
export interface ExperimentStateV1 {
	on: boolean;
	by: ExperimentByV1;
}

/** What `experiment-check` answers for an id that is unknown, `hidden` or `removed`: the same bytes for each (5.4). */
export const UNKNOWN_STATE: Readonly<ExperimentStateV1> = Object.freeze({ on: false, by: 'stage' });

/** `^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]{0,39}$`: an experiment's full id, as a gate and every command name it. */
export const EXPERIMENT_ID = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]{0,39}$/;

/** The stages anyone but an author in `local` sees (5.1): `hidden` is listed to nobody, `removed` is gone. */
export const LISTED_STAGES: readonly ExperimentStageV1[] = Object.freeze(['visible', 'graduated']);

/**
 * Whether an experiment is on for one person (5.2), and what decided it:
 *
 * - `graduated` is on, and `hidden` and `removed` off, for everyone, whatever is stored;
 * - `visible` is on when the person turned it on with the current digest;
 * - else off when the person turned it off, an opt-out that holds whatever the digest (D155);
 * - else on when the workspace turned it on with the current digest;
 * - else off, nothing having decided. A digest that changed counts as off until turned on again.
 */
export function experimentOn(
	experiment: Pick<DeclaredExperimentV1, 'stage' | 'digest'> | undefined,
	heldPerson: PersonEnablementV1 | undefined,
	heldWorkspace: (Pick<WorkspaceEnablementV1, 'digest'> & { updatedAt?: number }) | undefined,
	removedAt?: number
): ExperimentStateV1 {
	// An enablement made before the experiment was last removed counts for nothing: a re-shipped id revives nothing (5.1).
	const person = live(heldPerson?.at, removedAt) ? heldPerson : undefined;
	const workspace = live(heldWorkspace?.updatedAt, removedAt) ? heldWorkspace : undefined;
	if (!experiment || experiment.stage === 'hidden' || experiment.stage === 'removed')
		return { ...UNKNOWN_STATE };
	if (experiment.stage === 'graduated') return { on: true, by: 'stage' };
	if (person?.on === true && person.digest === experiment.digest) return { on: true, by: 'person' };
	if (person?.on === false) return { on: false, by: 'person' };
	if (workspace?.digest === experiment.digest) return { on: true, by: 'workspace' };
	return { on: false, by: null };
}

/** Whether an enablement made at `at` outlives the experiment's last removal, at `removedAt`. */
export const live = (at: number | undefined, removedAt: number | undefined): boolean =>
	removedAt === undefined || (at !== undefined && at > removedAt);

/**
 * Whether an enablement was made for `changes` other than those shown now (5.2's `changed`): a person's own turning on,
 * or the workspace's, with an older digest. An opt-out is never `changed`, since it holds whatever the digest.
 */
export function enablementChanged(
	experiment: Pick<DeclaredExperimentV1, 'digest'>,
	person: PersonEnablementV1 | undefined,
	workspace: Pick<WorkspaceEnablementV1, 'digest'> | undefined
): boolean {
	return (
		(person?.on === true && person.digest !== experiment.digest) ||
		(workspace !== undefined && workspace.digest !== experiment.digest)
	);
}

/**
 * The experiments `experiment-settle` removes when a manifest is applied (5.1, I6): each its app now declares
 * `removed`, or no longer declares, or whose app the deployment no longer lists at all. An app the deployment lists
 * whose package could not be read decides nothing, so a package that fails to load for a while loses nobody's choice.
 * A removal is kept as the time it happened, which voids every enablement made before it, each person's included
 * (`experimentOn`'s `removedAt`), so a re-shipped id revives nothing.
 */
export function settledAway(
	ids: readonly string[],
	declared: ReadonlyMap<string, Pick<DeclaredExperimentV1, 'stage'>>,
	readPlugins: ReadonlySet<string>,
	listedPlugins: ReadonlySet<string>
): string[] {
	return ids.filter((id) => {
		const held = declared.get(id);
		if (held) return held.stage === 'removed';
		const plugin = id.slice(0, id.indexOf('.'));
		return readPlugins.has(plugin) || !listedPlugins.has(plugin);
	});
}

/** Whether `ends`, `YYYY-MM-DD`, has passed on the call's clock (5.1's `EXPERIMENT_OVERDUE`): the day after it began. */
export function overdue(ends: string, now: number): boolean {
	const end = Date.parse(`${ends}T00:00:00Z`);
	return Number.isFinite(end) && now >= end + 86_400_000;
}

const SEMVER =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Exact unsigned decimal integer comparison (no leading zeros), avoiding `Number` precision loss. */
const compareUint = (a: string, b: string): number =>
	a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0;

/** Whether `value` is a strict SemVer 2.0.0 string (#2114). */
export const isSemver = (value: string | undefined): value is string =>
	value !== undefined && SEMVER.test(value);

/**
 * SemVer 2.0.0 precedence comparison between two manifest `plugin.version` strings (#2114): negative when `a < b`,
 * zero when equal (ignoring build metadata), positive when `a > b`, or undefined if either string is not SemVer.
 */
export function compareSemver(a: string, b: string): number | undefined {
	const ma = SEMVER.exec(a);
	const mb = SEMVER.exec(b);
	if (!ma || !mb) return undefined;
	for (let i = 1; i <= 3; i++) {
		const diff = compareUint(ma[i] as string, mb[i] as string);
		if (diff !== 0) return diff;
	}
	const pa = ma[4];
	const pb = mb[4];
	if (pa === undefined && pb === undefined) return 0;
	if (pa === undefined) return 1;
	if (pb === undefined) return -1;
	const ia = pa.split('.');
	const ib = pb.split('.');
	const len = Math.min(ia.length, ib.length);
	for (let i = 0; i < len; i++) {
		const sa = ia[i] as string;
		const sb = ib[i] as string;
		if (sa === sb) continue;
		const na = /^\d+$/.test(sa);
		const nb = /^\d+$/.test(sb);
		if (na && nb) return compareUint(sa, sb);
		if (na !== nb) return na ? -1 : 1;
		return sa < sb ? -1 : 1;
	}
	return ia.length - ib.length;
}

/**
 * Whether `current` must not override `recorded` (#2114): true when `recorded` is valid SemVer and `current` is
 * either older or missing/incomparable, so a stale or malformed shell never drops newer ids.
 */
export function isStaleVersion(current: string | undefined, recorded: string | undefined): boolean {
	if (!isSemver(recorded)) return false;
	if (!isSemver(current)) return true;
	return (compareSemver(current, recorded) as number) < 0;
}
