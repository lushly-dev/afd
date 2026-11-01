#!/usr/bin/env node
/** Credential-free fixture checks. This command never constitutes hosted-provider evidence. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (Number(process.versions.node.split('.')[0]) < 24) {
	console.error('Local hosted-fixture checks require Node 24 or newer (node:sqlite).');
	process.exit(1);
}

const steps = [
	[
		'Render deployment control contracts (no provider requests)',
		'.',
		['--test', 'scripts/hosted/render-control.test.mjs'],
	],
	[
		'Better Auth fixture typecheck',
		'packages/auth',
		['node_modules/typescript/bin/tsc', '-p', 'hosted/better-auth/tsconfig.json'],
	],
	[
		'Better Auth runner contracts',
		'packages/auth',
		['--test', 'hosted/better-auth/contract.test.mjs'],
	],
	[
		'Better Auth HTTPS/OAuth local fixture',
		'packages/auth',
		['hosted/better-auth/run.mjs', '--local'],
	],
	[
		'Better Auth regular-browser operator controls',
		'packages/auth',
		['--test', 'hosted/better-auth/operator.test.mjs'],
	],
	['Convex fixture build and runner contracts', 'packages/auth', ['hosted/convex/check.mjs']],
	[
		'Durable REST runner contracts and lifecycle',
		'packages/local-db',
		['--test', 'hosted/harness.test.mjs'],
	],
	[
		'Direct registry, journal and WebCrypto approvals in Chromium',
		'packages/server',
		['--test', 'browser/direct.chromium.test.mjs'],
	],
];

for (const [name, directory, args] of steps) {
	console.log(`\n${name}`);
	const cwd = fileURLToPath(new URL(`../${directory}/`, import.meta.url));
	await new Promise((resolve, reject) => {
		const grouped = process.platform !== 'win32';
		const child = spawn(process.execPath, args, {
			cwd,
			stdio: 'inherit',
			detached: grouped,
		});
		let escalation;
		let interrupted = false;
		const signalTree = (signal) => {
			try {
				if (grouped && child.pid) process.kill(-child.pid, signal);
				else child.kill(signal);
			} catch (error) {
				if (error.code !== 'ESRCH') reject(error);
			}
		};
		const stop = () => {
			interrupted = true;
			// Let the runner clean its live provider before terminating descendants.
			child.kill('SIGTERM');
			// Chromium startup can take 15 s; allow its bound plus provider cleanup.
			escalation ??= setTimeout(() => signalTree('SIGKILL'), 25_000);
		};
		const deadline = setTimeout(stop, 180_000);
		process.once('SIGINT', stop);
		process.once('SIGTERM', stop);
		const dispose = () => {
			clearTimeout(deadline);
			clearTimeout(escalation);
			process.off('SIGINT', stop);
			process.off('SIGTERM', stop);
			// Reap descendants even if a runner exits before its fixture process.
			signalTree('SIGKILL');
		};
		child.once('error', (error) => {
			dispose();
			reject(error);
		});
		child.once('exit', (code, signal) => {
			dispose();
			if (code === 0 && !interrupted) resolve();
			else reject(new Error(`${name} failed (${signal ?? code}).`));
		});
	});
}

console.log('\nLocal fixture checks passed. External hosted/provider checks: NOT RUN.');
