#!/usr/bin/env node
/**
 * The CLI AFD's scenario runner calls for Botcore's gate outcome jobs: `call <command> [<json>]
 * --format json` is handed unchanged to the harness, as an argument list (no shell).
 * GATE_OUTCOME_PYTHON names the interpreter that has Botcore installed (default: python) and
 * GATE_OUTCOME_HARNESS the harness script.
 */
import { spawnSync } from 'node:child_process';

const python = process.env.GATE_OUTCOME_PYTHON || 'python';
const harness = process.env.GATE_OUTCOME_HARNESS;
if (!harness) {
	process.stderr.write('GATE_OUTCOME_HARNESS is not set\n');
	process.exit(2);
}
const child = spawnSync(python, [harness, ...process.argv.slice(2)], {
	stdio: 'inherit',
	windowsHide: true,
});
if (child.error) {
	process.stderr.write(`Cannot start ${python}: ${child.error.message}\n`);
	process.exit(2);
}
process.exit(child.status ?? 1);
