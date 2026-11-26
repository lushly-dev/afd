/**
 * @fileoverview `loam copilot key set <provider>` (phase 5 specification, 4.2): a copilot provider's key, read at a
 * terminal without echo and stored in the OS keychain under the service and account its `[[copilot.providers]]`
 * entry names, then checked with one small request. A command of Loam's CLI, never a kernel command: the key never
 * enters the webview, the store, the journal, a log or this command's result. **This is the development path:** by
 * the owner's condition on Q2 a person never has to run a command, so the amendment before step 9 gives the key a
 * path with no terminal. Nothing here rules that out: the Rust host reads the keychain entry, whoever wrote it.
 *
 * Each platform's own keychain tool writes the entry, with the key on its standard input, never on a command line:
 * on Windows a generic credential whose target is `<service>/<account>`, through the Credential Manager's
 * `CredWriteW`, with the key as UTF-16 as Windows stores a typed password; on macOS a generic password through
 * `security`'s interactive mode (verified via read-back; `src-tauri/src/keychain.rs` reads it natively via
 * `Security.framework` / `apple-native-keyring-store` with ordered search-list lookup, which may show a one-time
 * Keychain Access prompt on first read of a CLI-written item); on Linux a Secret Service item through `secret-tool`.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readDeployment } from '@lushly-dev/loam-manifest/validate';
import { parseManifestToml } from './check.js';

/** A key: printable ASCII with no space, quote or backslash, as every provider's keys are. */
export const KEY_PATTERN = /^[!#-[\]-~]{8,4096}$/;

/** The service and account a keychain entry is stored under, as the deployment's schema has them. */
const KEYCHAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface KeychainV1 {
	/** Store `secret` under `service` and `account`, replacing any entry there. */
	set(service: string, account: string, secret: string): Promise<void>;
}

export interface CopilotKeySetDeps {
	/** The key, read without echo. */
	readSecret(prompt: string): Promise<string>;
	keychain: KeychainV1;
	/** The check's one request; never follows a redirect. */
	fetch: typeof fetch;
	platform?: NodeJS.Platform;
}

export type CopilotKeySetResult =
	| {
			ok: true;
			provider: string;
			service: string;
			account: string;
			/** `true` when the provider accepted the key; `false` when it was not reached or did not say. */
			checked: boolean;
			/** The check's status, when the provider answered it. */
			answered?: number;
	  }
	| { ok: false; code: string; message: string; suggestion: string };

const refusal = (code: string, message: string, suggestion: string): CopilotKeySetResult => ({
	ok: false,
	code,
	message,
	suggestion,
});

/** The check's request (4.2's fixed endpoints): a list of models, which costs no tokens. */
export function checkRequest(
	kind: 'anthropic' | 'openai' | 'openai-compatible',
	key: string,
	endpoint?: string
): { url: string; headers: Record<string, string> } {
	if (kind === 'anthropic')
		return {
			url: 'https://api.anthropic.com/v1/models?limit=1',
			headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
		};
	const base =
		kind === 'openai' ? 'https://api.openai.com/v1' : (endpoint ?? '').replace(/\/+$/, '');
	return { url: `${base}/models`, headers: { authorization: `Bearer ${key}` } };
}

/** Sets a provider's key from the deployment file at `config`. Nothing it returns holds the key. */
export async function copilotKeySet(
	input: { provider: string; config: string },
	deps: CopilotKeySetDeps
): Promise<CopilotKeySetResult> {
	let parsed: unknown;
	try {
		parsed = parseManifestToml(await readFile(input.config, 'utf8'));
	} catch {
		return refusal(
			'DEPLOYMENT_INVALID',
			'The deployment file cannot be read as TOML.',
			'Pass `--config <loam.deployment.toml>`, or run this where it is.'
		);
	}
	const read = readDeployment(parsed);
	if (!read.ok) {
		const first = read.refusals[0];
		return refusal(
			first?.code ?? 'DEPLOYMENT_INVALID',
			first?.message ?? 'The deployment file is refused.',
			'Run `loam deployment check` on it and fix what it reports.'
		);
	}
	const { deployment } = read;
	const provider =
		deployment.deployment_version === 4
			? deployment.copilot?.providers?.find(({ id }) => id === input.provider)
			: undefined;
	if (!provider)
		return refusal(
			'COPILOT_PROVIDER_UNKNOWN',
			`No provider \`${input.provider}\` is listed under \`[copilot]\`.`,
			'Add a `[[copilot.providers]]` table with that `id`, or name one that is listed.'
		);
	if (provider.kind === 'test')
		return refusal(
			'COPILOT_KEY_UNUSED',
			'The test provider takes no key.',
			'Set a key for an `anthropic`, `openai` or `openai-compatible` provider.'
		);
	const where = provider.key;
	if (!where || !('keychain' in where))
		return refusal(
			'COPILOT_KEY_UNUSED',
			where
				? 'This provider reads its key from a file, not the keychain.'
				: 'This provider names no keychain entry.',
			`Set \`key = { keychain = "loam-copilot", account = "${provider.id}" }\` in its table, or write the key into its owner-only file.`
		);
	if (!KEYCHAIN_NAME.test(where.keychain) || !KEYCHAIN_NAME.test(where.account))
		return refusal(
			'DEPLOYMENT_COPILOT_INVALID',
			'The keychain entry’s name is not one Loam stores.',
			'Use letters, digits, `.`, `_` and `-`.'
		);
	const secret = (await deps.readSecret(`Key for ${provider.id} (${provider.kind}): `)).trim();
	if (!KEY_PATTERN.test(secret))
		return refusal(
			'COPILOT_KEY_INVALID',
			'That is not a key: one is 8 to 4,096 printable characters, with no space, quote or backslash.',
			'Copy the key from the provider’s console and run this again.'
		);
	try {
		await deps.keychain.set(where.keychain, where.account, secret);
	} catch {
		return refusal(
			'COPILOT_KEYCHAIN_UNAVAILABLE',
			'The OS keychain did not store the key.',
			deps.platform === 'linux'
				? 'Install `secret-tool` (libsecret-tools) and unlock a Secret Service keyring, or use `key = { file = … }`.'
				: 'Unlock your keychain and run this again, or use `key = { file = … }`.'
		);
	}
	const { url, headers } = checkRequest(provider.kind, secret, provider.endpoint);
	let status: number;
	try {
		const response = await deps.fetch(url, {
			headers,
			redirect: 'error',
			signal: AbortSignal.timeout(15_000),
		});
		status = response.status;
		await response.body?.cancel();
	} catch {
		return {
			ok: true,
			provider: provider.id,
			service: where.keychain,
			account: where.account,
			checked: false,
		};
	}
	if (status === 401 || status === 403)
		return refusal(
			'MODEL_REFUSED',
			`The key is stored, and ${provider.kind === 'anthropic' ? 'Anthropic' : 'the provider'} refused it (${status}).`,
			`Check the key in the provider’s console, then run \`loam copilot key set ${provider.id}\` again.`
		);
	return {
		ok: true,
		provider: provider.id,
		service: where.keychain,
		account: where.account,
		checked: status >= 200 && status < 300,
		answered: status,
	};
}

/**
 * A line from the terminal with nothing echoed: raw mode, reading until Enter, with Ctrl+C ending the read. Off a
 * terminal, the first line of standard input, which nothing echoes either.
 */
export function readSecretFromTerminal(prompt: string): Promise<string> {
	const input = process.stdin;
	process.stderr.write(prompt);
	if (!input.isTTY) {
		return new Promise((resolve, reject) => {
			let text = '';
			input.setEncoding('utf8');
			const done = () => {
				input.off('data', data);
				input.off('end', done);
				input.pause();
				resolve(text.split(/\r?\n/)[0] ?? '');
			};
			const data = (chunk: string) => {
				text += chunk;
				if (text.includes('\n') || text.length > 8192) done();
			};
			input.on('data', data);
			input.on('end', done);
			input.on('error', reject);
			input.resume();
		});
	}
	return new Promise((resolve, reject) => {
		let text = '';
		input.setRawMode(true);
		input.setEncoding('utf8');
		const finish = (cancelled: boolean) => {
			input.setRawMode(false);
			input.off('data', data);
			input.pause();
			process.stderr.write('\n');
			if (cancelled) reject(new Error('Cancelled'));
			else resolve(text);
		};
		const data = (chunk: string) => {
			for (const character of chunk) {
				if (character === '\r' || character === '\n') return finish(false);
				if (character === '\u0003') return finish(true);
				if (character === '\u007f' || character === '\b') text = text.slice(0, -1);
				else if (text.length < 8192) text += character;
			}
		};
		input.on('data', data);
		input.resume();
	});
}

/**
 * Maximum encoded interactive command length accepted by macOS `/usr/bin/security -i` (`readline.c` reads into
 * a 4,096-byte buffer, capping commands at 4,095 bytes). Pre-checking prevents `-U` from truncating and
 * overwriting an existing credential before read-back detects the mismatch.
 */
export const MACOS_SECURITY_LINE_MAX_BYTES = 4094;

/** Output of one keychain helper invocation; callers must never log `stdout` or `stderr`. */
export interface KeychainCommandResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

/** Injectable runner for OS keychain helper binaries (used by `systemKeychain` tests). */
export type KeychainCommandRunner = (
	program: string,
	args: string[],
	stdin?: string
) => Promise<KeychainCommandResult>;

/** Runs `program` with `stdin` as its whole input, failing on a non-zero exit. Its output is discarded. */
function runWithInput(program: string, args: string[], stdin: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(program, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
		child.on('error', reject);
		child.stdin.on('error', () => {});
		child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
		child.stdin.end(stdin);
	});
}

