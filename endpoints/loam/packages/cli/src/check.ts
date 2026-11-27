/**
 * @fileoverview `@lushly-dev/loam-cli/check`: `checkApp`, a pure function over a map of files (phase 1
 * specification, section 11). No Node.js builtin, so phase 7's shell command can reuse it, and it runs
 * none of the app's code. `app check` adds what needs a process: the surface validator, whose package
 * reads files, and the token lint.
 */

import { defaultExpose } from '@lushly-dev/afd-server/define';
import { type ManifestV3, NOTICES_V1, TRUST_LINES_V1 } from '@lushly-dev/loam-manifest';
import { fromJsonSchema, keyOf, readManifest } from '@lushly-dev/loam-manifest/validate';
import { parse as parseToml } from 'smol-toml';
import type { z } from 'zod';
import { type AppTree, builtFileFindings, type FileFinding, inlineSchemas } from './file-rules.js';

export const DEFAULT_MANIFEST = 'loam-app.toml';

/** One refusal or warning: it names the key and gives a suggestion. */
export interface Finding {
	code: string;
	key: string;
	message: string;
	suggestion: string;
	/**
	 * Why, as a stable tag, where a code alone does not say: a `.loam-plugin` archive's refusals carry one, which
	 * loam-desktop's Rust inspect gives too (the phase 5 no-terminal amendment, 4.4's archive rules).
	 */
	reason?: string;
}

export interface Trust {
	code: string;
	line: string;
	notices: Array<{ code: string; message: string }>;
}

/**
 * Each document template's `content` against its type's `content_schema`, read with `z.fromJSONSchema`
 * as the reader reads the schema (documents specification, 2.1): `DOCUMENT_TEMPLATE_INVALID`. The kernel
 * reads no content, so this is `app check`'s and `app pack`'s alone.
 */
function templateFindings(manifest: ManifestV3): Finding[] {
	return (manifest.ui?.documents ?? []).flatMap((type, index) => {
		let schema: z.ZodType;
		try {
			schema = fromJsonSchema(type.content_schema);
		} catch {
			// The reader refused it already, as `MANIFEST_INPUT_SCHEMA_INVALID`.
			return [];
		}
		return type.templates.flatMap((template, at) =>
			schema.safeParse(template.content).success
				? []
				: [
						{
							code: 'DOCUMENT_TEMPLATE_INVALID',
							key: keyOf(`/ui/documents/${index}/templates/${at}/content`),
							message: `The template \`${template.id}\` does not match its type's \`content_schema\`.`,
							suggestion: 'Correct the template, or the schema, so a new document starts valid.',
						},
					]
		);
	});
}

/** What `validateCommandSurface` reads of a command. */
export interface SurfaceCommandSummary {
	name: string;
	description: string;
	category?: string;
	jsonSchema: unknown;
	requires?: string[];
	examples?: unknown[];
	contexts?: string[];
}

export interface SurfaceFindingSummary {
	rule: string;
	severity: 'error' | 'warning' | 'info';
	message: string;
	commands: string[];
	suggestion: string;
}

export type SurfaceCheck = (commands: SurfaceCommandSummary[]) => SurfaceFindingSummary[];

const ONE_DAY_MS = 86_400_000;

/**
 * Warnings for non-graduated, non-removed experiments whose `ends` date has passed (`EXPERIMENT_OVERDUE`,
 * phase 4 specification 5.1, #2110). Matches `kernel/src/late/experiment-rules.ts`'s UTC-day boundary:
 * overdue starting the UTC day after `ends`.
 */
function overdueExperimentFindings(manifest: ManifestV3, now: number): Finding[] {
	if (!Number.isFinite(now)) return [];
	return (manifest.ui?.experiments ?? []).flatMap((experiment, index) => {
		if (experiment.stage === 'graduated' || experiment.stage === 'removed') return [];
		const end = Date.parse(`${experiment.ends}T00:00:00Z`);
		if (!Number.isFinite(end) || now < end + ONE_DAY_MS) return [];
		return [
			{
				code: 'EXPERIMENT_OVERDUE',
				key: keyOf(`/ui/experiments/${index}/ends`),
				message: `'${manifest.plugin.id}.${experiment.id}' was to end on ${experiment.ends}; nothing turns off on a date, so its author should graduate or remove it.`,
				suggestion: `Set stage to "graduated" or "removed" for '${experiment.id}', or update its ends date.`,
			},
		];
	});
}

export interface CheckAppOptions {
	symlinks?: AppTree['symlinks'];
	/** The manifest's path in the map. */
	manifest?: string;
	/** `validateCommandSurface`, for a caller that can load it: its package needs Node.js. */
	surface?: SurfaceCheck;
	/** Epoch milliseconds for time-dependent warnings (`EXPERIMENT_OVERDUE`, #2110). Omitted: pure, no clock. */
	now?: number;
}

export interface AppCheckReport {
	ok: boolean;
	kind?: 'native' | 'view' | 'mounted';
	/** The manifest with its schemas inlined, when it was read. */
	manifest?: ManifestV3;
	refusals: Finding[];
	warnings: Finding[];
	/** The effective flags of each command, a flag left out taking AFD's default (L3). */
	exposure: Record<string, Record<string, boolean>>;
	/** Always, when the kind is one Loam reads. */
	trust?: Trust;
}

