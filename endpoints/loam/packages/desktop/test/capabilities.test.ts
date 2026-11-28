/**
 * P6-D4 (phase 6 specification, section 19, as amended 2026-11-16): the capabilities. No `core:*` and no
 * plugin JavaScript permission; the IPC allow-list is Loam's six commands (the three mount commands, from phase 5's
 * step 2 `model_send` and `model_cancel`, and from step 11b 10.8's `inbound_reply`); `invoke` of any other command an
 * app or plugin can register is refused from the main webview; Tauri's framework transport, the ACL-exempt
 * channel fetch pinned in `src-tauri/tests/acl.rs`, hands out nothing, since Loam uses no `Channel`; neither
 * frame's `invoke` runs a command, nor does one with a forged `Origin` on Tauri's message fallback or a raw IPC
 * message, though the same message, with the key, from the main frame does; and the `loam` protocol answers 404 for a path
 * reaching `mounts.json`.
 */
import { readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enterFrames, fixtureTable, leaveFrames, openView, viewDeployment } from './frames';
import { type Desktop, ORIGINS, openDesktop, untilInstance } from './harness';

const SRC_TAURI = fileURLToPath(new URL('../src-tauri/', import.meta.url));
/** What `__TAURI_INTERNALS__.invoke` answered: `ok` and its value, or the rejection's text. */
type Invoked = { ok: boolean; value: string };

let desktop: Desktop;
let linked = false;
beforeAll(async () => {
	desktop = await openDesktop({
		deployment: await viewDeployment(await fixtureTable()),
		async prepare(data) {
			try {
				symlinkSync(join(data, 'mounts.json'), join(data, 'site', 'innocent.json'));
				linked = true;
			} catch {
				// Windows without Developer Mode cannot make one; the Rust unit covers the rule there.
			}
		},
	});
	await untilInstance(desktop, 'fixture', 'ready');
}, 180_000);
afterAll(async () => {
	await desktop?.close();
});

/** `invoke` in the current frame, answered within `timeoutMs` or reported as unanswered. */
function invoke(
	command: string,
	args: Record<string, unknown> = {},
	timeoutMs = 10_000
): Promise<Invoked> {
	return desktop.browser.execute(
		async (command, args, timeoutMs) => {
			const internals = (
				window as unknown as {
					__TAURI_INTERNALS__?: { invoke?(command: string, args: unknown): Promise<unknown> };
				}
			).__TAURI_INTERNALS__;
			if (typeof internals?.invoke !== 'function') return { ok: false, value: 'no invoke' };
			try {
				const answer = await Promise.race([
					internals.invoke(command, args),
					new Promise((_, reject) => setTimeout(() => reject(new Error('unanswered')), timeoutMs)),
				]);
				return { ok: true, value: JSON.stringify(answer ?? null) };
			} catch (error) {
				return { ok: false, value: String(error) };
			}
		},
		command,
		args,
		timeoutMs
	) as Promise<Invoked>;
}

