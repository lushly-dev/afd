/**
 * @fileoverview `kernel/src/apps/`: reading a deployment's packages (phase 1 specification, sections 3,
 * 4, 5 and 10). Imported dynamically, and only when a deployment lists an app. One app's failure never
 * stops the shell or another app: each outcome is a record.
 */

import type { CommandContext, CommandError, CommandResult } from '@lushly-dev/afd-core';
import type { ZodCommandDefinition } from '@lushly-dev/afd-server/define';
import {
	type ManifestV1,
	NOTICES_V1,
	type ProjectionAppV1,
	SHELL_DOMAINS_V1,
} from '@lushly-dev/loam-manifest';
import { readManifest } from '@lushly-dev/loam-manifest/validate';
import type { AppDefinitionV1 } from '@lushly-dev/loam-sdk';
import type { AppsRuntime, CommandOwner } from '../apps-runtime.js';
import { kernelFailure, LoamKernelError } from '../errors.js';
import { type AppKeybinding, needsInput } from '../keybindings.js';
import type { AppPortV1, KernelPortsV1 } from '../types.js';
import { defineAppCommand, type ManifestCommand, visibilityOf } from './definitions.js';
import {
	baseRecord,
	configRefusal,
	DomainHolders,
	errorOf,
	firstLayout,
	kindRefusal,
	MOUNTED_KEYS,
	refusalError,
	transportOf,
} from './entry.js';
import { createFrameHost, type FrameHost } from './handler-frame.js';
import { createNativeHost, type NativeHost } from './native.js';
import { type AppRecord, createOperations, createRefusalCommands } from './operations.js';
import { createAppPort, packageFile } from './port.js';
import { pageDecided } from './support.js';
import type { AppsHost } from './types.js';

export {
	CALL_META_KEY,
	HANDLER_CALL_TIMEOUT_MS,
	HANDLER_READY_TIMEOUT_MS,
	toolCallResult,
} from './handler-frame.js';
export type { AppsHost } from './types.js';

