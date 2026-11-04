/**
 * @fileoverview What `project-summary-get` loads on its first call (phase 2 specification, 7.7), so the
 * `late` chunk holds only its definition (2.4): each app's summary, asked as a nested query at the
 * project's scope under a deadline, and read by hand, each field for what it is, dropping what is over a
 * bound. One app's failure is that row's error alone. The shell never reads an app's resources.
 */

import type { CommandResult } from '@lushly-dev/afd-core';
import type { ProjectSummaryV1, ResourceLinkV1 } from '@lushly-dev/loam-sdk';
import type { ScopeV1 } from '../scope/records.js';
import type { AppSummaryV2, ProjectSummaryRowV1 } from '../types.js';
import type { ProjectSummaryDeps } from './project-summary.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Control and format characters, bidirectional overrides, zero-width marks and tag characters among them:
 * in shown text they could hide or reorder what a row says, or carry a payload no person sees that an agent
 * reads (13). A flag's tag sequence, U+1F3F4 and its tags, is kept, as are ZWNJ and ZWJ, which join scripts
 * and emoji.
 */
const UNSAFE = /(\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F})|[\p{Cc}\p{Cf}]/gu;

/** Text with nothing in it a person can see: ignorable code points and white space alone. */
const BLANK = /^[\p{Default_Ignorable_Code_Point}\p{White_Space}]*$/u;

/** `value` with the unsafe characters stripped, cut at `max` code points so no surrogate pair splits. */
const clean = (value: string, max = Number.POSITIVE_INFINITY): string =>
	[
		...value.replace(
			UNSAFE,
			(found: string, flag?: string) =>
				flag ?? (found === '\u200c' || found === '\u200d' ? found : '')
		),
	]
		.slice(0, max)
		.join('');

/** Shown text: cleaned, then 1 to `max` code points with something visible, or undefined. */
const text = (value: unknown, max: number): string | undefined => {
	if (typeof value !== 'string') return undefined;
	const cleaned = clean(value);
	return !BLANK.test(cleaned) && [...cleaned].length <= max ? cleaned : undefined;
};

/** An id or a route: kept as it is, so never stripped, and refused when it holds a control or format character. */
const id = (value: unknown, max: number): string | undefined =>
	typeof value === 'string' &&
	value.length > 0 &&
	value.length <= max &&
	!/[\p{Cc}\p{Cf}]/u.test(value)
		? value
		: undefined;

/** A count's value: any finite number. */
const finite = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

/** A time a `Date` can hold: an integer of milliseconds within ±8.64e15, so formatting it cannot throw. */
const instant = (value: unknown): value is number =>
	Number.isInteger(value) && Math.abs(value as number) <= 8.64e15;

const ID = 128;

function readScope(value: unknown): ScopeV1 | undefined {
	if (!isRecord(value)) return undefined;
	const workspace = id(value.workspace, ID);
	if (workspace === undefined) return undefined;
	if (value.project === undefined) return { workspace };
	const project = id(value.project, ID);
	return project === undefined ? undefined : { workspace, project };
}

/**
 * A resource link, read by hand and by shape (documents specification, 9.1): only its own keys are kept,
 * and an unknown `kind` is undefined, which the caller drops with a warning. A document link's `anchor` is
 * not kept: nothing in phase 2 reads one, and its shape is the documents' type's (G4, recorded).
 */
export function readResourceLink(value: unknown): ResourceLinkV1 | undefined {
	if (!isRecord(value)) return undefined;
	const scope = readScope(value.scope);
	if (scope === undefined) return undefined;
	if (value.kind === 'document') {
		const document = id(value.document, ID);
		if (document === undefined) return undefined;
		return { kind: 'document', document, scope };
	}
	if (value.kind === 'app') {
		const instance = id(value.instance, 64);
		if (instance === undefined) return undefined;
		if (value.route === undefined) return { kind: 'app', instance, scope };
		const route = value.route === '' ? '' : id(value.route, 1024);
		return route === undefined ? undefined : { kind: 'app', instance, route, scope };
	}
	return undefined;
}

/** What {@link readProjectSummary} read, and how many entries it dropped. */
export interface ReadSummary {
	summary: ProjectSummaryV1;
	dropped: number;
}

/**
 * An app's summary, read for what each field is (7.7): undefined when it is no object or a field is no
 * list, so the row is `PROJECT_SUMMARY_INVALID`; otherwise each entry that is malformed or over a bound is
 * dropped, and the lists are cut at 8 counts, 10 recent and 6 links. Unknown keys are not read.
 */
export function readProjectSummary(value: unknown): ReadSummary | undefined {
	if (!isRecord(value)) return undefined;
	const lists = ['counts', 'recent', 'links'] as const;
	if (lists.some((key) => value[key] !== undefined && !Array.isArray(value[key]))) return undefined;
	let dropped = 0;
	const keep = <T>(
		key: (typeof lists)[number],
		max: number,
		read: (item: unknown) => T | undefined
	): T[] | undefined => {
		const items = value[key] as unknown[] | undefined;
		if (items === undefined) return undefined;
		const kept: T[] = [];
		for (const item of items) {
			const read_ = kept.length < max ? read(item) : undefined;
			if (read_ === undefined) dropped++;
			else kept.push(read_);
		}
		return kept;
	};
	const counts = keep('counts', 8, (item) => {
		if (!isRecord(item)) return undefined;
		const label = text(item.label, 40);
		return label !== undefined && finite(item.value) ? { label, value: item.value } : undefined;
	});
	const recent = keep('recent', 10, (item) => {
		if (!isRecord(item)) return undefined;
		const title = text(item.title, 120);
		if (title === undefined) return undefined;
		const entry: NonNullable<ProjectSummaryV1['recent']>[number] = { title };
		if (instant(item.updatedAt)) entry.updatedAt = item.updatedAt;
		else if (item.updatedAt !== undefined) dropped++;
		if (item.link !== undefined) {
			const link = readResourceLink(item.link);
			if (link) entry.link = link;
			else dropped++;
		}
		return entry;
	});
	const links = keep('links', 6, (item) => {
		if (!isRecord(item)) return undefined;
		const label = text(item.label, 40);
		const link = readResourceLink(item.link);
		return label !== undefined && link !== undefined ? { label, link } : undefined;
	});
	return {
		summary: {
			...(counts ? { counts } : {}),
			...(recent ? { recent } : {}),
			...(links ? { links } : {}),
		},
		dropped,
	};
}

