/**
 * @fileoverview `@lushly-dev/loam-cli/deployment`: `writeDeployment` (phase 1 specification, 3.2). Only
 * what makes the file unreadable stops a write; a bad package stays in the projection, so the kernel
 * refuses it at load and the rail shows it (D66). Nothing of a location, a credential or a command
 * line reaches the projection.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type {
	DeploymentV1,
	DeploymentV2,
	DeploymentWorkspaceV2,
	ProjectionAppV2,
	ProjectionBootV2,
	ProjectionV2,
} from '@lushly-dev/loam-manifest';
import { DEFAULT_WORKSPACE_V2, readProjection } from '@lushly-dev/loam-manifest/validate';
import {
	analyzeDeployment,
	appKey,
	type DeploymentFinding,
	type DeploymentNotice,
	type InstanceEffect,
	type MountAccess,
	secretPaths,
} from './deployment-analysis.js';
import { copyListed, isWithin, listCopy, OUTPUT_MARKER, realish, replaceable } from './tree.js';

export {
	analyzeDeployment,
	type DeploymentAnalysis,
	type DeploymentFinding,
	type DeploymentNotice,
	type MountAccess,
} from './deployment-analysis.js';

export interface WriteDeploymentOptions {
	/** `loam.deployment.toml`. */
	config: string;
	/** The web host's `dist`. */
	dist: string;
	out: string;
	/** Where the CLI writes the `mounts` list, mode 0600 and outside everything served. */
	mountsOut?: string;
}

export type WriteDeploymentResult =
	| {
			ok: true;
			out: string;
			projection: ProjectionV2;
			/** In memory: what the caller's relay needs. */
			mounts: MountAccess[];
			/** Each instance the kernel will refuse, and the packages' warnings. */
			warnings: DeploymentFinding[];
			notices: DeploymentNotice[];
	  }
	| { ok: false; refusals: DeploymentFinding[]; warnings: DeploymentFinding[] };

const PARTS = ['sidebar', 'inspector', 'panel'] as const;
const DEFAULT_ICON = 'system/folder';
const DEFAULT_ORDER = 100;