/** Runs `program` capturing stdout and stderr so callers can detect silent errors and verify read-back. */
function runCapturing(
	program: string,
	args: string[],
	stdin?: string
): Promise<KeychainCommandResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(program, args, {
			stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
			windowsHide: true,
		});
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
		child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
		child.stdin?.on('error', () => {});
		child.on('error', reject);
		child.on('close', (code) => {
			resolve({
				code,
				stdout: Buffer.concat(stdoutChunks).toString('utf8'),
				stderr: Buffer.concat(stderrChunks).toString('utf8'),
			});
		});
		if (stdin !== undefined) {
			child.stdin?.end(stdin);
		}
	});
}

/**
 * Windows' `CredWriteW`, from PowerShell with the key on standard input. The target is `<service>/<account>`, as
 * the Rust host reads it; the type a generic credential, kept for this user on this machine.
 */
const WINDOWS_SCRIPT = `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class LoamCred {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL { public int Flags; public int Type; public string TargetName; public string Comment;
    public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredWriteW(ref CREDENTIAL credential, int flags);
  public static void Write(string target, string user, string secret) {
    byte[] blob = System.Text.Encoding.Unicode.GetBytes(secret);
    IntPtr buffer = Marshal.AllocHGlobal(blob.Length);
    try {
      Marshal.Copy(blob, 0, buffer, blob.Length);
      CREDENTIAL c = new CREDENTIAL();
      c.Type = 1; c.TargetName = target; c.UserName = user; c.CredentialBlob = buffer;
      c.CredentialBlobSize = blob.Length; c.Persist = 2; c.Comment = "Loam copilot key";
      if (!CredWriteW(ref c, 0)) { throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
    } finally { Marshal.FreeHGlobal(buffer); }
  }
}
"@
$secret = [Console]::In.ReadLine()
[LoamCred]::Write($env:LOAM_KEY_TARGET, $env:LOAM_KEY_ACCOUNT, $secret)
`;

