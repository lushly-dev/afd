/**
 * @fileoverview What a host's runner needs to build `p5-base` through its own deployment and commands (phase 5
 * specification, Jobs and scenarios; P5-A1), where the kernel's units build it in this process (`seeds.ts`): the
 * seed's autonomy rows and calls, `mailfix`'s deployment entry as TOML, and the packages of `mailfix` and `mailfixapp`,
 * written from the same manifests the kernel's seed serves (`mailfix-mount.ts`), so the three places cannot drift.
 *
 * Chromium (`web/test/browser/scenarios.test.ts`) and the desktop suite (`desktop/test/scenarios.test.ts`) read it. It
 * imports nothing of the kernel's sources, so a host's runner loads none of them.
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	MAILFIX_MANIFEST,
	MAILFIX_NAMED,
	MAILFIX_SEND_PREVIEW,
	MAILFIXAPP_MANIFEST,
} from './mailfix-mount.js';

/**
 * `p5-base`'s autonomy rows (6.1), each the person's own workspace write: `act` for the shell's `project-create` and
 * `document-create`, for `tally-add` and for mailfix's archive and draft; `suggest` for `tally-reset`. Set once
 * `mailfix`'s discovery has settled, since two of them name its commands.
 */
export const P5_AUTONOMY: ReadonlyArray<
	readonly [instance: string, command: string, mode: 'act' | 'suggest']
> = Object.freeze([
	['shell', 'project-create', 'act'],
	['shell', 'document-create', 'act'],
	['tally', 'tally-add', 'act'],
	['tally', 'tally-reset', 'suggest'],
	['mailfix', 'mailfix-thread-archive', 'act'],
	['mailfix', 'mailfix-draft-create', 'act'],
] as const);

/**
 * `p4-base`'s calls, which `p5-base` keeps, read from its seed file (`docs/phases/4-settings/scenarios/p4-base.seed.json`,
 * as `seeds.ts` reads it): tally's count of 3. A host runs them as the person, before the rows. The seed's fixed
 * projects and documents are written to the store before the kernel starts, which a host's shell cannot do; no slice
 * file reads them.
 */
export const P5_HOST_CALLS: ReadonlyArray<{ command: string; input: unknown }> = Object.freeze(
	(
		JSON.parse(
			readFileSync(
				fileURLToPath(
					new URL('../../../docs/phases/4-settings/scenarios/p4-base.seed.json', import.meta.url)
				),
				'utf8'
			)
		) as { calls: Array<{ command: string; input: unknown }> }
	).calls
);

/**
 * A value as TOML: every table inline, on one line, and every key quoted, which TOML 1.0 reads as the JSON it came
 * from. Enough for a manifest, whose values are strings, numbers, booleans, arrays and tables.
 */
export function tomlOf(value: unknown): string {
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) return `[${value.map(tomlOf).join(', ')}]`;
	if (value && typeof value === 'object')
		return `{ ${Object.entries(value)
			.map(([key, item]) => `${JSON.stringify(key)} = ${tomlOf(item)}`)
			.join(', ')} }`;
	throw new Error(`No TOML for ${String(value)}`);
}

/** A manifest file's text: each top-level key on its own line. */
const manifestText = (manifest: Record<string, unknown>): string =>
	`${Object.entries(manifest)
		.map(([key, value]) => `${key} = ${tomlOf(value)}`)
		.join('\n')}\n`;

/**
 * `mailfixapp`'s definition as the module its package serves (`MAILFIXAPP_DEFINITION`, `mailfix-mount.ts`): the same
 * three handlers, written without the SDK, whose `defineApp` and `success` return what they are given.
 */
const MAILFIXAPP_NATIVE = `// mailfixapp, the scenarios' fixture app over mailfix (Loam's kernel/scenarios/mailfix-mount.ts).
const textOf = (data) => String(data?.messages?.[0]?.content?.text ?? '');
const peek = (command) => async (input, context) => {
	const read = await context.client.call(command, { thread: input.thread });
	if (!read.success) return read;
	return { success: true, data: { text: textOf(read.data) } };
};
export default {
	sdk: 1,
	handlers: {
		'mailfixapp-thread-peek': peek('mailfix-thread-open'),
		'mailfixapp-client-keep': async () => ({ success: true, data: { kept: true } }),
		'mailfixapp-other-peek': peek('mailfixb-thread-open'),
	},
};
`;

/**
 * Write `mailfix`'s and `mailfixapp`'s packages under `directory`, for `loam app pack`: `mailfix` over `transport`
 * (`http` in Chromium, `stdio` on the desktop) and `mailfixapp` with its `calls` grant (7.5). Returns each directory.
 */
export async function writeMailfixPackages(
	directory: string,
	transport: 'http' | 'stdio'
): Promise<{ mailfix: string; mailfixapp: string }> {
	const mailfix = join(directory, 'mailfix');
	const mailfixapp = join(directory, 'mailfixapp');
	await mkdir(mailfix, { recursive: true });
	await mkdir(join(mailfixapp, 'dist'), { recursive: true });
	const mounted = MAILFIX_MANIFEST as unknown as Record<string, unknown> & {
		mount: Record<string, unknown>;
	};
	await writeFile(
		join(mailfix, 'loam-app.toml'),
		manifestText({
			...mounted,
			afd_contract: '1.0',
			mount: { ...mounted.mount, transport },
			app: { scope_levels: ['workspace', 'project'] },
		})
	);
	await writeFile(
		join(mailfixapp, 'loam-app.toml'),
		manifestText({
			...(MAILFIXAPP_MANIFEST as unknown as Record<string, unknown>),
			afd_contract: '1.0',
		})
	);
	await writeFile(join(mailfixapp, 'dist', 'native.js'), MAILFIXAPP_NATIVE);
	return { mailfix, mailfixapp };
}

/**
 * `mailfix`'s entry in a deployment file, as `mailfixEntry` lists it in the projection (`mailfix-mount.ts`): `labels =
 * "per-part"`, `approvals = "shell"`, and each command `MAILFIX_NAMED` names with its exposure, the send with its
 * preview. `transport` holds the entry's transport keys (`url` or `command`); `packageDirectory` is `mailfix`'s packed
 * package.
 */
export function mailfixEntryToml(packageDirectory: string, transport: string[]): string[] {
	return [
		'[apps.mailfix]',
		'app = "mailfix"',
		`package = ${JSON.stringify(packageDirectory)}`,
		'prefix = "mailfix"',
		'audience = "person"',
		...transport,
		'labels = "per-part"',
		'approvals = "shell"',
		'',
		...Object.entries(MAILFIX_NAMED).flatMap(([name, expose]) => [
			`[apps.mailfix.commands.${JSON.stringify(name)}]`,
			`expose = ${tomlOf(expose)}`,
			...(name === 'mailfix-draft-send'
				? [
						`preview = ${tomlOf({ command: MAILFIX_SEND_PREVIEW.command, input: [...MAILFIX_SEND_PREVIEW.input] })}`,
					]
				: []),
			'',
		]),
	];
}

/** `mailfixapp`'s entry in a deployment file. */
export const mailfixappEntryToml = (packageDirectory: string): string[] => [
	'[apps.mailfixapp]',
	'app = "mailfixapp"',
	`package = ${JSON.stringify(packageDirectory)}`,
	'',
];
