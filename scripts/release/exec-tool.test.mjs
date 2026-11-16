import assert from 'node:assert/strict';
import { win32 } from 'node:path';
import test from 'node:test';
import {
	execTool,
	pythonCommand,
	spawnTool,
	tarCommand,
	toolCommand,
	windowsCommandLine,
} from './exec-tool.mjs';

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

test('spawnTool starts a package-manager shim and reports its exit status', () => {
	const result = spawnTool('pnpm', ['--version'], { encoding: 'utf8' });
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /^\d+\.\d+\.\d+/);
});

test('tar is the Windows bsdtar on Windows and tar elsewhere', () => {
	const systemRoot = `${DRIVE}\\Windows`;
	assert.equal(tarCommand('linux'), 'tar');
	assert.equal(
		tarCommand('win32', { SystemRoot: systemRoot }),
		win32.join(systemRoot, 'System32', 'tar.exe')
	);
	assert.equal(tarCommand('win32', {}), 'tar.exe');
});

test('Python is python3 off Windows, and on Windows the first that runs past a Store stub', () => {
	const only =
		(...working) =>
		(file, args) =>
			working.includes([file, ...args].join(' ')) ? [3, 12] : undefined;
	// Off Windows nothing is probed, and PYTHON changes nothing.
	for (const environment of [{}, { PYTHON: '/opt/py' }])
		assert.deepEqual(pythonCommand({ environment, platform: 'linux', version: only() }), {
			file: 'python3',
			args: [],
		});
	// The Store stubs named python3 and python exit 9009: the launcher is next on Windows.
	assert.deepEqual(pythonCommand({ environment: {}, platform: 'win32', version: only('py -3') }), {
		file: 'py',
		args: ['-3'],
	});
	assert.deepEqual(
		pythonCommand({ environment: {}, platform: 'win32', version: only('python', 'py -3') }),
		{ file: 'python', args: [] }
	);
	assert.deepEqual(
		pythonCommand({
			environment: { PYTHON: 'C:/py/python.exe' },
			platform: 'win32',
			version: only('C:/py/python.exe'),
		}),
		{ file: 'C:/py/python.exe', args: [] }
	);
	assert.throws(
		() => pythonCommand({ environment: {}, platform: 'win32', version: only() }),
		/No Python 3.11 or newer runs as python3, python, py -3\. On Windows, python3 and python may be the Microsoft Store stubs/
	);
	assert.throws(
		() =>
			pythonCommand({
				environment: { PYTHON: 'nope' },
				platform: 'win32',
				version: only('python3'),
			}),
		/PYTHON=nope does not run Python 3.11 or newer/
	);
});

test('native release Python discovery rejects 3.10 and reaches a 3.11+ launcher', () => {
	const tried = [];
	const version = (file, args) => {
		const command = [file, ...args].join(' ');
		tried.push(command);
		return { python: [3, 10], 'py -3': [3, 12] }[command];
	};
	assert.deepEqual(pythonCommand({ environment: {}, platform: 'win32', version }), {
		file: 'py',
		args: ['-3'],
	});
	assert.deepEqual(tried, ['python3', 'python', 'py -3']);
	assert.throws(
		() => pythonCommand({ environment: { PYTHON: 'python' }, platform: 'win32', version }),
		/PYTHON=python does not run Python 3.11 or newer/
	);
});