/** The finding that refuses `id`, the first of those `deployment check` reports for it. */
function refusalFor(
	id: string,
	findings: readonly DeploymentFinding[]
): ProjectionBootV2['refusal'] {
	const key = appKey(id);
	const found = findings.find(
		(finding) =>
			finding.key === key ||
			(/^[.:[]/.test(finding.key.slice(key.length)) && finding.key.startsWith(key))
	);
	return found ? { code: found.code, message: found.message, suggestion: found.suggestion } : null;
}

/**
 * An entry's boot record (phase 2 specification, 2.2): what `app-list` will say of it, for the rail
 * and a layout's first shape before stage B reads its manifest. Display only.
 */
export function bootRecordOf(
	effect: InstanceEffect,
	findings: readonly DeploymentFinding[]
): ProjectionBootV2 {
	const { id, entry, manifest } = effect;
	const surfaces = manifest?.ui?.surfaces ?? {};
	const rail = surfaces.rail;
	// `ui.documents` is manifest version 2's (8.3); a version 1 manifest never has it.
	const documents = (manifest?.ui as { documents?: unknown } | undefined)?.documents !== undefined;
	const levels: ProjectionBootV2['scope_levels'] =
		effect.mounted && entry.projects !== undefined
			? ['project']
			: (manifest?.app?.scope_levels ?? ['workspace']);
	return {
		title: entry.title ?? rail?.label ?? manifest?.plugin.title ?? id,
		kind: manifest?.plugin.kind ?? 'native',
		icon: rail?.icon ?? DEFAULT_ICON,
		order: entry.order ?? rail?.order ?? DEFAULT_ORDER,
		scope_levels: levels,
		rail: !(documents && !rail && !surfaces.sidebar && !surfaces.main),
		parts: PARTS.filter((part) => surfaces[part] !== undefined),
		layout: (manifest?.ui?.layout ?? {}) as ProjectionBootV2['layout'],
		refusal: refusalFor(id, findings),
	};
}

/** JSON with every object's keys sorted, so equal values give equal text. */
export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (typeof value === 'object' && value !== null) {
		const entries = Object.entries(value)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

/**
 * `sha256-` and the digest of `{ workspace, apps }` with each `boot` left out (2.2): it changes when a
 * deployer's entry changes, not when a package's display does.
 */
export function generationOf(
	workspace: DeploymentWorkspaceV2,
	apps: readonly ProjectionAppV2[]
): string {
	const entries = apps.map(({ boot: _boot, ...entry }) => entry);
	const digest = createHash('sha256').update(canonicalJson({ workspace, apps: entries }));
	return `sha256-${digest.digest('hex')}`;
}

/** The whitelist of what reaches a browser. A key not named here cannot arrive there. */
export function projectionOf(
	deployment: DeploymentV1 | DeploymentV2,
	instances: readonly InstanceEffect[],
	workspace: DeploymentWorkspaceV2 = DEFAULT_WORKSPACE_V2,
	findings: readonly DeploymentFinding[] = []
): ProjectionV2 {
	const apps: ProjectionAppV2[] = instances.map((effect) => {
		const { id, entry, mounted, prefix, transport } = effect;
		return {
			instance: id,
			app: entry.app,
			package: `apps/${id}/`,
			...(entry.order !== undefined ? { order: entry.order } : {}),
			...(entry.title !== undefined ? { title: entry.title } : {}),
			...(entry.config !== undefined ? { config: entry.config } : {}),
			...(mounted && prefix !== undefined ? { prefix } : {}),
			...(entry.audience !== undefined ? { audience: entry.audience } : {}),
			...(mounted && transport !== undefined ? { transport } : {}),
			...(mounted && transport === 'http' ? { route: `mounts/${id}/mcp` } : {}),
			...(entry.projects !== undefined ? { projects: entry.projects } : {}),
			...(entry.space !== undefined ? { space: entry.space } : {}),
			...(entry.expose !== undefined ? { expose: entry.expose } : {}),
			...(entry.commands !== undefined ? { commands: entry.commands } : {}),
			boot: bootRecordOf(effect, findings),
		};
	});
	return {
		deployment_version: 2,
		generation: generationOf(workspace, apps),
		workspace: { id: workspace.id, name: workspace.name },
		sandbox_origin: deployment.sandbox?.origin ?? null,
		apps,
	};
}

/** A projection the schema refuses stops the write: nothing with an unknown key is ever served. */
export function checkedProjection(
	candidate: unknown
): { ok: true; projection: ProjectionV2 } | { ok: false; refusals: DeploymentFinding[] } {
	const read = readProjection(candidate);
	return read.ok
		? { ok: true, projection: read.projection }
		: {
				ok: false,
				refusals: read.refusals.map((refusal) => ({ ...refusal, code: 'DEPLOYMENT_INVALID' })),
			};
}

/**
 * `index.html`'s `src` and `href` from `./assets/` to `<base_path>assets/` (phase 2 specification, 4.2 and
 * 6.2), so a deep link such as `/acme/p/atlas/hello` loads the same files: `<base>` cannot do it under
 * `base-uri 'none'`. `basePath` has passed the deployment's pattern, both slashes and no dot segment.
 */
export function withBasePath(html: string, basePath: string): string {
	return html.replace(
		/(\s(?:src|href)=["'])\.\/assets\//g,
		(_all, lead: string) => `${lead}${basePath}assets/`
	);
}

/** `frame-src` becomes the sandbox origin or `'none'`, and nothing else in the CSP changes. */
export function withFrameSrc(html: string, frameSrc: string): string | undefined {
	const meta = /<meta\b(?=[^>]*http-equiv=["']Content-Security-Policy["'])[^>]*>/i.exec(html);
	const content = meta && /\bcontent="([^"]*)"/.exec(meta[0]);
	if (!meta || !content) return undefined;
	const policy = content[1] as string;
	const directive = `frame-src ${frameSrc}`;
	const next = /(^|;\s*)frame-src\b[^;]*/.test(policy)
		? policy.replace(/(^|;\s*)frame-src\b[^;]*/, (_all, lead: string) => `${lead}${directive}`)
		: /;\s*object-src\b/.test(policy)
			? policy.replace(/;\s*object-src\b/, (found) => `; ${directive}${found}`)
			: `${policy}; ${directive}`;
	const tag = meta[0].replace(content[0], () => `content="${next}"`);
	return `${html.slice(0, meta.index)}${tag}${html.slice(meta.index + meta[0].length)}`;
}

/**
 * A different `workspace.id` from the one `--out` last held (4.2): a browser's records are under the
 * old one. A warning, since the deployer may mean it.
 */
async function workspaceChange(out: string, id: string): Promise<DeploymentFinding | undefined> {
	let previous: unknown;
	try {
		previous = JSON.parse(await readFile(join(out, 'deployment.json'), 'utf8'));
	} catch {
		return undefined;
	}
	const before = (previous as { workspace?: { id?: unknown } } | null)?.workspace?.id;
	if (typeof before !== 'string' || before === id) return undefined;
	return {
		code: 'DEPLOYMENT_WORKSPACE_CHANGED',
		key: 'workspace.id',
		message: `The workspace was \`${before}\` and is now \`${id}\`: what a browser holds under \`${before}\` is stranded there.`,
		suggestion: `Keep \`workspace.id = "${before}"\` unless you mean to start a new workspace.`,
	};
}

function pathRefusal(key: string, message: string, suggestion: string): DeploymentFinding {
	return { code: 'DEPLOYMENT_PATH_INVALID', key, message, suggestion };
}

/** Refuses paths that would destroy or serve what they must not, before anything is touched. */
async function pathRefusals(
	options: WriteDeploymentOptions,
	dist: string,
	out: string,
	deployment: DeploymentV1 | DeploymentV2,
	instances: readonly InstanceEffect[]
): Promise<DeploymentFinding[]> {
	const found: DeploymentFinding[] = [];
	if (!existsSync(join(dist, 'index.html'))) {
		found.push(
			pathRefusal('--dist', '`--dist` holds no `index.html`.', "Run the web host's `vite build`.")
		);
	}
	const secrets = await secretPaths(options.config, deployment);
	const packages = await Promise.all(instances.map(({ directory }) => realish(directory)));
	if (secrets.some((secret) => isWithin(secret, dist))) {
		found.push(
			pathRefusal(
				'--dist',
				'`--dist` holds the deployment file or a credential, and it is served whole.',
				'Keep them outside it.'
			)
		);
	}
	if (
		[...secrets, dist, ...packages].some((path) => isWithin(path, out)) ||
		[dist, ...packages].some((path) => isWithin(out, path))
	) {
		found.push(
			pathRefusal(
				'--out',
				'`--out` overlaps `--dist`, the deployment file, a credential or a package.',
				'Write to a directory of its own.'
			)
		);
	}
	if (!(await replaceable(out))) {
		found.push(
			pathRefusal(
				'--out',
				'`--out` holds files `loam deployment write` did not write.',
				'Choose an empty directory; an earlier deployment there is replaced.'
			)
		);
	}
	if (options.mountsOut) {
		// A link there is replaced at its own path, so both where it points and where it is must be safe.
		const direct = resolve(options.mountsOut);
		const places = [await realish(direct), join(await realish(dirname(direct)), basename(direct))];
		const served = [out, dist, ...packages];
		if (
			places.some(
				(place) => secrets.includes(place) || served.some((directory) => isWithin(place, directory))
			)
		) {
			found.push(
				pathRefusal(
					'--mounts-out',
					'`--mounts-out` is inside what is served, or would replace the deployment file or a credential.',
					'Write it outside `--out`, `--dist` and every package: it holds credentials.'
				)
			);
		}
	}
	return found;
}

/** What will be copied, listed first, so a problem found here costs nothing. A link leaving is skipped. */
async function planCopy(
	from: string,
	key: string
): Promise<{ copies: Array<{ source: string; path: string }>; skipped: DeploymentFinding[] }> {
	const root = await realish(from);
	const skipped: DeploymentFinding[] = [];
	const copies = await listCopy(root, {
		root,
		onEscape() {
			skipped.push({
				code: 'APP_PACKAGE_LINK_SKIPPED',
				key,
				message: 'A symbolic link here leaves it, leads to nothing or loops, and was not copied.',
				suggestion: 'Remove the link; `loam app pack` refuses one.',
			});
		},
	});
	return { copies, skipped };
}

export async function writeDeployment(
	options: WriteDeploymentOptions
): Promise<WriteDeploymentResult> {
	const analysis = await analyzeDeployment(options.config);
	const warnings = [...analysis.instanceRefusals, ...analysis.warnings];
	const stop = (refusals: DeploymentFinding[]): WriteDeploymentResult => ({
		ok: false,
		refusals,
		warnings,
	});
	if (analysis.refusals.length > 0 || !analysis.deployment) return stop(analysis.refusals);
	const dist = await realish(options.dist);
	const out = await realish(options.out);
	const paths = await pathRefusals(options, dist, out, analysis.deployment, analysis.instances);
	if (paths.length > 0) return stop(paths);
	const checked = checkedProjection(
		projectionOf(
			analysis.deployment,
			analysis.instances,
			analysis.workspace,
			analysis.instanceRefusals
		)
	);
	if (!checked.ok) return stop(checked.refusals);
	const { projection } = checked;
	const changed = await workspaceChange(out, projection.workspace.id);
	if (changed) warnings.push(changed);
	const anyView = analysis.instances.some(({ rawKind }) => rawKind === 'view');
	const frameSrc = anyView && projection.sandbox_origin ? projection.sandbox_origin : "'none'";
	const framed = withFrameSrc(await readFile(join(dist, 'index.html'), 'utf8'), frameSrc);
	if (framed === undefined) {
		return stop([
			pathRefusal(
				'--dist',
				"`--dist`'s `index.html` has no Content-Security-Policy to set `frame-src` in.",
				"Run the web host's `vite build`."
			),
		]);
	}

	const page = withBasePath(framed, analysis.basePath ?? '/');

	const host = await planCopy(dist, '--dist');
	const packages = await Promise.all(
		analysis.instances
			.filter(({ packaged }) => packaged)
			.map(async ({ id, directory }) => ({
				id,
				...(await planCopy(directory, appKey(id, '/package'))),
			}))
	);
	warnings.push(...host.skipped, ...packages.flatMap(({ skipped }) => skipped));

	await rm(out, { recursive: true, force: true });
	await mkdir(out, { recursive: true });
	await copyListed(host.copies, out);
	for (const { id, copies } of packages) await copyListed(copies, join(out, 'apps', id));
	await writeFile(join(out, 'deployment.json'), `${JSON.stringify(projection, null, '\t')}\n`);
	await writeFile(join(out, 'index.html'), page);
	// For a static host that answers a missing path with `404.html` and nothing else (6.2).
	await writeFile(join(out, '404.html'), page);
	await writeFile(join(out, OUTPUT_MARKER), 'Written by loam deployment write.\n');
	if (options.mountsOut) {
		await mkdir(dirname(resolve(options.mountsOut)), { recursive: true });
		// Removed first, since a mode applies only when a file is created.
		await rm(options.mountsOut, { force: true });
		await writeFile(
			options.mountsOut,
			`${JSON.stringify({ mounts: analysis.mounts }, null, '\t')}\n`,
			{
				mode: 0o600,
				flag: 'wx',
			}
		);
	}
	return {
		ok: true,
		out,
		projection,
		mounts: analysis.mounts,
		warnings,
		notices: analysis.notices,
	};
}
