import { describe, expect, it } from 'vitest';
import {
	escapeArgument,
	escapeCommand,
	prepareSpawn,
	resolveWindowsCommand,
} from './windows-spawn.js';

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULATED WINDOWS PARSERS (pure functions, so the escaping is testable on Linux)
// ═══════════════════════════════════════════════════════════════════════════════

/** Characters cmd.exe acts on when they are not caret-escaped. */
const CMD_SPECIAL = new Set(['"', '&', '|', '<', '>', '(', ')', '%', '!', '^']);

/**
 * One cmd.exe parsing pass over a line that must contain no live special characters:
 * `^x` yields a literal `x`; any other special character fails the test.
 */
function cmdPass(line: string): string {
	let out = '';
	for (let i = 0; i < line.length; i++) {
		const ch = line[i] as string;
		if (ch === '^') {
			i++;
			const next = line[i];
			if (next === undefined) throw new Error(`dangling caret in ${line}`);
			out += next;
		} else if (CMD_SPECIAL.has(ch)) {
			throw new Error(`unescaped ${ch} at ${i} in ${line}`);
		} else {
			out += ch;
		}
	}
	return out;
}

/** Split a command line the way the MSVCRT / CommandLineToArgvW parser does. */
function parseArgv(line: string): string[] {
	const args: string[] = [];
	let i = 0;
	while (i < line.length) {
		while (line[i] === ' ' || line[i] === '\t') i++;
		if (i >= line.length) break;
		let arg = '';
		let inQuotes = false;
		while (i < line.length) {
			const ch = line[i];
			if (!inQuotes && (ch === ' ' || ch === '\t')) break;
			if (ch === '\\') {
				let count = 0;
				while (line[i] === '\\') {
					count++;
					i++;
				}
				if (line[i] === '"') {
					arg += '\\'.repeat(Math.floor(count / 2));
					if (count % 2 === 1) {
						arg += '"';
						i++;
					}
				} else {
					arg += '\\'.repeat(count);
				}
			} else if (ch === '"') {
				if (inQuotes && line[i + 1] === '"') {
					arg += '"';
					i += 2;
				} else {
					inQuotes = !inQuotes;
					i++;
				}
			} else {
				arg += ch;
				i++;
			}
		}
		args.push(arg);
	}
	return args;
}

/**
 * What a program started via `cmd.exe /d /s /c "<line>"` receives in argv. A batch file
 * target makes cmd.exe parse the arguments a second time when it expands `%*`.
 */
