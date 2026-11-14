#!/usr/bin/env node
/**
 * The CLI AFD's scenario runner calls for the factory: `call <command> [<json>] --format json`
 * is handed unchanged to `python -m botcore_factory.harness`, as an argument list (no shell).
 * FACTORY_PYTHON names the interpreter that has botcore-factory installed (default: python).
 */
import { spawnSync } from 'node:child_process';

const python = process.env.FACTORY_PYTHON || 'python';
const child = spawnSync(python, ['-m', 'botcore_factory.harness', ...process.argv.slice(2)], {
	stdio: 'inherit',
	windowsHide: true,
});
if (child.error) {
	process.stderr.write(`Cannot start ${python}: ${child.error.message}\n`);
	process.exit(2);
}
process.exit(child.status ?? 1);
