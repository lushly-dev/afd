#!/usr/bin/env node
/**
 * Runs Mail engine JTBD scenario files against a real `loam-mail serve` backed
 * by `loam-mail test-world --seed mail-f-base` (plugin.spec.md, sections 12.4
 * and 18).
 *
 * Usage:
 *   node endpoints/loam/plugins/mail/scripts/run-scenarios.mjs [--bin <path>] <scenario...>
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const TARGET_DIR = process.env.CARGO_TARGET_DIR
	? resolve(process.env.CARGO_TARGET_DIR)
	: join(ROOT, 'endpoints/loam/plugins/mail/engine/target');
const DEFAULT_BIN = join(TARGET_DIR, 'debug/loam-mail');
const DEFAULT_SCENARIO = join(
	ROOT,
	'endpoints/loam/plugins/mail/docs/scenarios/approve-what-was-proposed.scenario.yaml'
);
const AFD_CLI = join(ROOT, 'packages/cli/dist/bin.js');

function parseArgs(argv) {
	let bin = DEFAULT_BIN;
	const scenarios = [];
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--bin') {
			const next = argv[i + 1];
			if (!next) throw new Error('--bin requires a path');
			bin = resolve(next);
			i++;
		} else {
			scenarios.push(resolve(argv[i]));
		}
	}
	if (scenarios.length === 0) scenarios.push(DEFAULT_SCENARIO);
	return { bin, scenarios };
}

function waitForLine(child, stream, matcher, label, timeoutMs = 30_000, mirror = null) {
	return new Promise((resolvePromise, rejectPromise) => {
		let pending = '';
		let transcript = '';
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			stream.off('data', onData);
			rejectPromise(
				new Error(`${label} timed out after ${timeoutMs}ms. Output so far:\n${transcript}`)
			);
		}, timeoutMs);

		const finish = (fn, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			stream.off('data', onData);
			if (mirror) {
				stream.on('data', (chunk) => mirror.write(chunk));
			} else {
				stream.resume();
			}
			fn(value);
		};

		const onData = (chunk) => {
			const text = chunk.toString('utf8');
			if (mirror) mirror.write(chunk);
			transcript += text;
			pending += text;
			const lines = pending.split(/\r?\n/);
			pending = lines.pop() ?? '';
			for (const line of lines) {
				let matched = null;
				try {
					matched = matcher(line);
				} catch (error) {
					finish(rejectPromise, error);
					return;
				}
				if (matched !== null) {
					finish(resolvePromise, matched);
					return;
				}
			}
		};

		stream.on('data', onData);

		child.once('exit', (code, signal) => {
			finish(
				rejectPromise,
				new Error(`${label} exited early (code=${code}, signal=${signal}). Output:\n${transcript}`)
			);
		});

		child.once('error', (error) => {
			finish(rejectPromise, error);
		});
	});
}

function stopChild(child) {
	return new Promise((resolvePromise) => {
		if (!child || child.exitCode !== null || child.signalCode !== null) {
			resolvePromise();
			return;
		}
		const killer = setTimeout(() => {
			try {
				child.kill('SIGKILL');
			} catch {
				// already exited
			}
		}, 5_000);
		child.once('exit', () => {
			clearTimeout(killer);
			resolvePromise();
		});
		try {
			child.kill('SIGTERM');
		} catch {
			clearTimeout(killer);
			resolvePromise();
		}
	});
}

function runAfdScenario(scenarioPath, serverUrl, token) {
	return new Promise((resolvePromise, rejectPromise) => {
		let stdout = '';
		const child = spawn(
			process.execPath,
			[AFD_CLI, 'scenario', 'run', scenarioPath, '--server', serverUrl, '--no-color'],
			{
				cwd: ROOT,
				stdio: ['ignore', 'pipe', 'inherit'],
				env: {
					...process.env,
					AFD_HEADERS: `Authorization: Bearer ${token}`,
				},
			}
		);
		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString('utf8');
			process.stdout.write(chunk);
		});
		child.once('error', rejectPromise);
		child.once('exit', (code, signal) => {
			if (code !== 0) {
				rejectPromise(
					new Error(`scenario ${scenarioPath} failed (code=${code}, signal=${signal})`)
				);
			} else if (!stdout.trim()) {
				rejectPromise(new Error(`scenario ${scenarioPath} produced no output`));
			} else {
				resolvePromise();
			}
		});
	});
}

async function runOneScenario(bin, scenarioPath) {
	const scratch = mkdtempSync(join(tmpdir(), 'loam-mail-scenarios-'));
	const homeDir = join(scratch, 'home');
	const outDir = join(scratch, 'out');
	let worldProc = null;
	let serveProc = null;

	try {
		worldProc = spawn(
			bin,
			['test-world', '--seed', 'mail-f-base', '--home', homeDir, '--out', outDir],
			{
				cwd: ROOT,
				stdio: ['ignore', 'pipe', 'pipe'],
			}
		);
		worldProc.stderr.on('data', (chunk) => process.stderr.write(chunk));

		const worldOutputs = await waitForLine(
			worldProc,
			worldProc.stdout,
			(line) => {
				const trimmed = line.trim();
				if (!trimmed.startsWith('{')) return null;
				return JSON.parse(trimmed);
			},
			'loam-mail test-world'
		);

		serveProc = spawn(bin, ['serve', '--port', '0'], {
			cwd: ROOT,
			stdio: ['ignore', 'ignore', 'pipe'],
			env: {
				...process.env,
				LOAM_MAIL_HOME: worldOutputs.home,
				LOAM_MAIL_TEST_ENDPOINTS: worldOutputs.endpoints,
				LOAM_MAIL_TEST_SECRETS: worldOutputs.secrets,
			},
		});

		const serverUrl = await waitForLine(
			serveProc,
			serveProc.stderr,
			(line) => {
				const match = /serving on (http:\/\/127\.0\.0\.1:\d+\/mcp)/.exec(line);
				return match ? match[1] : null;
			},
			'loam-mail serve',
			30_000,
			process.stderr
		);

		const agentToken = readFileSync(worldOutputs.agentToken, 'utf8').trim();
		if (!agentToken) throw new Error('test-world wrote an empty agent token');

		await runAfdScenario(scenarioPath, serverUrl, agentToken);
	} finally {
		await stopChild(serveProc);
		await stopChild(worldProc);
		rmSync(scratch, { recursive: true, force: true });
	}
}

async function main() {
	const { bin, scenarios } = parseArgs(process.argv.slice(2));
	if (!existsSync(bin)) {
		throw new Error(`loam-mail binary not found at ${bin}`);
	}
	if (!existsSync(AFD_CLI)) {
		throw new Error(`AFD CLI binary not found at ${AFD_CLI}; build @lushly-dev/afd-cli first`);
	}
	for (const scenarioPath of scenarios) {
		if (!existsSync(scenarioPath)) {
			throw new Error(`scenario file not found at ${scenarioPath}`);
		}
	}
	for (const scenarioPath of scenarios) {
		await runOneScenario(bin, scenarioPath);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
