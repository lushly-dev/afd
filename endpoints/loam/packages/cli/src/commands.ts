/**
 * @fileoverview Each subcommand of the `loam` bin as a command (phase 1 specification, section 11). A
 * `CommandResult` is what a person and an agent both read. Mounted URLs and tokens never reach one.
 */

import { type CommandResult, defineCommand, failure, success } from '@lushly-dev/afd-server/define';
import { isExperimentDate } from '@lushly-dev/loam-manifest';
import { z } from 'zod';
import { appCheck } from './app-check.js';
import { appNew } from './app-new.js';
import { appPack } from './app-pack.js';
import type { AppCheckReport } from './check.js';
import { type CopilotKeySetDeps, copilotKeySet, systemKeySetDeps } from './copilot-key.js';
import { analyzeDeployment, type DeploymentFinding, writeDeployment } from './deployment.js';
import { type PluginCheckReport, pluginCheck } from './plugin-check.js';
import { pluginPack } from './plugin-pack.js';

/** A CLI command is on no shell surface: there is no shell here to expose it to. */
const EXPOSE = { cli: true, palette: false, agent: false, mcp: false };

/** One failure from every refusal found: the first names the code, and `details` holds them all. */
function refused(
	refusals: readonly DeploymentFinding[],
	details: Record<string, unknown>
): CommandResult<never> {
	const first = refusals[0] as DeploymentFinding;
	return failure({
		code: first.code,
		message:
			refusals.length === 1
				? first.message
				: `${refusals.length} refusals. The first, at ${first.key}: ${first.message}`,
		suggestion: first.suggestion,
		details: { refusals, ...details },
	});
}

function reportDetails({ kind, warnings, exposure, trust }: AppCheckReport) {
	return { ...(kind ? { kind } : {}), warnings, exposure, ...(trust ? { trust } : {}) };
}

export const appNewCommand = defineCommand({
	name: 'app-new',
	title: 'Create an app',
	description: 'Write a new app of one kind, with no UI so the console is its first, and check it.',
	input: z.object({
		id: z.string(),
		kind: z.enum(['native', 'view', 'mounted']),
		dir: z.string().optional(),
		depSpec: z.string().optional(),
	}),
	mutation: true,
	expose: EXPOSE,
	async handler(input) {
		const { report, dir, files } = await appNew(input);
		if (!report.ok || !dir) return refused(report.refusals, reportDetails(report));
		return success(
			{ dir, files, ...reportDetails(report) },
			{ reasoning: `Wrote ${files.length} files and checked them.` }
		);
	},
});

export const appCheckCommand = defineCommand({
	name: 'app-check',
	title: 'Check an app',
	description: "Check an app's manifest, files and source, running none of its code.",
	input: z.object({
		dir: z.string().optional(),
		manifest: z.string().optional(),
		date: z
			.string()
			.refine(isExperimentDate, { message: 'must be a real calendar date YYYY-MM-DD' })
			.optional(),
	}),
	mutation: false,
	expose: EXPOSE,
	async handler(input) {
		const report = await appCheck(input);
		if (!report.ok) return refused(report.refusals, reportDetails(report));
		return success(reportDetails(report), {
			reasoning: `No refusal, and ${report.warnings.length} warnings.`,
		});
	},
});

export const appPackCommand = defineCommand({
	name: 'app-pack',
	title: 'Pack an app',
	description: 'Check an app, then write the package a deployment lists, its schemas inlined.',
	input: z.object({
		dir: z.string().optional(),
		manifest: z.string().optional(),
		out: z.string(),
	}),
	mutation: true,
	expose: EXPOSE,
	async handler(input) {
		const { report, out, files } = await appPack(input);
		if (!report.ok || !out) return refused(report.refusals, reportDetails(report));
		return success(
			{ out, files, ...reportDetails(report) },
			{ reasoning: `Packed ${files.length} files.` }
		);
	},
});

export const deploymentCheckCommand = defineCommand({
	name: 'deployment-check',
	title: 'Check a deployment',
	description: 'Validate a deployment file and its packages, writing nothing.',
	input: z.object({ file: z.string() }),
	mutation: false,
	expose: EXPOSE,
	async handler({ file }) {
		const { refusals, instanceRefusals, warnings, notices, instances } = await analyzeDeployment(
			file,
			{ desktop: {} }
		);
		const all = [...refusals, ...instanceRefusals];
		if (all.length > 0) return refused(all, { warnings, notices });
		return success(
			{
				instances: instances.map(({ id, entry, mounted, prefix, transport }) => ({
					instance: id,
					app: entry.app,
					mounted,
					...(prefix ? { prefix } : {}),
					...(transport ? { transport } : {}),
				})),
				warnings,
				notices,
			},
			{ reasoning: `${instances.length} instances would load.` }
		);
	},
});

