/**
 * @fileoverview Build `spawn()` arguments that are safe on Windows without `shell: true`.
 *
 * With `shell: true`, Node joins the arguments into one command line WITHOUT escaping,
 * so cmd.exe interprets `&`, `|`, `>`, `^`, `%` and quotes inside arguments. Dropping the
 * shell is not enough either: since the CVE-2024-27980 fix, Node refuses to spawn
 * `.cmd`/`.bat` files (e.g. `npm.cmd`, `pnpm.cmd`) without one (EINVAL).
 *
 * So on Windows we resolve the command ourselves. An `.exe`/`.com` is spawned directly.
 * Anything else (a batch file, or a command we could not resolve) runs through
 * `cmd.exe /d /s /c "<line>"` with every part of `<line>` escaped for cmd.exe, and
 * `windowsVerbatimArguments` so Node does not quote it a second time.
 *
 * Adapted from cross-spawn (https://github.com/moxystudio/node-cross-spawn,
 * lib/parse.js and lib/util/escape.js), MIT License,
 * Copyright (c) 2018 Made With MOXY Lda <hello@moxy.studio>.
 * The argument quoting follows https://qntm.org/cmd. Differences from cross-spawn 7.0.6:
 * - Backslashes are handled by a linear scan. cross-spawn's backtracking-safe regex keeps
 *   only one extra backslash for a run of two or more before a quote or the end of the
 *   argument, so `a\\"b` loses a backslash and `a\\` escapes the closing quote.
 * - Arguments are double-escaped for every `.cmd`/`.bat` target, not only
 *   `node_modules/.bin` shims: global shims such as `npm.cmd` also re-parse `%*`, and a
 *   single-escaped `"` inside an argument would end the quoting there.
 * - Arguments containing CR or LF are rejected on the cmd.exe path, since cmd.exe
 *   cannot pass them through (a line feed ends the command).
 * - No shebang detection.
 */

import { statSync } from 'node:fs';
import { win32 } from 'node:path';

/** cmd.exe metacharacters (see http://www.robvanderwoude.com/escapechars.php). */
const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

/** Targets that CreateProcess runs directly, without cmd.exe. */
const EXECUTABLE_EXT = /\.(?:com|exe)$/i;

/** Batch files: cmd.exe re-parses their arguments when they expand `%*` or `%1`. */
const BATCH_EXT = /\.(?:bat|cmd)$/i;

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** Options for {@link prepareSpawn}. */
export interface PrepareSpawnOptions {
	/** Target platform (default: `process.platform`). */
	platform?: NodeJS.Platform;
	/** Environment the child will receive; used for PATH, PATHEXT and ComSpec (default: `process.env`). */
	env?: NodeJS.ProcessEnv;
	/** Working directory the child will run in; used to resolve the command (default: `process.cwd()`). */
	cwd?: string;
	/** File-existence probe used to resolve the command (default: `fs.statSync(path).isFile()`). */
	isFile?: (path: string) => boolean;
}

/** The command, arguments and verbatim flag to pass to `spawn()` with `shell: false`. */
export interface PreparedSpawn {
	command: string;
	args: string[];
	/** True when `args` are already escaped for cmd.exe; pass it to `spawn()`. */
	windowsVerbatimArguments: boolean;
}

/**
 * Escape a command name for cmd.exe by caret-escaping its metacharacters.
 */
export function escapeCommand(command: string): string {
	return command.replace(CMD_META_CHARS, '^$1');
}

/**
 * Quote an argument for the MSVCRT / CommandLineToArgvW parser, then caret-escape it
 * for cmd.exe.
 *
 * @param doubleEscapeMetaChars - Escape the cmd.exe metacharacters twice, for batch files
 *   whose arguments cmd.exe parses a second time.
 */
