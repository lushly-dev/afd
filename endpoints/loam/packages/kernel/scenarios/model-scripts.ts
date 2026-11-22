/**
 * @fileoverview The test provider's scripts (phase 5 specification, Jobs and scenarios): a message beginning
 * `script:<name>` plays `<name>`, one entry per model round; any other text answers "No script" with no tool call.
 * Every scenario's model is scripted, so a file shows what Loam does with a model's choices, never whether a model
 * chooses well. Each script is the one its scenario file's header describes.
 */

import type { ModelScriptV1 } from '@lushly-dev/loam-copilot/test-provider';

export const MODEL_SCRIPTS: Readonly<Record<string, ModelScriptV1>> = Object.freeze({
	/** Stop the copilot: the model holds its answer until the turn is stopped. */
	hang: [{ hang: true }],
	/** Have the copilot do it with commands: a project, then a note in it, then a one-line reply. */
	'new-project-note': [
		{ tools: [{ name: 'project-create', input: { name: 'Garden' } }] },
		{
			tools: [
				{
					name: 'document-create',
					input: { type: 'checklist', title: 'Seed order', project: 'garden' },
				},
			],
		},
		{ text: 'Created the Garden project with a Seed order note.' },
	],
	/** Only suggest where I said so: `tally-reset`, which p5-base sets to suggest. */
	'reset-tally': [
		{ tools: [{ name: 'tally-reset', input: {} }] },
		{ text: 'Asked to reset the tally.' },
	],
	/** Keep a stranger's mail from acting elsewhere: a model that obeyed thr_2. */
	'obey-thr-2': [
		{ tools: [{ name: 'mailfix-thread-open', input: { thread: 'thr_2' } }] },
		{ tools: [{ name: 'project-create', input: { name: 'payroll' } }] },
		{ tools: [{ name: 'tally-reset', input: {} }] },
		{ text: 'Done what the message asked.' },
	],
	/** Archiving in mail itself still follows the mail setting. */
	'archive-thr-2': [
		{ tools: [{ name: 'mailfix-thread-archive', input: { thread: 'thr_2' } }] },
		{ text: 'Archived it.' },
	],
	/** Approve a send in the shell: read, draft, then ask to send with the id and revision mailfix gives. */
	'reply-thr-1': [
		{ tools: [{ name: 'mailfix-thread-open', input: { thread: 'thr_1' } }] },
		{
			tools: [
				{
					name: 'mailfix-draft-create',
					input: { thread: 'thr_1', body: 'Thanks, Thursday works.' },
				},
			],
		},
		{ tools: [{ name: 'mailfix-draft-send', input: { draft: 'drf_1', revision: 1 } }] },
		{ text: 'The reply is waiting for your approval.' },
	],
	/** Compose each reply from its own message: the reply set's units, twice. */
	'compose-rs-1': [
		{ tools: [{ name: 'mailfix-replyset-next', input: { replyset: 'rs_1' } }] },
		{ tools: [{ name: 'mailfix-replyset-next', input: { replyset: 'rs_1' } }] },
		{ text: 'Both replies are composed.' },
	],
});