const asFinding = ({ pointer, ...rest }: FileFinding): Finding => ({
	...rest,
	key: keyOf(pointer),
});

function trustOf(kind: AppCheckReport['kind']): Trust | undefined {
	if (kind === undefined) return undefined;
	const { code, line } = TRUST_LINES_V1[kind];
	return {
		code,
		line,
		notices:
			kind === 'mounted'
				? [
						{
							code: 'MOUNT_ANNOTATIONS_UNTRUSTED',
							message: NOTICES_V1.MOUNT_ANNOTATIONS_UNTRUSTED,
						},
						{
							code: 'TEAM_INSTANCE_SINGLE_PRINCIPAL',
							message: NOTICES_V1.TEAM_INSTANCE_NOTICE,
						},
					]
				: [],
	};
}

function kindOf(raw: Record<string, unknown>): AppCheckReport['kind'] {
	const kind = (raw.plugin as { kind?: unknown } | undefined)?.kind;
	return kind === 'native' || kind === 'view' || kind === 'mounted' ? kind : undefined;
}

function exposureOf(manifest: ManifestV3): AppCheckReport['exposure'] {
	return Object.fromEntries(
		(manifest.commands ?? []).map((command) => [
			command.name,
			{ ...defaultExpose, ...command.expose } as Record<string, boolean>,
		])
	);
}

/** Surface findings warn, but for an injection finding in a description, which fails. */
function surfaceFindings(
	manifest: ManifestV3,
	surface: SurfaceCheck
): { refusals: Finding[]; warnings: Finding[] } {
	const commands = manifest.commands ?? [];
	const found = surface(
		commands.map((command) => ({
			name: command.name,
			description: command.description,
			category: command.category,
			jsonSchema: command.input_schema,
			requires: command.requires,
			examples: command.examples,
			contexts: command.contexts,
		}))
	);
	const refusals: Finding[] = [];
	const warnings: Finding[] = [];
	for (const finding of found) {
		if (finding.severity === 'info') continue;
		const index = commands.findIndex((command) => command.name === finding.commands[0]);
		const item = {
			code: `SURFACE_${finding.rule.toUpperCase().replaceAll('-', '_')}`,
			key: index >= 0 ? `commands[${index}]` : 'commands',
			message: finding.message,
			suggestion: finding.suggestion,
		};
		if (finding.rule === 'description-injection') refusals.push(item);
		else warnings.push(item);
	}
	return { refusals, warnings };
}

/** Parses TOML the way every reader here wants it: JSON values only, so a date is a string. */
export function parseManifestToml(text: string): Record<string, unknown> {
	return JSON.parse(JSON.stringify(parseToml(text)));
}

/**
 * The checks of `app check` that need only the files: the TOML, `path-inside-root` and `files`, the
 * reader after inlining, the effective exposure, each built file, and the trust line.
 */
export function checkApp(
	files: Readonly<Record<string, string>>,
	options: CheckAppOptions = {}
): AppCheckReport {
	const manifestPath = (options.manifest ?? DEFAULT_MANIFEST).replace(/^(\.\/)+/, '');
	const fail = (finding: Finding): AppCheckReport => ({
		ok: false,
		refusals: [finding],
		warnings: [],
		exposure: {},
	});
	const source = files[manifestPath];
	if (source === undefined) {
		return fail({
			code: 'APP_MANIFEST_MISSING',
			key: manifestPath,
			message: `There is no \`${manifestPath}\` here.`,
			suggestion: 'Run `loam app new`, or check the directory and `--manifest`.',
		});
	}
	let raw: Record<string, unknown>;
	try {
		raw = parseManifestToml(source);
	} catch (cause) {
		return fail({
			code: 'MANIFEST_TOML_INVALID',
			key: manifestPath,
			message: cause instanceof Error ? cause.message : String(cause),
			suggestion: 'Fix the TOML at the line it names.',
		});
	}

	const tree: AppTree = { files, symlinks: options.symlinks ?? {} };
	const { inlined, findings } = inlineSchemas(raw, tree);
	const built = builtFileFindings(raw, tree);
	const fileRefusals = [...findings, ...built.refusals].map(asFinding);
	const read = readManifest(inlined);
	// A path the file rules refused is reported once, under the rule that says why.
	const refusedKeys = new Set(fileRefusals.map((finding) => finding.key));
	const refusals: Finding[] = [
		...fileRefusals,
		...(read.ok ? [] : read.refusals.filter((refusal) => !refusedKeys.has(refusal.key))),
	];
	const warnings: Finding[] = [...read.warnings, ...built.warnings.map(asFinding)];
	const kind = kindOf(raw);
	const trust = trustOf(kind);
	const report = (manifest?: ManifestV3): AppCheckReport => ({
		ok: refusals.length === 0,
		...(kind ? { kind } : {}),
		...(manifest ? { manifest } : {}),
		refusals,
		warnings,
		exposure: manifest ? exposureOf(manifest) : {},
		...(trust ? { trust } : {}),
	});
	if (!read.ok) return report();
	refusals.push(...templateFindings(read.manifest));
	if (options.now !== undefined) {
		warnings.push(...overdueExperimentFindings(read.manifest, options.now));
	}
	if (options.surface) {
		const surface = surfaceFindings(read.manifest, options.surface);
		refusals.push(...surface.refusals);
		warnings.push(...surface.warnings);
	}
	return report(read.manifest);
}