function receivedArgs(args: string[], batch: boolean): string[] {
	let line = cmdPass(['node', ...args.map((arg) => escapeArgument(arg, batch))].join(' '));
	if (batch) line = cmdPass(line);
	return parseArgv(line).slice(1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ESCAPING
// ═══════════════════════════════════════════════════════════════════════════════

describe('escapeArgument', () => {
	it.each([
		['foo', '^"foo^"'],
		['', '^"^"'],
		['foo bar', '^"foo^ bar^"'],
		['x & calc', '^"x^ ^&^ calc^"'],
		['a|b>c<d', '^"a^|b^>c^<d^"'],
		['%PATH%', '^"^%PATH^%^"'],
		['!x!', '^"^!x^!^"'],
		['^', '^"^^^"'],
		['(a)[b]', '^"^(a^)^[b^]^"'],
		['a;b,c', '^"a^;b^,c^"'],
		['*?', '^"^*^?^"'],
		['`', '^"^`^"'],
		['a"b', '^"a\\^"b^"'],
		['a\\b', '^"a\\b^"'],
		['\\\\server\\share', '^"\\\\server\\share^"'],
		// portability-ok: Windows path fixture for spawn-escaping tests
		['C:\\Program Files\\', '^"C:\\Program^ Files\\\\^"'],
		// Backslash runs before a quote or the end are doubled (cross-spawn 7.0.6 differs here)
		['a\\', '^"a\\\\^"'],
		['a\\\\', '^"a\\\\\\\\^"'],
		['a\\"b', '^"a\\\\\\^"b^"'],
		['a\\\\"b', '^"a\\\\\\\\\\^"b^"'],
	])('escapes %j as %s', (input, expected) => {
		expect(escapeArgument(input)).toBe(expected);
	});

	it.each([
		['foo', '^^^"foo^^^"'],
		['x & calc', '^^^"x^^^ ^^^&^^^ calc^^^"'],
		['a"b', '^^^"a\\^^^"b^^^"'],
		['%PATH%', '^^^"^^^%PATH^^^%^^^"'],
	])('double-escapes %j as %s', (input, expected) => {
		expect(escapeArgument(input, true)).toBe(expected);
	});

	const vectors = [
		'',
		' ',
		'foo',
		'foo bar',
		'"',
		'""',
		'"foo"',
		'foo"bar"foo',
		'\\',
		'\\"',
		'\\\\"',
		'a\\',
		'a\\\\',
		'a\\\\\\',
		'x & calc',
		'x | calc',
		'x > out.txt',
		'x < in.txt',
		'x && calc || calc',
		'%PATH%',
		'%%PATH%%',
		'!PATH!',
		'^',
		'^^',
		'^&calc',
		'a"&calc&"',
		'\\"&calc&\\"',
		'x\\\\" --repo=evil/repo',
		'()[]{}',
		'`',
		';,=',
		'*?',
		'a\tb',
		'héllo wörld 😀',
		// portability-ok: Windows path fixture for spawn-escaping tests
		JSON.stringify({ title: 'x & calc', path: 'C:\\dir\\', quote: '"%PATH%"' }),
	];

	it.each(vectors)('round-trips %j through cmd.exe to argv', (arg) => {
		expect(receivedArgs([arg, 'next'], false)).toEqual([arg, 'next']);
	});

	it.each(vectors)('round-trips %j through cmd.exe and a batch file to argv', (arg) => {
		expect(receivedArgs([arg, 'next'], true)).toEqual([arg, 'next']);
	});

	it('needs double escaping when a batch file re-parses the arguments', () => {
		const single = cmdPass(`node ${escapeArgument('a"&calc&"')}`);
		// The batch file's second pass would see a live quote and a live `&`
		expect(() => cmdPass(single)).toThrow(/unescaped/);
	});
});

describe('escapeCommand', () => {
	it.each([
		['npm', 'npm'],
		// portability-ok: Windows path fixture for spawn-escaping tests
		['C:\\tools\\afd.cmd', 'C:\\tools\\afd.cmd'],
		['node_modules/.bin/foo bar.cmd', 'node_modules/.bin/foo^ bar.cmd'],
		['a&b|c', 'a^&b^|c'],
		['%COMSPEC%', '^%COMSPEC^%'],
	])('escapes %j as %s', (input, expected) => {
		expect(escapeCommand(input)).toBe(expected);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

function files(...paths: string[]): (path: string) => boolean {
	const set = new Set(paths.map((path) => path.toLowerCase()));
	return (path) => set.has(path.toLowerCase());
}

describe('resolveWindowsCommand', () => {
	// portability-ok: Windows path fixture for spawn-escaping tests
	const cwd = 'C:\\work';

	it('searches PATH with the PATHEXT extensions', () => {
		const resolved = resolveWindowsCommand('gh', {
			// portability-ok: Windows path fixture for spawn-escaping tests
			env: { Path: 'C:\\Windows;C:\\tools' },
			cwd,
			// portability-ok: Windows path fixture for spawn-escaping tests
			isFile: files('C:\\tools\\gh.exe'),
		});
		// portability-ok: Windows path fixture for spawn-escaping tests
		expect(resolved).toBe('C:\\tools\\gh.EXE');
	});

	it('searches the working directory before PATH', () => {
		const resolved = resolveWindowsCommand('npm', {
			// portability-ok: Windows path fixture for spawn-escaping tests
			env: { PATH: 'C:\\nodejs' },
			cwd,
			// portability-ok: Windows path fixture for spawn-escaping tests
			isFile: files('C:\\work\\npm.cmd', 'C:\\nodejs\\npm.cmd'),
		});
		// portability-ok: Windows path fixture for spawn-escaping tests
		expect(resolved).toBe('C:\\work\\npm.CMD');
	});

	it('tries extensions in PATHEXT order', () => {
		// portability-ok: Windows path fixture for spawn-escaping tests
		const isFile = files('C:\\bin\\tool.cmd', 'C:\\bin\\tool.exe');
		// portability-ok: Windows path fixture for spawn-escaping tests
		expect(resolveWindowsCommand('tool', { env: { PATH: 'C:\\bin' }, cwd, isFile })).toBe(
			// portability-ok: Windows path fixture for spawn-escaping tests
			'C:\\bin\\tool.EXE'
		);
		expect(
			resolveWindowsCommand('tool', {
				// portability-ok: Windows path fixture for spawn-escaping tests
				env: { PATH: 'C:\\bin', PATHEXT: '.CMD;.EXE' },
				cwd,
				isFile,
			})
			// portability-ok: Windows path fixture for spawn-escaping tests
		).toBe('C:\\bin\\tool.CMD');
	});

	it('does not append extensions to a command that has one', () => {
		const resolved = resolveWindowsCommand('npm.cmd', {
			// portability-ok: Windows path fixture for spawn-escaping tests
			env: { PATH: 'C:\\nodejs' },
			cwd,
			// portability-ok: Windows path fixture for spawn-escaping tests
			isFile: files('C:\\nodejs\\npm.cmd', 'C:\\nodejs\\npm.cmd.exe'),
		});
		// portability-ok: Windows path fixture for spawn-escaping tests
		expect(resolved).toBe('C:\\nodejs\\npm.cmd');
	});

	it('resolves a command with a directory against cwd only', () => {
		// portability-ok: Windows path fixture for spawn-escaping tests
		const isFile = files('C:\\work\\node_modules\\.bin\\afd.cmd', 'C:\\tools\\afd.exe');
		expect(
			// portability-ok: Windows path fixture for spawn-escaping tests
			resolveWindowsCommand('node_modules/.bin/afd', { env: { PATH: 'C:\\tools' }, cwd, isFile })
			// portability-ok: Windows path fixture for spawn-escaping tests
		).toBe('C:\\work\\node_modules\\.bin\\afd.CMD');
		// portability-ok: Windows path fixture for spawn-escaping tests
		expect(resolveWindowsCommand('C:\\tools\\afd.exe', { env: { PATH: '' }, cwd, isFile })).toBe(
			// portability-ok: Windows path fixture for spawn-escaping tests
			'C:\\tools\\afd.exe'
		);
	});

	it('accepts quoted PATH entries and case-insensitive variable names', () => {
		const resolved = resolveWindowsCommand('npm', {
			// portability-ok: Windows path fixture for spawn-escaping tests
			env: { path: 'C:\\old', pAtH: '"C:\\Program Files\\nodejs";;', pathext: '.CMD' },
			cwd,
			// portability-ok: Windows path fixture for spawn-escaping tests
			isFile: files('C:\\Program Files\\nodejs\\npm.cmd', 'C:\\old\\npm.cmd'),
		});
		// portability-ok: Windows path fixture for spawn-escaping tests
		expect(resolved).toBe('C:\\Program Files\\nodejs\\npm.CMD');
	});

	it('returns undefined when nothing matches', () => {
		expect(
			// portability-ok: Windows path fixture for spawn-escaping tests
			resolveWindowsCommand('missing', { env: { PATH: 'C:\\tools' }, cwd, isFile: files() })
		).toBeUndefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// PREPARE SPAWN
// ═══════════════════════════════════════════════════════════════════════════════

describe('prepareSpawn', () => {
	// portability-ok: Windows path fixture for spawn-escaping tests
	const cwd = 'C:\\work';
	const env = {
		// portability-ok: Windows path fixture for spawn-escaping tests
		ComSpec: 'C:\\Windows\\system32\\cmd.exe',
		// portability-ok: Windows path fixture for spawn-escaping tests
		Path: 'C:\\Program Files\\GitHub CLI;C:\\Program Files\\nodejs;C:\\tools',
		PATHEXT: '.COM;.EXE;.BAT;.CMD',
	};
	const isFile = files(
		// portability-ok: Windows path fixture for spawn-escaping tests
		'C:\\Program Files\\GitHub CLI\\gh.exe',
		// portability-ok: Windows path fixture for spawn-escaping tests
		'C:\\Program Files\\nodejs\\npm.cmd',
		// portability-ok: Windows path fixture for spawn-escaping tests
		'C:\\tools\\legacy.com',
		// portability-ok: Windows path fixture for spawn-escaping tests
		'C:\\tools\\build.bat',
		// portability-ok: Windows path fixture for spawn-escaping tests
		'C:\\work\\node_modules\\.bin\\afd.cmd'
	);
	const win32 = { platform: 'win32', env, cwd, isFile } as const;

	it.each(['linux', 'darwin'] as const)('passes arguments through unchanged on %s', (platform) => {
		const args = ['issue', 'create', '--title=x & calc'];
		const prepared = prepareSpawn('gh', args, { platform });
		expect(prepared).toEqual({ command: 'gh', args, windowsVerbatimArguments: false });
		expect(prepared.args).not.toBe(args);
	});

	it('spawns a resolved .exe directly with the raw arguments', () => {
		const args = ['issue', 'create', '--title=x & calc', '--body=line 1\nline 2 "%PATH%"'];
		expect(prepareSpawn('gh', args, win32)).toEqual({
			// portability-ok: Windows path fixture for spawn-escaping tests
			command: 'C:\\Program Files\\GitHub CLI\\gh.EXE',
			args,
			windowsVerbatimArguments: false,
		});
	});

	it('spawns a resolved .com directly', () => {
		expect(prepareSpawn('legacy', ['a&b'], win32)).toEqual({
			// portability-ok: Windows path fixture for spawn-escaping tests
			command: 'C:\\tools\\legacy.COM',
			args: ['a&b'],
			windowsVerbatimArguments: false,
		});
	});

	it('runs a .cmd shim through cmd.exe with double-escaped arguments', () => {
		expect(prepareSpawn('npm', ['install', 'x & calc'], win32)).toEqual({
			// portability-ok: Windows path fixture for spawn-escaping tests
			command: 'C:\\Windows\\system32\\cmd.exe',
			args: ['/d', '/s', '/c', '"npm ^^^"install^^^" ^^^"x^^^ ^^^&^^^ calc^^^""'],
			windowsVerbatimArguments: true,
		});
	});

	it('double-escapes node_modules/.bin shims and .bat files', () => {
		expect(prepareSpawn('node_modules/.bin/afd', ['a"b'], win32).args[3]).toBe(
			'"node_modules\\.bin\\afd ^^^"a\\^^^"b^^^""'
		);
		expect(prepareSpawn('build', ['%PATH%'], win32).args[3]).toBe('"build ^^^"^^^%PATH^^^%^^^""');
	});

	it('runs an unresolved command through cmd.exe with single-escaped arguments', () => {
		expect(prepareSpawn('missing', ['--title=x & calc'], win32)).toEqual({
			// portability-ok: Windows path fixture for spawn-escaping tests
			command: 'C:\\Windows\\system32\\cmd.exe',
			args: ['/d', '/s', '/c', '"missing ^"--title=x^ ^&^ calc^""'],
			windowsVerbatimArguments: true,
		});
	});

	it('escapes the command itself', () => {
		// portability-ok: Windows path fixture for spawn-escaping tests
		expect(prepareSpawn('C:/odd&dir/tool', [], win32).args[3]).toBe('"C:\\odd^&dir\\tool"');
	});

	it('falls back to cmd.exe when ComSpec is not set', () => {
		const prepared = prepareSpawn('missing', [], { ...win32, env: { PATH: '' } });
		expect(prepared.command).toBe('cmd.exe');
	});

	it('rejects line breaks in arguments that would go through cmd.exe', () => {
		expect(() => prepareSpawn('npm', ['install', 'a\nb'], win32)).toThrow(/line break/);
		expect(() => prepareSpawn('missing', ['a\rb'], win32)).toThrow(/line break/);
	});
});
