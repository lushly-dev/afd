import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { execTool, tarCommand, toolCommand, windowsCommandLine } from './exec-tool.mjs';

// portability-ok: these tests are about Windows paths, so a drive letter is their input.
const DRIVE = 'X:';

test('outside Windows every command starts directly', () => {
	for (const command of ['pnpm', 'git', '/repo/node_modules/.bin/lefthook'])
		assert.deepEqual(toolCommand(command, 'linux'), { file: command, shell: false });
});

test('on Windows only shims go through cmd.exe', () => {
	assert.deepEqual(toolCommand('pnpm', 'win32'), { file: 'pnpm', shell: true });
	assert.deepEqual(toolCommand('git', 'win32'), { file: 'git', shell: false });
	const node = `${DRIVE}\\node\\node.exe`;
	assert.deepEqual(toolCommand(node, 'win32'), { file: node, shell: false });
	const bin = `${DRIVE}\\repo\\node_modules\\.bin\\lefthook`;
	assert.deepEqual(
		toolCommand(bin, 'win32', (file) => file === `${bin}.cmd`),
		{ file: `${bin}.cmd`, shell: true }
	);
	assert.deepEqual(
		toolCommand(bin, 'win32', () => false),
		{ file: bin, shell: false }
	);
});

test('cmd.exe arguments are quoted when they hold spaces, and refused when cmd.exe would expand them', () => {
	const destination = `${DRIVE}\\Users\\A B\\artifacts`;
	assert.equal(
		windowsCommandLine('pnpm', ['pack', '--pack-destination', destination, '']),
		`pnpm pack --pack-destination "${destination}" ""`
	);
	for (const unsafe of ['%PATH%', 'a&b', 'a|b', 'a>b', 'a<b', 'a^b', 'say "hi"', 'a\nb'])
		assert.throws(() => windowsCommandLine('pnpm', [unsafe]), /Refusing to pass/);
});

test('execTool starts a real command and returns its output', () => {
	assert.equal(
		execTool(process.execPath, ['-e', 'process.stdout.write("ok")'], { encoding: 'utf8' }),
		'ok'
	);
});

test('tar is the Windows bsdtar on Windows and tar elsewhere', () => {
	const systemRoot = `${DRIVE}\\Windows`;
	assert.equal(tarCommand('linux'), 'tar');
	assert.equal(
		tarCommand('win32', { SystemRoot: systemRoot }),
		join(systemRoot, 'System32', 'tar.exe')
	);
	assert.equal(tarCommand('win32', {}), 'tar.exe');
});