describe('P6-D4: the capabilities', () => {
	it('P6-D4 & P5-S9-1: grants no core or plugin permission, 7 commands to main and 13 setup commands to host-setup', () => {
		const file = JSON.parse(readFileSync(join(SRC_TAURI, 'capabilities/main.json'), 'utf8'));
		expect(file).toEqual({
			identifier: 'main',
			description: expect.any(String),
			local: true,
			webviews: ['main'],
			permissions: [
				'allow-mount-open',
				'allow-mount-send',
				'allow-mount-close',
				'allow-model-send',
				'allow-model-cancel',
				'allow-inbound-reply',
				'allow-setup-open',
			],
		});
		const setupFile = JSON.parse(
			readFileSync(join(SRC_TAURI, 'capabilities/host-setup.json'), 'utf8')
		);
		expect(setupFile).toEqual({
			identifier: 'host-setup',
			description: expect.any(String),
			local: true,
			webviews: ['host-setup'],
			permissions: [
				'allow-setup-state-get',
				'allow-setup-plugin-pick',
				'allow-setup-plugin-inspect-bundled',
				'allow-setup-plugin-cancel',
				'allow-setup-plugin-confirm',
				'allow-setup-plugin-uninstall',
				'allow-setup-plugin-retry-revocation',
				'allow-setup-plugin-rotate-token',
				'allow-setup-plugin-service-action',
				'allow-setup-model-save',
				'allow-setup-model-remove',
				'allow-setup-model-set-default',
				'allow-setup-apply-reload',
			],
		});
		const config = JSON.parse(readFileSync(join(SRC_TAURI, 'tauri.conf.json'), 'utf8'));
		expect(config.app.security.capabilities).toEqual(['main', 'host-setup']);
		expect(config.app.withGlobalTauri).toBe(false);
		const cargo = readFileSync(join(SRC_TAURI, 'Cargo.toml'), 'utf8');
		// Single instance and the Rust-only updater (10.6); neither has any JavaScript permission in `main.json`.
		// Only `tracing` is enabled on `tauri` (#1448), compiling out Tauri's `eprintln!` of the invoke key.
		expect(cargo.match(/^tauri-plugin-[a-z-]+/gm)).toEqual([
			'tauri-plugin-single-instance',
			'tauri-plugin-updater',
		]);
		expect(cargo).toMatch(/^tauri = \{ version = "=2\.12\.7", features = \["tracing"\] \}$/m);
		const configText = readFileSync(join(SRC_TAURI, 'tauri.conf.json'), 'utf8');
		expect(configText).not.toMatch(
			/dangerous[-_]?insecure[-_]?transport|dangerous[-_]?accept[-_]?invalid/i
		);
	});

	it('P6-D4: refuses invoke of every other command from the main webview, and the framework transport hands out nothing', async () => {
		expect(await invoke('mount_open', { instance: 'missing' })).toEqual({
			ok: false,
			value: 'INSTANCE_UNKNOWN',
		});
		for (const command of [
			'plugin:event|listen',
			'plugin:event|emit',
			'plugin:app|version',
			'plugin:window|close',
			'plugin:webview|print',
			'plugin:menu|new',
			'plugin:path|resolve_directory',
			'plugin:single-instance|anything',
			'plugin:updater|check',
			'plugin:updater|download',
			'plugin:updater|install',
			'plugin:updater|download_and_install',
			'setup_state_get',
			'setup_plugin_pick',
			'setup_plugin_inspect_bundled',
			'setup_plugin_cancel',
			'setup_plugin_confirm',
			'setup_plugin_uninstall',
			'setup_plugin_retry_revocation',
			'setup_plugin_rotate_token',
			'setup_plugin_service_action',
			'setup_model_save',
			'setup_model_remove',
			'setup_model_set_default',
			'setup_apply_reload',
			'not_a_command',
		]) {
			const answer = await invoke(command, {});
			expect(answer.ok, command).toBe(false);
			expect(answer.value, command).toMatch(/not allowed|not found|denied/i);
		}
		// Tauri's ACL-exempt channel fetch, framework transport: with no queued identifier it has nothing to give.
		const fetched = await invoke('plugin:__TAURI_CHANNEL__|fetch', {});
		expect(fetched.ok).toBe(false);
		expect(fetched.value).toMatch(/missing channel id header|data not found/);
	});

	it('P6-D4: an invoke from the loam-sandbox proxy frame or the opaque view frame inside it runs no command', async () => {
		await openView(desktop);
		// The handle counter: every `mount_open` that runs takes the next one.
		const first = await invoke('mount_open', { instance: 'fixture' });
		expect(first.ok).toBe(true);
		const seen: Record<string, unknown> = {};
		for (const inner of [false, true]) {
			await enterFrames(desktop, inner);
			const frame = inner ? 'view' : 'proxy';
			seen[frame] = {
				internals: await desktop.browser.execute(
					() => typeof (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
				),
				invoke: await invoke('mount_open', { instance: 'fixture' }, 4_000),
				fetch: await desktop.browser.execute(async () => {
					const found: Record<string, string> = {};
					for (const url of ['http://ipc.localhost/mount_open', 'ipc://localhost/mount_open']) {
						try {
							const response = await fetch(url, {
								method: 'POST',
								body: JSON.stringify({ instance: 'fixture' }),
							});
							found[url] = `answered ${response.status}`;
						} catch (error) {
							found[url] = `refused: ${(error as Error).name}`;
						}
					}
					return found;
				}),
			};
			await leaveFrames(desktop);
		}
		process.stderr.write(`P6-D4 frames on ${process.platform}: ${JSON.stringify(seen)}\n`);
		for (const frame of ['proxy', 'view']) {
			const reached = seen[frame] as { invoke: Invoked; fetch: Record<string, string> };
			expect(reached.invoke.ok, frame).toBe(false);
			for (const answer of Object.values(reached.fetch)) expect(answer, frame).toMatch(/^refused/);
		}
		const second = await invoke('mount_open', { instance: 'fixture' });
		expect(second.ok).toBe(true);
		expect(Number(second.value)).toBe(Number(first.value) + 1);
		for (const handle of [first.value, second.value])
			await invoke('mount_close', { handle: Number(handle) });
	});

	it("P6-D4: a frame's invoke with a forged Origin, through Tauri's postMessage fallback, and its raw IPC messages run no command", async () => {
		// On Tauri's postMessage fallback the request's headers are the caller's, so `from_shell`'s `Origin` check
		// is no barrier there; the barriers are what each engine delivers from a frame and Tauri's invoke key.
		// On WebView2 a frame has Tauri's IPC script, so once its IPC fetch is refused (the test above) its
		// `invoke` falls back with the real key and the forged `Origin` below, and would pass `from_shell` if it
		// arrived. The raw messages carry a forged `Origin` and no valid key, so on their own they show only that
		// the key holds.
		await openView(desktop);
		const first = await invoke('mount_open', { instance: 'fixture' });
		expect(first.ok).toBe(true);
		const seen: Record<string, Record<string, string>> = {};
		for (const inner of [false, true]) {
			await enterFrames(desktop, inner);
			seen[inner ? 'view' : 'proxy'] = (await desktop.browser.execute(async (shell) => {
				const page = window as unknown as {
					__TAURI_INTERNALS__?: {
						invoke?(command: string, args: unknown, options: unknown): Promise<unknown>;
					};
					ipc?: { postMessage?(message: string): void };
					chrome?: { webview?: { postMessage?(message: string): void } };
					webkit?: { messageHandlers?: { ipc?: { postMessage?(message: string): void } } };
				};
				const found: Record<string, string> = {};
				const headers = { Origin: shell };
				const internals = page.__TAURI_INTERNALS__;
				if (typeof internals?.invoke === 'function') {
					try {
						await Promise.race([
							internals.invoke('mount_open', { instance: 'fixture' }, { headers }),
							new Promise((_, reject) => setTimeout(() => reject(new Error('unanswered')), 4_000)),
						]);
						found.invoke = 'answered';
					} catch (error) {
						found.invoke = String(error);
					}
				} else found.invoke = 'no invoke';
				const message = JSON.stringify({
					cmd: 'mount_open',
					callback: 1,
					error: 2,
					payload: { instance: 'fixture' },
					options: { headers },
					__TAURI_INVOKE_KEY__: 'forged',
				});
				const posts: Array<[string, (() => void) | undefined]> = [
					['window.ipc', page.ipc?.postMessage && (() => page.ipc?.postMessage?.(message))],
					[
						'chrome.webview',
						page.chrome?.webview?.postMessage &&
							(() => page.chrome?.webview?.postMessage?.(message)),
					],
					[
						'webkit.messageHandlers.ipc',
						page.webkit?.messageHandlers?.ipc?.postMessage &&
							(() => page.webkit?.messageHandlers?.ipc?.postMessage?.(message)),
					],
				];
				for (const [name, post] of posts) {
					if (!post) {
						found[name] = 'absent';
						continue;
					}
					try {
						post();
						found[name] = 'posted';
					} catch (error) {
						found[name] = `threw ${(error as Error).name}`;
					}
				}
				// Time for a delivered message to run before the count below.
				await new Promise((resolve) => setTimeout(resolve, 1_000));
				return found;
			}, ORIGINS.shell)) as Record<string, string>;
			await leaveFrames(desktop);
		}
		process.stderr.write(`P6-D4 forged frames on ${process.platform}: ${JSON.stringify(seen)}\n`);
		// A frame's own answer proves nothing: the fallback answers by `eval` in the top-level document, so a
		// frame's promise never settles either way. The handle counter is the oracle: no message from either
		// frame ran `mount_open`.
		const second = await invoke('mount_open', { instance: 'fixture' });
		expect(second.ok).toBe(true);
		expect(Number(second.value)).toBe(Number(first.value) + 1);
		for (const handle of [first.value, second.value])
			await invoke('mount_close', { handle: Number(handle) });
	});

	it("P6-D4: from the main frame, Tauri's postMessage fallback runs a command whose Origin is forged, and nothing without the shell's Origin or the invoke key", async () => {
		// The control for the test above, whose still counter means something only if a delivered keyed message
		// would move it. Here the main frame, whose posts every engine delivers, sends what a frame holding the key
		// could. With the invoke key and a forged `Origin` it runs, so `from_shell` is no barrier on the fallback
		// and the frames' result measures what reaches the host and the key. Without an `Origin` `from_shell`
		// refuses it, and with a wrong key Tauri drops it unanswered. Each handle is closed as soon as it is known,
		// to stay under the instance's handle limit; the counter does not go back.
		const answers = (await desktop.browser.execute(
			async (shell, timeoutMs) => {
				const page = window as unknown as {
					__TAURI_INTERNALS__: {
						invoke(command: string, args: unknown): Promise<unknown>;
						transformCallback(callback: (value: unknown) => void, once: boolean): number;
					};
					ipc: { postMessage(message: string): void };
				};
				const internals = page.__TAURI_INTERNALS__;
				// The key, from the shell's own IPC fetch, as a frame on WebView2 can read it from its own.
				const fetched = window.fetch;
				let key = '';
				window.fetch = (input, init) => {
					const found = new Headers(init?.headers).get('Tauri-Invoke-Key');
					if (found) key = found;
					return fetched.call(window, input, init);
				};
				let first: unknown;
				try {
					first = await internals.invoke('mount_open', { instance: 'fixture' });
				} finally {
					window.fetch = fetched;
				}
				await internals.invoke('mount_close', { handle: first });
				const post = (headers: Record<string, string>, invokeKey: string) =>
					new Promise<string>((resolve) => {
						const timer = setTimeout(() => resolve('unanswered'), timeoutMs);
						const settle = (outcome: string) => async (value: unknown) => {
							clearTimeout(timer);
							const answer = `${outcome} ${JSON.stringify(value)}`;
							// Close before resolving, so the next post runs under the handle limit; a failed
							// close fails the assertion with its cause instead of hanging the script.
							if (outcome === 'ok') {
								try {
									await internals.invoke('mount_close', { handle: value });
								} catch (cause) {
									resolve(`${answer}, not closed: ${String(cause)}`);
									return;
								}
							}
							resolve(answer);
						};
						page.ipc.postMessage(
							JSON.stringify({
								cmd: 'mount_open',
								callback: internals.transformCallback(settle('ok'), true),
								error: internals.transformCallback(settle('error'), true),
								payload: { instance: 'fixture' },
								options: { headers },
								__TAURI_INVOKE_KEY__: invokeKey,
							})
						);
					});
				return {
					first: String(first),
					keyed: key !== '',
					forged: await post({ Origin: shell }, key),
					bare: await post({}, key),
					unkeyed: await post({ Origin: shell }, 'forged'),
				};
			},
			ORIGINS.shell,
			2_000
		)) as { first: string; keyed: boolean; forged: string; bare: string; unkeyed: string };
		process.stderr.write(
			`P6-D4 main-frame fallback on ${process.platform}: ${JSON.stringify(answers)}\n`
		);
		const first = Number(answers.first);
		expect(answers.keyed).toBe(true);
		expect(answers.forged).toBe(`ok ${first + 1}`);
		expect(answers.bare).toBe('error "DESKTOP_ORIGIN_REFUSED"');
		expect(answers.unkeyed).toBe('unanswered');
		// The counter: the forged message alone ran `mount_open`.
		const last = await invoke('mount_open', { instance: 'fixture' });
		try {
			expect(last.ok).toBe(true);
			expect(Number(last.value)).toBe(first + 2);
		} finally {
			if (last.ok) await invoke('mount_close', { handle: Number(last.value) });
		}
		// #1448: Tauri's invoke-key refusal must never leak an unredacted key to stderr.
		expect(desktop.stderr.lines.join('\n')).not.toMatch(/__TAURI_INVOKE_KEY__ expected (?!<key>)/);
	});

	it('P6-D4: the loam protocol answers 404 for a path reaching mounts.json, encoded or through a symbolic link', async () => {
		const answers = await desktop.browser.execute(async () => {
			const paths = [
				'/../mounts.json',
				'/%2e%2e/mounts.json',
				'/%2E%2E/mounts.json',
				'/..%2fmounts.json',
				'/%2e%2e%2fmounts.json',
				'/..%5cmounts.json',
				'/%2e%2e%5cmounts.json',
				'/assets/%2e%2e/%2e%2e/mounts.json',
				'/mounts.json',
				'/innocent.json',
			];
			const out: Record<string, string> = {};
			for (const path of paths) {
				const response = await fetch(path);
				const body = await response.text();
				out[path] = `${response.status}${body.includes('"mounts"') ? ' LEAKED' : ''}`;
			}
			return out;
		});
		for (const [path, answer] of Object.entries(answers)) expect(answer, path).toBe('404');
		if (!linked)
			process.stderr.write(
				`P6-D4: no symbolic link could be made on ${process.platform}; the Rust unit covers it.\n`
			);
	});
});