/** A command's own failure, as a row shows it: three strings, each bounded. */
const rowError = (
	error: { code?: unknown; message?: unknown; suggestion?: unknown } | undefined
) => {
	// Cleaned as shown text is, bounded in code points; one with nothing visible reads the default (N1).
	const shown = (value: unknown, max: number, fallback: string) => {
		const cleaned = clean(String(value ?? ''), max);
		return BLANK.test(cleaned) ? fallback : cleaned;
	};
	return {
		code: shown(error?.code, 64, 'COMMAND_FAILED'),
		message: shown(error?.message, 400, 'The summary failed'),
		suggestion: shown(error?.suggestion, 400, "Report this to the app's owner"),
	};
};

const REPORT = "Report this to the app's owner";

/** How long a summary may take before its row says so (7.7). A wall clock, so a replay answers from the record. */
export const PROJECT_SUMMARY_DEADLINE_MS = 2_000;

/** Each enabled app with a summary that opens in the project, asked at once, in the rail's order. */
export function summaryRows(
	deps: ProjectSummaryDeps,
	at: Required<ScopeV1>,
	parent: string,
	iface: 'palette' | 'agent'
): Promise<ProjectSummaryRowV1[]> {
	const { scope } = deps;
	const deadline = deps.deadlineMs ?? PROJECT_SUMMARY_DEADLINE_MS;
	const apps = deps.apps();

	/** One app's row: its command, nested at the project's scope, under the deadline. */
	async function summarize(app: AppSummaryV2, command: string): Promise<ProjectSummaryRowV1> {
		const row = { instance: app.instance, title: app.title, icon: app.icon };
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const late = new Promise<'late'>((resolve) => {
			timer = setTimeout(() => {
				controller.abort();
				resolve('late');
			}, deadline);
		});
		let result: CommandResult | 'late';
		try {
			result = await Promise.race([
				// On the outer call's interface, so a summary hidden from the model is no agent's to read.
				deps.run(iface, command, {}, { signal: controller.signal }, { parent, scope: at }),
				late,
			]);
		} catch (cause) {
			result = {
				success: false,
				error: rowError({ message: String((cause as Error)?.message ?? cause) }),
			};
		} finally {
			clearTimeout(timer);
		}
		if (result === 'late') {
			return {
				...row,
				error: {
					code: 'PROJECT_SUMMARY_TIMEOUT',
					message: `${app.title} did not answer within ${deadline / 1000} seconds`,
					suggestion: REPORT,
				},
			};
		}
		// What the app returned is read inside a guard: a result that throws as it is read, a getter or a
		// proxy, is that row's PROJECT_SUMMARY_INVALID, never every row's (N5).
		let read: ReadSummary | undefined;
		try {
			if (!result.success) return { ...row, error: rowError(result.error) };
			read = readProjectSummary(result.data);
		} catch {
			read = undefined;
		}
		if (!read) {
			return {
				...row,
				error: {
					code: 'PROJECT_SUMMARY_INVALID',
					message: `${app.title} returned a summary the shell cannot read`,
					suggestion: REPORT,
				},
			};
		}
		return {
			...row,
			summary: read.summary,
			...(read.dropped > 0 ? { dropped: read.dropped } : {}),
		};
	}

	return Promise.all(
		deps.summaries().flatMap((app): Promise<ProjectSummaryRowV1>[] => {
			if (app.state !== 'ready' || !scope.opensIn(app.instance, app.scopeLevels, at.project))
				return [];
			let manifest: ReturnType<typeof apps.port>['manifest'];
			try {
				manifest = apps.port(app.instance).manifest;
			} catch {
				return [];
			}
			const command = manifest.ui?.project_summary?.command;
			if (command === undefined) return [];
			// The manifest's rule refused a summary that writes (8.3); a mutation is never run as one all the same.
			if (deps.isMutation(command)) {
				return [
					Promise.resolve({
						instance: app.instance,
						title: app.title,
						icon: app.icon,
						error: {
							code: 'MANIFEST_SUMMARY_INVALID',
							message: `\`${command}\` changes data, and a summary only reads`,
							suggestion: REPORT,
						},
					}),
				];
			}
			// The app's own command: never another's, nor the shell's.
			return apps.owners.get(command)?.instance === app.instance ? [summarize(app, command)] : [];
		})
	);
}

/** `PROJECT_SUMMARY_DROPPED`, a warning per row whose summary lost entries, naming the app and the count (7.7). */
export const droppedWarnings = (rows: readonly ProjectSummaryRowV1[]) =>
	rows.flatMap(({ title, dropped }) =>
		dropped
			? [
					{
						code: 'PROJECT_SUMMARY_DROPPED',
						message: `${title} returned ${dropped} ${dropped === 1 ? 'entry' : 'entries'} the shell could not show`,
						severity: 'info' as const,
					},
				]
			: []
	);
