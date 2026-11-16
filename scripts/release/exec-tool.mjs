/**
 * Starts a package-manager CLI on every platform.
 *
 * Windows installs `pnpm`, `npm`, `npx`, `lefthook` and `node_modules/.bin/*` as `.cmd`
 * shims, which Node starts only through cmd.exe (`shell: true`). cmd.exe splits unquoted
 * paths at spaces and expands `%VAR%` and `^ & | < >`, so on Windows each argument is
 * quoted and an argument holding one of those characters is refused, never escaped.
 * Elsewhere, and for any other command, these are `execFileSync` and `spawnSync` unchanged.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

/** Commands Windows installs only as `.cmd` shims. */
export const SHIMS = new Set([
	'pnpm',
	'npm',
	'npx',
	'pnpx',
	'corepack',
	'yarn',
	'lefthook',
	'changeset',
]);
const UNSAFE = /["%^&|<>\r\n]/;

/** What to start and whether it needs cmd.exe, for a command on a platform. */
export function toolCommand(command, platform = process.platform, exists = existsSync) {
	// Windows paths are parsed as Windows paths whatever platform asks.
	if (platform !== 'win32' || win32.extname(command) !== '') return { file: command, shell: false };
	if (/[\\/]/.test(command)) {
		const shim = `${command}.cmd`;
		return exists(shim) ? { file: shim, shell: true } : { file: command, shell: false };
	}
	return { file: command, shell: SHIMS.has(command) };
}

/** One cmd.exe command line, or an error naming the argument cmd.exe would reinterpret. */
export function windowsCommandLine(file, args) {
	return [file, ...args]
		.map((argument) => {
			const text = String(argument);
			if (UNSAFE.test(text))
				throw new Error(`Refusing to pass ${JSON.stringify(text)} through cmd.exe`);
			return text === '' || /\s/.test(text) ? `"${text}"` : text;
		})
		.join(' ');
}

/** `execFileSync(command, args, options)`, starting Windows `.cmd` shims through cmd.exe. */
export function execTool(command, args = [], options = {}) {
	const { file, shell } = toolCommand(command);
	if (!shell) return execFileSync(file, args, options);
	return execFileSync(windowsCommandLine(file, args), { ...options, shell: true });
}

/** `spawnSync(command, args, options)`, starting Windows `.cmd` shims through cmd.exe. */
export function spawnTool(command, args = [], options = {}) {
	const { file, shell } = toolCommand(command);
	if (!shell) return spawnSync(file, args, options);
	return spawnSync(windowsCommandLine(file, args), { ...options, shell: true });
}

/** The bsdtar Windows ships, which reads a drive-letter path as a drive; Git's GNU tar reads it as a host. */
export function tarCommand(platform = process.platform, environment = process.env) {
	if (platform !== 'win32') return 'tar';
	const root = environment.SystemRoot ?? environment.windir;
	return root ? win32.join(root, 'System32', 'tar.exe') : 'tar.exe';
}

/** The interpreter's major/minor version, or undefined when it cannot be read. */
function pythonVersion(file, args) {
	const probe = spawnSync(
		file,
		[...args, '-c', 'import sys; print("%s.%s" % sys.version_info[:2])'],
		{
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
			timeout: 10_000,
		}
	);
	if (probe.status !== 0) return undefined;
	const match = /^(\d+)\.(\d+)\s*$/.exec(probe.stdout);
	return match ? [Number(match[1]), Number(match[2])] : undefined;
}

let python;

/**
 * A Python 3.11+ interpreter for native release checks, as `{ file, args }` (they use tomllib).
 * Elsewhere it is `python3`, unprobed. On Windows, App Execution Aliases put Microsoft Store
 * stubs named `python3` and `python` on `PATH`,
 * which exit 9009 instead of running, so there it is `PYTHON` when set, else the first of
 * `python3`, `python` and the `py -3` launcher that meets that version. Throws on Windows otherwise.
 */
export function pythonCommand({
	environment = process.env,
	platform = process.platform,
	version = pythonVersion,
} = {}) {
	if (platform !== 'win32') return { file: 'python3', args: [] };
	const configured = environment.PYTHON;
	const candidates = configured
		? [{ file: configured, args: [] }]
		: [
				{ file: 'python3', args: [] },
				{ file: 'python', args: [] },
				{ file: 'py', args: ['-3'] },
			];
	const found = candidates.find(({ file, args }) => {
		const detected = version(file, args);
		return detected?.[0] === 3 && detected[1] >= 11;
	});
	if (found) return found;
	throw new Error(
		configured
			? `PYTHON=${configured} does not run Python 3.11 or newer`
			: `No Python 3.11 or newer runs as ${candidates.map(({ file, args }) => [file, ...args].join(' ')).join(', ')}. ` +
					'On Windows, python3 and python may be the Microsoft Store stubs: install Python (or uv python install), put it first on PATH or set PYTHON, or turn the App execution aliases off.'
	);
}

/** {@link pythonCommand} for this process, found once. */
export function python3() {
	python ??= pythonCommand();
	return python;
}