/** The OS keychain on this platform, written by its own tool with the key on standard input. */
export function systemKeychain(
	platform: NodeJS.Platform = process.platform,
	run: KeychainCommandRunner = runCapturing
): KeychainV1 {
	return {
		async set(service, account, secret) {
			if (!KEYCHAIN_NAME.test(service) || !KEYCHAIN_NAME.test(account) || !KEY_PATTERN.test(secret))
				throw new Error('Refused');
			if (platform === 'win32') {
				const root = process.env.SystemRoot ?? process.env.windir;
				if (!root) throw new Error('No SystemRoot');
				const powershell = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
				await new Promise<void>((resolve, reject) => {
					const child = spawn(
						powershell,
						['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT],
						{
							stdio: ['pipe', 'ignore', 'ignore'],
							windowsHide: true,
							env: {
								...process.env,
								LOAM_KEY_TARGET: `${service}/${account}`,
								LOAM_KEY_ACCOUNT: account,
							},
						}
					);
					child.on('error', reject);
					child.stdin.on('error', () => {});
					child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
					child.stdin.end(`${secret}\n`);
				});
				return;
			}
			if (platform === 'darwin') {
				// `security`'s interactive mode reads its command from standard input; the names and the key hold no
				// quote, space or backslash, so each is one quoted word. Pre-check the encoded line length against
				// Apple's 4,095-byte interactive buffer before spawning so `-U` can never overwrite an existing entry
				// with a truncated value; then capture all stderr bytes and confirm the stored secret by read-back.
				const commandLine = `add-generic-password -U -s "${service}" -a "${account}" -l "Loam copilot key" -w "${secret}"\n`;
				if (Buffer.byteLength(commandLine, 'utf8') > MACOS_SECURITY_LINE_MAX_BYTES) {
					throw new Error('macOS keychain command too long');
				}
				const written = await run('/usr/bin/security', ['-i'], commandLine);
				if (written.code !== 0 || written.stderr.length > 0) {
					throw new Error('macOS keychain write failed');
				}
				const verified = await run('/usr/bin/security', [
					'find-generic-password',
					'-s',
					service,
					'-a',
					account,
					'-w',
				]);
				const stored = verified.stdout.replace(/\r?\n$/, '');
				if (verified.code !== 0 || verified.stderr.length > 0 || stored !== secret) {
					throw new Error('macOS keychain verification failed');
				}
				return;
			}
			// `secret-tool` reads the secret from standard input when it is not a terminal, to its end.
			await runWithInput(
				'secret-tool',
				[
					'store',
					'--label',
					`Loam copilot key ${service}/${account}`,
					'service',
					service,
					'account',
					account,
				],
				secret
			);
		},
	};
}

/** The real dependencies: this terminal, this platform's keychain, and Node's `fetch`. */
export function systemKeySetDeps(): CopilotKeySetDeps {
	return {
		readSecret: readSecretFromTerminal,
		keychain: systemKeychain(),
		fetch: globalThis.fetch.bind(globalThis),
		platform: process.platform,
	};
}