export const deploymentWriteCommand = defineCommand({
	name: 'deployment-write',
	title: 'Write a deployment',
	description: 'Write the served directory and its browser projection from a deployment file.',
	input: z.object({
		config: z.string(),
		dist: z.string(),
		out: z.string(),
		mountsOut: z.string().optional(),
		/** A desktop copilot's providers, for the Rust host (phase 5 specification, 4.2). */
		modelsOut: z.string().optional(),
		/** The host that serves it (phase 6 specification, 3.3): set when the file names none. */
		host: z.enum(['static', 'hosted', 'desktop']).optional(),
	}),
	mutation: true,
	expose: EXPOSE,
	async handler(input) {
		const { host, ...rest } = input;
		const written = await writeDeployment({ ...rest, ...(host === undefined ? {} : { host }) });
		if (!written.ok) return refused(written.refusals, { warnings: written.warnings });
		// `mounts` holds locations and tokens: only the file `--mounts-out` names may hold them.
		return success(
			{
				out: written.out,
				instances: written.projection.apps.map((app) => app.instance),
				warnings: written.warnings,
				notices: written.notices,
			},
			{ reasoning: `Wrote ${written.projection.apps.length} instances.` }
		);
	},
});

/** What a plugin check reports beside its refusals: nothing secret, since a manifest holds no secret (D166). */
function pluginDetails({ form, manifest, engines, bundleSha256, files }: PluginCheckReport) {
	return {
		...(form ? { form } : {}),
		...(manifest
			? {
					plugin: { id: manifest.plugin.id, version: manifest.plugin.version },
					apps: manifest.apps.map((app) => app.id),
				}
			: {}),
		...(engines ? { engines } : {}),
		...(files ? { files: files.length } : {}),
		...(bundleSha256 ? { bundleSha256 } : {}),
	};
}

export const pluginCheckCommand = defineCommand({
	name: 'plugin-check',
	title: 'Check a plugin',
	description:
		"Check a plugin's source or packed bundle: its manifest, its packed apps, its engines' SHA-256s and its bounds, running none of its code.",
	input: z.object({ dir: z.string().optional() }),
	mutation: false,
	expose: EXPOSE,
	async handler(input) {
		const report = await pluginCheck(input);
		if (!report.ok) return refused(report.refusals, pluginDetails(report));
		return success(pluginDetails(report), {
			reasoning: `No refusal; the bundle's digest is ${report.bundleSha256}.`,
		});
	},
});

export const pluginPackCommand = defineCommand({
	name: 'plugin-pack',
	title: 'Pack a plugin',
	description:
		"Check a plugin's source, then write the directory bundle the desktop installs: its manifest, packed apps and engines.",
	input: z.object({ dir: z.string().optional(), out: z.string() }),
	mutation: true,
	expose: EXPOSE,
	async handler(input) {
		const { report, out, files, bundleSha256 } = await pluginPack(input);
		if (!out) return refused(report.refusals, pluginDetails(report));
		return success(
			{ out, ...pluginDetails(report), files, ...(bundleSha256 ? { bundleSha256 } : {}) },
			{ reasoning: `Packed ${files.length} files; the bundle's digest is ${bundleSha256}.` }
		);
	},
});

/**
 * `loam copilot key set <provider>` (phase 5 specification, 4.2): the development path for a model's key, at a
 * terminal. The key is read without echo and never appears in the result.
 */
export function createCopilotKeySetCommand(deps: () => CopilotKeySetDeps = systemKeySetDeps) {
	return defineCommand({
		name: 'copilot-key-set',
		title: 'Set a copilot provider’s key',
		description:
			"Read a model provider's key without echo, store it in the OS keychain where the deployment names it, and check it.",
		input: z.object({
			provider: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
			config: z.string().default('loam.deployment.toml'),
		}),
		mutation: true,
		expose: EXPOSE,
		async handler(input) {
			const result = await copilotKeySet(input, deps());
			if (!result.ok)
				return failure({
					code: result.code,
					message: result.message,
					suggestion: result.suggestion,
				});
			return success(
				{
					provider: result.provider,
					keychain: { service: result.service, account: result.account },
					checked: result.checked,
					...(result.answered === undefined ? {} : { answered: result.answered }),
				},
				{
					reasoning: result.checked
						? 'Stored the key, and the provider accepted it.'
						: result.answered === undefined
							? 'Stored the key; the provider could not be reached to check it.'
							: `Stored the key; the provider answered ${result.answered}, so it was not checked.`,
				}
			);
		},
	});
}

export const copilotKeySetCommand = createCopilotKeySetCommand();

export type { AppCheckReport };
