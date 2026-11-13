/**
 * Starts a package-manager CLI on every platform.
 *
 * Windows installs `pnpm`, `npm`, `npx`, `lefthook` and `node_modules/.bin/*` as `.cmd`
 * shims, which Node starts only through cmd.exe (`shell: true`). cmd.exe splits unquoted
 * paths at spaces and expands `%VAR%` and `^ & | < >`, so on Windows each argument is
 * quoted and an argument holding one of those characters is refused, never escaped.
 * Elsewhere, and for any other command, this is `execFileSync` unchanged.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

/** Commands Windows installs only as `.cmd` shims. */
export const SHIMS = new Set(['pnpm', 'npm', 'npx', 'lefthook', 'changeset']);
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

/** The bsdtar Windows ships, which reads a drive-letter path as a drive; Git's GNU tar reads it as a host. */
export function tarCommand(platform = process.platform, environment = process.env) {
	if (platform !== 'win32') return 'tar';
	const root = environment.SystemRoot ?? environment.windir;
	return root ? win32.join(root, 'System32', 'tar.exe') : 'tar.exe';
}