export function escapeArgument(arg: string, doubleEscapeMetaChars = false): string {
	// N backslashes before a quote become 2N+1 backslashes and the quote. N backslashes at
	// the end become 2N, because the closing quote follows them. Others stay literal.
	let quoted = '"';
	let backslashes = 0;
	for (const char of arg) {
		if (char === '\\') {
			backslashes++;
			continue;
		}
		if (char === '"') {
			quoted += `${'\\'.repeat(backslashes * 2 + 1)}"`;
		} else {
			quoted += `${'\\'.repeat(backslashes)}${char}`;
		}
		backslashes = 0;
	}
	quoted += `${'\\'.repeat(backslashes * 2)}"`;

	// Caret-escape the metacharacters, including the quotes, so cmd.exe never enters its
	// own quote mode and treats every character literally.
	const escaped = quoted.replace(CMD_META_CHARS, '^$1');
	return doubleEscapeMetaChars ? escaped.replace(CMD_META_CHARS, '^$1') : escaped;
}

/** Look up an environment variable case-insensitively, as Windows does. The last match wins. */
function getEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
	let value: string | undefined;
	for (const [key, entry] of Object.entries(env)) {
		if (key.toUpperCase() === name) value = entry;
	}
	return value;
}

function defaultIsFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

/**
 * Resolve a command to a file the way cmd.exe does: the working directory first, then each
 * PATH entry, trying the PATHEXT extensions unless the command already has one.
 *
 * @returns The absolute Windows path, or undefined when nothing matches
 */
export function resolveWindowsCommand(
	command: string,
	options: { env: NodeJS.ProcessEnv; cwd: string; isFile?: (path: string) => boolean }
): string | undefined {
	const isFile = options.isFile ?? defaultIsFile;
	const extensions = (getEnv(options.env, 'PATHEXT') || DEFAULT_PATHEXT)
		.split(';')
		.map((ext) => ext.trim())
		.filter((ext) => ext.length > 0);
	const ext = win32.extname(command).toLowerCase();
	const names =
		ext && extensions.some((candidate) => candidate.toLowerCase() === ext)
			? [command]
			: extensions.map((candidate) => command + candidate);

	const dirs = [options.cwd];
	if (!/[\\/]/.test(command)) {
		for (const entry of (getEnv(options.env, 'PATH') ?? '').split(';')) {
			const dir = entry.trim().replace(/^"(.*)"$/, '$1');
			if (dir) dirs.push(dir);
		}
	}

	for (const dir of dirs) {
		for (const name of names) {
			const candidate = win32.resolve(options.cwd, dir, name);
			if (isFile(candidate)) return candidate;
		}
	}
	return undefined;
}

/**
 * Prepare a command for `spawn(command, args, { shell: false, windowsVerbatimArguments })`
 * so that no argument is interpreted by a shell.
 *
 * - Not Windows: returned unchanged.
 * - Windows, resolves to `.exe`/`.com`: the resolved path, spawned directly.
 * - Windows, resolves to `.cmd`/`.bat` or not resolved: `cmd.exe /d /s /c "<line>"` with the
 *   command and every argument escaped for cmd.exe (twice for batch files).
 *
 * @throws Error if an argument that must go through cmd.exe contains CR or LF
 */
export function prepareSpawn(
	command: string,
	args: readonly string[],
	options: PrepareSpawnOptions = {}
): PreparedSpawn {
	const platform = options.platform ?? process.platform;
	if (platform !== 'win32') {
		return { command, args: [...args], windowsVerbatimArguments: false };
	}

	const env = options.env ?? process.env;
	const resolved = resolveWindowsCommand(command, {
		env,
		cwd: options.cwd ?? process.cwd(),
		isFile: options.isFile,
	});

	if (resolved && EXECUTABLE_EXT.test(resolved)) {
		return { command: resolved, args: [...args], windowsVerbatimArguments: false };
	}

	for (const part of [command, ...args]) {
		if (/[\r\n]/.test(part)) {
			throw new Error(
				`Refusing to run "${command}" through cmd.exe: an argument contains a line break, which cmd.exe cannot pass safely`
			);
		}
	}

	const doubleEscape = resolved !== undefined && BATCH_EXT.test(resolved);
	const line = [
		escapeCommand(win32.normalize(command)),
		...args.map((arg) => escapeArgument(arg, doubleEscape)),
	].join(' ');

	return {
		command: getEnv(env, 'COMSPEC') || 'cmd.exe',
		args: ['/d', '/s', '/c', `"${line}"`],
		windowsVerbatimArguments: true,
	};
}