const NO_PORTS: KernelPortsV1 = {
	baseUrl: 'http://loam.invalid/',
	fetchJson: () => Promise.reject(new Error('The host gave the kernel no ports')),
	fetchText: () => Promise.reject(new Error('The host gave the kernel no ports')),
	importNative: () => Promise.reject(new Error('The host gave the kernel no ports')),
	openHandlerFrame: () => Promise.reject(new Error('The host gave the kernel no ports')),
	mountTransport: () => Promise.reject(new Error('The host gave the kernel no ports')),
};
/** Read every package, in parallel, then decide in deployment order, since the later holder loses. */
export async function loadApps(host: AppsHost): Promise<AppsRuntime> {
	const { deployment } = host;
	const ports = host.ports ?? NO_PORTS;
	const records = new Map<string, AppRecord>();
	const commands: ZodCommandDefinition[] = createRefusalCommands();
	const owners = new Map<string, CommandOwner>();
	const keybindings: AppKeybinding[] = [];
	const chords = new Map<string, string>();
	const domains = new DomainHolders(new Set(SHELL_DOMAINS_V1));
	const hosts: Array<{ dispose(): void | Promise<void> }> = [];
	const originOf = (url: string): string | undefined => {
		try {
			return new URL(url).origin;
		} catch {
			return undefined;
		}
	};
	const shellOrigin = originOf(ports.baseUrl);

	const packageUrlOf = (entry: ProjectionAppV1): string =>
		new URL(entry.package, ports.baseUrl).href;
	const raws = await Promise.all(
		deployment.apps.map(async (entry) => {
			try {
				const url = new URL('app-manifest.json', packageUrlOf(entry)).href;
				return { raw: await ports.fetchJson(url) };
			} catch (cause) {
				return { unavailable: cause instanceof Error ? cause.message : String(cause) };
			}
		})
	);

	/** Add a record with no commands: refused, or a mounted instance's `failed`. */
	function settle(record: AppRecord, state: 'refused' | 'failed', error: CommandError): void {
		record.state = state;
		record.error = error;
		records.set(record.instance, record);
	}

	function hostFor(
		record: AppRecord,
		manifest: ManifestV1,
		packageUrl: string,
		config: Readonly<Record<string, unknown>>,
		granted: ReadonlySet<string>
	): { port: AppPortV1; invoke: NativeHost['invoke'] } {
		const names = (manifest.commands ?? []).map((command) => command.name);
		let native: NativeHost | undefined;
		const { port, nestedClient } = createAppPort({
			record,
			manifest,
			config,
			packageUrl,
			host,
			ports,
			granted,
			load(): Promise<AppDefinitionV1> {
				if (native) return native.load();
				return Promise.reject(
					new LoamKernelError({
						code: 'APP_NOT_READY',
						message: `A ${record.kind} app has no module in the page`,
						suggestion: 'Only a native app is imported',
					})
				);
			},
		});
		if (record.kind === 'native') {
			const entryPath = manifest.native?.entry;
			native = createNativeHost({
				record,
				host,
				ports,
				entryUrl: entryPath === undefined ? undefined : packageFile(packageUrl, entryPath),
				config,
				granted,
				commands: names,
				nestedClient,
			});
			return { port, invoke: native.invoke };
		}
		const frame: FrameHost = createFrameHost({
			record,
			host,
			ports,
			config,
			granted,
			commands: names,
			readHandlersHtml: () => port.readResource(manifest.view?.handlers ?? ''),
			visibleToApp(name) {
				const command = manifest.commands?.find((candidate) => candidate.name === name);
				const visibility = command === undefined ? undefined : visibilityOf(command);
				return visibility === undefined || visibility.includes('app');
			},
			nestedClient,
		});
		hosts.push(frame);
		return { port, invoke: frame.invoke };
	}

	/** Guard each call on the app's state, and set the state for a call into a failed app (10). */
	const gated =
		(record: AppRecord, name: string, invoke: NativeHost['invoke']) =>
		(input: unknown, context: CommandContext): Promise<CommandResult> => {
			if (record.state === 'failed' || record.state === 'loading') {
				return Promise.resolve(
					kernelFailure(
						'APP_NOT_READY',
						`The app '${record.instance}' is ${record.state}, so '${name}' cannot run`,
						record.state === 'loading'
							? 'Retry once app-instance-list says it is ready'
							: (record.error?.suggestion ?? 'Fix the app'),
						{
							retryable: record.state === 'loading',
							details: pageDecided(record.error !== undefined ? { cause: record.error.code } : {}),
						}
					)
				);
			}
			return invoke(name, input, context);
		};

	function admit(record: AppRecord, entry: ProjectionAppV1, manifest: ManifestV1) {
		const { kind } = record;
		const refusal =
			(kind !== 'mounted' && entry.instance !== entry.app
				? errorOf(
						'DEPLOYMENT_INSTANCE_MISMATCH',
						`Instance \`${entry.instance}\` of a native or view app must be named \`${entry.app}\`.`,
						`Rename the table \`[apps.${entry.app}]\`. A mounted instance names itself, with \`audience\`.`
					)
				: undefined) ?? configRefusal(entry, manifest);
		if (refusal) return settle(record, 'refused', refusal);

		if (kind === 'mounted') {
			const transport = transportOf(entry, manifest);
			record.notices.push({
				code: 'MOUNT_ANNOTATIONS_UNTRUSTED',
				message: NOTICES_V1.MOUNT_ANNOTATIONS_UNTRUSTED,
			});
			if (entry.audience === 'team') {
				record.notices.push({
					code: 'TEAM_INSTANCE_SINGLE_PRINCIPAL',
					message: NOTICES_V1.TEAM_INSTANCE_SINGLE_PRINCIPAL,
				});
			}
			if (transport === 'stdio') {
				record.notices.push({ code: 'STDIO_TRUSTED_CODE', message: NOTICES_V1.STDIO_TRUSTED_CODE });
			}
			return settle(
				record,
				'failed',
				errorOf(
					'MOUNT_TRANSPORT_UNAVAILABLE',
					transport === 'stdio'
						? 'A browser host cannot start a process, so a `stdio` instance cannot run here.'
						: 'This kernel does not discover mounted instances yet: phase 1 step 7 adds it.',
					transport === 'stdio'
						? 'Use `http`, or the desktop or hosted lane.'
						: 'Wait for phase 1 step 7, which serves the route `mounts/<instance>/mcp`.'
				)
			);
		}

		const held = (manifest.commands ?? []).find((command) => host.taken.has(command.name));
		if (held) {
			return settle(
				record,
				'refused',
				errorOf(
					'APP_COMMAND_CONFLICT',
					`The shell already holds the command \`${held.name}\`.`,
					'Rename the command, or the app.',
					{ command: held.name }
				)
			);
		}

		const packageUrl = packageUrlOf(entry);
		const config = Object.freeze({ ...(entry.config ?? {}) });
		const granted = new Set(
			record.detail.grants.filter((grant) => grant.served).map((grant) => grant.name)
		);
		const { port, invoke } = hostFor(record, manifest, packageUrl, config, granted);
		let definitions: ZodCommandDefinition[];
		try {
			definitions = (manifest.commands ?? []).map((command: ManifestCommand) =>
				defineAppCommand(command, manifest.plugin.version, gated(record, command.name, invoke))
			);
		} catch (cause) {
			return settle(
				record,
				'refused',
				errorOf(
					'MANIFEST_INPUT_SCHEMA_INVALID',
					`A command's schema cannot be used: ${cause instanceof Error ? cause.message : String(cause)}`,
					'Use the JSON Schema keywords `loam app check` accepts.'
				)
			);
		}

		for (const definition of definitions) {
			commands.push(definition);
			owners.set(definition.name, { app: entry.app, instance: entry.instance });
		}
		const needing = new Map(
			definitions.map((definition) => [definition.name, definition.jsonSchema])
		);
		for (const { chord, command } of manifest.ui?.surfaces?.keybindings ?? []) {
			const holder = chords.get(chord);
			if (holder !== undefined) {
				record.notices.push({
					code: 'KEYBINDING_CONFLICT',
					message: `The chord ${chord} is held by \`${holder}\`, so this app's binding is refused. Choose another chord.`,
				});
			} else if (needsInput(needing.get(command))) {
				record.notices.push({
					code: 'KEYBINDING_NEEDS_INPUT',
					message: `The chord ${chord} is not bound: \`${command}\` needs input, and a chord runs only a command that does not.`,
				});
			} else {
				chords.set(chord, entry.instance);
				keybindings.push({ chord, command, instance: entry.instance });
			}
		}
		record.port = port;
		record.commands = definitions.map((definition) => definition.name);
		records.set(entry.instance, record);

		if (kind === 'view') {
			const origin = deployment.sandbox_origin;
			const sandboxOrigin = origin ? originOf(origin) : undefined;
			if (sandboxOrigin === undefined || sandboxOrigin === shellOrigin) {
				record.state = 'failed';
				record.error = errorOf(
					'VIEW_SANDBOX_ORIGIN_INVALID',
					origin
						? "The sandbox's origin is the shell's own, and a view needs a second one."
						: 'A view app needs a sandbox on a second origin.',
					'Deploy `dist/sandbox/` on a second origin and set `[sandbox] origin`.'
				);
			}
		}
	}

	/** One entry, in deployment order. */
	const loadEntry = (entry: ProjectionAppV1, index: number) => {
		const raw = raws[index] as { raw?: unknown; unavailable?: string };
		const read = raw.unavailable === undefined ? readManifest(raw.raw) : undefined;
		const manifest = read?.ok ? read.manifest : undefined;
		const { initial, declared } = firstLayout(manifest);
		host.state.registerAppLayout(entry.instance, initial, declared);
		// Every entry claims its domain, whatever else refuses it, as `deployment check` has it (D66).
		const mounted = manifest
			? manifest.plugin.kind === 'mounted'
			: MOUNTED_KEYS.some((key) => entry[key] !== undefined);
		const claim = mounted ? domains.claimPrefix(entry, manifest) : domains.claimApp(entry);

		if (read === undefined) {
			settle(
				baseRecord(entry, undefined, undefined),
				'refused',
				errorOf(
					'APP_PACKAGE_UNAVAILABLE',
					`The package of \`${entry.instance}\` cannot be read: ${raw.unavailable}`,
					'Run `loam deployment write`, which copies each package.'
				)
			);
			return;
		}
		if (!read.ok) {
			const rawKind = (raw.raw as { plugin?: { kind?: unknown } } | undefined)?.plugin?.kind;
			const record = baseRecord(entry, undefined, rawKind);
			record.warnings.push(...read.warnings);
			settle(record, 'refused', refusalError(read.refusals));
			return;
		}
		const record = baseRecord(entry, read.manifest, undefined);
		record.warnings.push(...read.warnings);
		const refusal = kindRefusal(entry, read.manifest) ?? claim;
		if (refusal) {
			settle(record, 'refused', refusal);
			return;
		}
		admit(record, entry, read.manifest);
	};
	deployment.apps.forEach((entry, index) => {
		try {
			loadEntry(entry, index);
		} catch (cause) {
			// One app's failure never stops the shell or another app (D66).
			settle(
				baseRecord(entry, undefined, undefined),
				'refused',
				errorOf(
					'MANIFEST_INVALID',
					`The app could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
					'Run `loam app check` on it.'
				)
			);
		}
	});

	return {
		...createOperations(records, host),
		commands,
		owners,
		keybindings,
		async dispose() {
			await Promise.allSettled(hosts.map((held) => held.dispose()));
		},
	};
}
