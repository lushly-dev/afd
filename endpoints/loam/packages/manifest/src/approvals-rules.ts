/**
 * @fileoverview A mounted entry's `approvals` and its commands' `preview` (Loam phase 5 specification, 7.2; D146): the
 * deployer opts an instance in, and names, for each command the shell may release, a read of the same instance that
 * shows the person what it will do. What the reader checks here, before anything runs; the rest (which commands the
 * server holds, and whether a preview is a read) is known only from discovery, where the kernel refuses the release.
 *
 * `deployment check` cannot see which commands a server holds for approval, so its rule is the one a file can show: an
 * `approvals = "shell"` entry that names no command with a preview releases nothing, and a preview on an entry that
 * releases nothing, or naming the command it previews, is a mistake.
 */

import type { DeploymentRefusal } from './types.js';

/** What the reader reads of an entry here. */
interface ApprovalsEntry {
	approvals?: 'none' | 'shell';
	commands?: Readonly<
		Record<string, { preview?: { command: string; input: readonly string[] } } | undefined>
	>;
}

type Refuse = (
	code: Extract<
		DeploymentRefusal['code'],
		'DEPLOYMENT_PREVIEW_REQUIRED' | 'DEPLOYMENT_PREVIEW_INVALID'
	>,
	pointer: string,
	message: string,
	suggestion: string
) => void;

/** The keys of a preview, as the file names them, for a pointer. */
const commandPointer = (name: string, key = ''): string =>
	`/commands/${name.replaceAll('~', '~0').replaceAll('/', '~1')}${key}`;

export const PREVIEW_SHAPE =
	'`commands."<name>".preview = { command = "<a read of this instance>", input = ["<key>", …] }`';

/** 7.2's rules a file can show: refused with the key and a suggestion, as every reader's refusal is. */
export function approvalsRefusals(entry: ApprovalsEntry, refuse: Refuse): void {
	const shell = entry.approvals === 'shell';
	const previewed = Object.entries(entry.commands ?? {}).filter(
		(pair): pair is [string, { preview: { command: string; input: readonly string[] } }] =>
			pair[1]?.preview !== undefined
	);
	if (shell && previewed.length === 0) {
		refuse(
			'DEPLOYMENT_PREVIEW_REQUIRED',
			'/approvals',
			'`approvals = "shell"` releases only a command that names a preview, and this instance names none, so a command the server holds for approval could never run from Loam.',
			`Give each command the server holds for a person's approval a preview, ${PREVIEW_SHAPE}, or set \`approvals = "none"\`.`
		);
	}
	for (const [name, { preview }] of previewed) {
		if (!shell) {
			refuse(
				'DEPLOYMENT_PREVIEW_INVALID',
				commandPointer(name, '/preview'),
				'A preview is shown only when the shell releases the command, and this instance does not say `approvals = "shell"`.',
				'Set `approvals = "shell"` on this instance, or remove `preview`.'
			);
		} else if (preview.command === name) {
			refuse(
				'DEPLOYMENT_PREVIEW_INVALID',
				commandPointer(name, '/preview/command'),
				'A preview names a read that shows what the command will do, not the command itself.',
				`Name a read of the same instance, such as the one that shows the draft a send sends: ${PREVIEW_SHAPE}.`
			);
		}
	}
}
