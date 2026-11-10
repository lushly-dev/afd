/**
 * @fileoverview The `loam-host` bin's subcommands as commands (phase 6 specification, 3.8). Each prints a
 * `CommandResult`; no secret's value, and no file's contents, ever reach one.
 */

import { type CommandResult, defineCommand, failure, success } from '@lushly-dev/afd-server/define';
import { z } from 'zod';
import { checkHost } from './check.js';
import { loadServerConfig } from './config.js';
import { doctorReport } from './doctor.js';
import type { HostFinding } from './errors.js';

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
