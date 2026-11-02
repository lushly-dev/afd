/**
 * @fileoverview `@lushly-dev/loam-cli/deployment`: `writeDeployment` (phase 1 specification, 3.2). Only
 * what makes the file unreadable stops a write; a bad package stays in the projection, so the kernel
 * refuses it at load and the rail shows it (D66). Nothing of a location, a credential or a command
 * line reaches the projection.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { DeploymentV1, ProjectionV1 } from '@lushly-dev/loam-manifest';
import { readProjection } from '@lushly-dev/loam-manifest/validate';
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
			projection: ProjectionV1;
			/** In memory: what the caller's relay needs. */
			mounts: MountAccess[];
			/** Each instance the kernel will refuse, and the packages' warnings. */
			warnings: DeploymentFinding[];
			notices: DeploymentNotice[];
	  }
	| { ok: false; refusals: DeploymentFinding[]; warnings: DeploymentFinding[] };

/** The whitelist of what reaches a browser. A key not named here cannot arrive there. */
export function projectionOf(
	deployment: DeploymentV1,
	instances: readonly InstanceEffect[]
): ProjectionV1 {
	return {
		deployment_version: 1,
		sandbox_origin: deployment.sandbox?.origin ?? null,
		apps: instances.map(({ id, entry, mounted, prefix, transport }) => ({
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
		})),
	};
}

/** A projection the schema refuses stops the write: nothing with an unknown key is ever served. */
export function checkedProjection(
	candidate: unknown
): { ok: true; projection: ProjectionV1 } | { ok: false; refusals: DeploymentFinding[] } {
	const read = readProjection(candidate);
	return read.ok
		? { ok: true, projection: read.projection }
		: {
				ok: false,
				refusals: read.refusals.map((refusal) => ({ ...refusal, code: 'DEPLOYMENT_INVALID' })),
			};
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

function pathRefusal(key: string, message: string, suggestion: string): DeploymentFinding {
	return { code: 'DEPLOYMENT_PATH_INVALID', key, message, suggestion };
}

/** Refuses paths that would destroy or serve what they must not, before anything is touched. */
async function pathRefusals(
	options: WriteDeploymentOptions,
	dist: string,
	out: string,
	deployment: DeploymentV1,
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
	const checked = checkedProjection(projectionOf(analysis.deployment, analysis.instances));
	if (!checked.ok) return stop(checked.refusals);
	const { projection } = checked;
	const anyView = analysis.instances.some(({ rawKind }) => rawKind === 'view');
	const frameSrc = anyView && projection.sandbox_origin ? projection.sandbox_origin : "'none'";
	const page = withFrameSrc(await readFile(join(dist, 'index.html'), 'utf8'), frameSrc);
	if (page === undefined) {
		return stop([
			pathRefusal(
				'--dist',
				"`--dist`'s `index.html` has no Content-Security-Policy to set `frame-src` in.",
				"Run the web host's `vite build`."
			),
		]);
	}

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
