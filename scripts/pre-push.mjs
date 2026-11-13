#!/usr/bin/env node
/**
 * The pre-push hook: accept a current `pnpm verify` record for the pushed commit, or run the
 * `pre-push-checks` lefthook group in full (scripts/verify-record.mjs says when a record counts).
 * Git passes the refs being pushed on stdin; lefthook forwards them (`use_stdin`).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execTool } from './release/exec-tool.mjs';
import { acceptRecord, currentIdentity, readRecord, recordPath } from './verify-record.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The decision, without running anything: `{ accepted, reason }`. */
export function decide({ updates, git, read = readRecord, now = Date.now() }) {
	try {
		const identity = currentIdentity(git);
		return acceptRecord({ record: read(recordPath(git, root)), identity, updates, now });
	} catch (error) {
		return { accepted: false, reason: `the verify record could not be read: ${error.message}` };
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
	let updates = '';
	try {
		updates = readFileSync(0, 'utf8');
	} catch {}
	const { accepted, reason } = decide({ updates, git });
	if (accepted) {
		console.log(`pre-push: ${reason}; its checks cover this push`);
	} else {
		console.log(`pre-push: running the checks (${reason})`);
		try {
			execTool(join(root, 'node_modules/.bin/lefthook'), ['run', 'pre-push-checks'], {
				cwd: root,
				stdio: 'inherit',
			});
		} catch (error) {
			process.exitCode = error.status || 1;
		}
	}
}
