/**
 * @fileoverview The `loam-host` bin's subcommands as commands (phase 6 specification, 3.8). Each prints a
 * `CommandResult`; no secret's value, and no file's contents, ever reach one.
 */

import { type CommandResult, defineCommand, failure, success } from '@lushly-dev/afd-server/define';
import { z } from 'zod';
import { runBootstrap } from './bootstrap.js';
import { checkHost } from './check.js';
import { loadServerConfig } from './config.js';
import { type DevProfile, runDev } from './dev.js';
import { doctorReport } from './doctor.js';
import { HostError, type HostFinding } from './errors.js';
import { createLoamHost, type LoamHost } from './host.js';
import { HOST_INTERNALS } from './internal.js';

/** A CLI command is on no shell surface. */
const EXPOSE = { cli: true, palette: false, agent: false, mcp: false };

function refused(
	refusals: readonly HostFinding[],
	details: Record<string, unknown>
): CommandResult<never> {
	const first = refusals[0] as HostFinding;
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

export const hostCheckCommand = defineCommand({
	name: 'host-check',
	title: 'Check a hosted deployment',
	description:
		'Report every refusal and warning of the server configuration, the deployment and the build, without starting.',
	input: z.object({ server: z.string(), deployment: z.string(), dist: z.string() }),
	mutation: false,
	expose: EXPOSE,
	async handler({ server: file, deployment, dist }) {
		const loaded = await loadServerConfig(file);
		if (!loaded.ok) return refused(loaded.refusals, { warnings: loaded.warnings });
		const { refusals, warnings } = await checkHost({
			server: loaded.server,
			deployment,
			dist,
			purpose: 'start',
		});
		if (refusals.length > 0) return refused(refusals, { warnings });
		return success(
			{ origin: loaded.server.origin, warnings },
			{ reasoning: `It would start, with ${warnings.length} warnings.` }
		);
	},
});

export const hostDoctorCommand = defineCommand({
	name: 'host-doctor',
	title: 'Diagnose a hosted deployment',
	description:
		"Run the check, then report the lock's holder and the data directory's files, opening nothing for writing and never taking the lock.",
	input: z.object({ server: z.string(), deployment: z.string() }),
	mutation: false,
	expose: EXPOSE,
	async handler({ server: file, deployment }) {
		const loaded = await loadServerConfig(file);
		if (!loaded.ok) return refused(loaded.refusals, { warnings: loaded.warnings });
		const { refusals, ...report } = await doctorReport({ server: loaded.server, deployment });
		if (refusals.length > 0) return refused(refusals, report);
		return success(report, {
			reasoning: report.lock
				? `Process ${report.lock.pid} on ${report.lock.host} holds the data directory, as \`.lock\` reports.`
				: 'No process holds the data directory, as far as `.lock` reports.',
		});
	},
});

/** The host `dev` or `start` started, which the bin closes on `SIGINT` or `SIGTERM`. */
let started: { host: LoamHost } | undefined;

/** Takes the host the last `dev` or `start` started, so whoever runs the bin can stop it. */
export function takeStartedDev(): { host: LoamHost } | undefined {
	const profile = started;
	started = undefined;
	return profile;
}

export const hostDevCommand = defineCommand({
	name: 'host-dev',
	title: 'Start the development profile',
	description:
		'Serve a hosted deployment on https://localhost with a generated certificate, secret and mail sink, keeping its ports in dev.json.',
	input: z.object({
		deployment: z.string(),
		data: z.string().optional(),
		port: z
			.string()
			.regex(/^\d{1,5}$/, 'a port from 0 to 65535')
			.transform(Number)
			.refine((port) => port <= 65_535, 'a port from 0 to 65535')
			.optional(),
		dist: z.string().optional(),
	}),
	mutation: true,
	expose: EXPOSE,
	async handler({ deployment, data, port, dist }) {
		let profile: DevProfile;
		try {
			profile = await runDev({
				deployment,
				...(data !== undefined ? { data } : {}),
				...(port !== undefined ? { port } : {}),
				...(dist !== undefined ? { dist } : {}),
			});
		} catch (cause) {
			if (cause instanceof HostError) return refused(cause.refusals, {});
			throw cause;
		}
		started = profile;
		return success(
			{
				origin: profile.origin,
				sandboxOrigin: profile.sandboxOrigin,
				spki: profile.spki,
				mail: profile.mail,
			},
			{ reasoning: `Serving ${profile.origin} until it is stopped.` }
		);
	},
});

export const hostStartCommand = defineCommand({
	name: 'host-start',
	title: 'Start the hosted server',
	description:
		'Check, take the lock, write the site and serve a hosted provider deployment until stopped; refuses a local deployment and an organization never bootstrapped.',
	input: z.object({ server: z.string(), deployment: z.string(), dist: z.string() }),
	mutation: true,
	expose: EXPOSE,
	async handler({ server: file, deployment, dist }) {
		const loaded = await loadServerConfig(file);
		if (!loaded.ok) return refused(loaded.refusals, { warnings: loaded.warnings });
		let host: LoamHost;
		try {
			host = await createLoamHost({
				server: loaded.server,
				deployment,
				dist,
				[HOST_INTERNALS]: { start: true },
			});
			await host.listen().catch(async (cause: unknown) => {
				await host.close();
				throw cause;
			});
		} catch (cause) {
			if (cause instanceof HostError) return refused(cause.refusals, {});
			throw cause;
		}
		started = { host };
		return success(
			{ origin: host.origin, sandboxOrigin: host.sandboxOrigin },
			{ reasoning: `Serving ${host.origin} until it is stopped.` }
		);
	},
});

const BOOTSTRAP_INPUT = {
	deployment: z.string(),
	slug: z.string(),
	name: z.string(),
	ownerEmail: z.string(),
};

export const hostBootstrapCommand = defineCommand({
	name: 'host-bootstrap',
	title: "Bootstrap the deployment's organization",
	description:
		"Create the deployment's organization, pin its binding and send its first owner a join link, with no server running; again while it has no member, send a new link.",
	input: z.union([
		// One form or the other: `--server` with `--dev` or `--data` is a usage error, never one of them silently.
		z.strictObject({ ...BOOTSTRAP_INPUT, server: z.string() }),
		z.strictObject({ ...BOOTSTRAP_INPUT, dev: z.literal(true), data: z.string().optional() }),
	]),
	mutation: true,
	expose: EXPOSE,
	async handler(input) {
		try {
			let report: Awaited<ReturnType<typeof runBootstrap>>;
			if ('server' in input && input.server !== undefined) {
				const loaded = await loadServerConfig(input.server);
				if (!loaded.ok) return refused(loaded.refusals, { warnings: loaded.warnings });
				report = await runBootstrap({ ...input, form: 'server', server: loaded.server });
			} else {
				const data = 'data' in input ? input.data : undefined;
				report = await runBootstrap({
					deployment: input.deployment,
					slug: input.slug,
					name: input.name,
					ownerEmail: input.ownerEmail,
					form: 'dev',
					...(data !== undefined ? { data } : {}),
				});
			}
			return success(report, {
				reasoning: report.reissued
					? `Sent ${report.invited} a new link; the earlier one no longer works.`
					: `Created ${report.organization.slug} and sent ${report.invited} the first owner's link.`,
			});
		} catch (cause) {
			if (cause instanceof HostError) return refused(cause.refusals, {});
			throw cause;
		}
	},
});
