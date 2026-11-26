/**
 * @fileoverview The test provider's scripts (phase 5 specification, Jobs and scenarios): a message beginning
 * `script:<name>` plays `<name>`, one entry per model round; any other text answers "No script" with no tool call.
 * Every scenario's model is scripted, so a file shows what Loam does with a model's choices, never whether a model
 * chooses well. Each script is the one its scenario file's header describes.
 */

import {
	createTestProvider,
	type ModelScriptV1,
	type TestProviderV1,
} from '@lushly-dev/loam-copilot/test-provider';

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

/** The first part, at any depth, with a sender's name in `from` and a `text`: a unit's message part. */
function messageIn(value: unknown): { name: string; text: string } | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const { from, text } = value as { from?: { name?: unknown }; text?: unknown };
	if (typeof from?.name === 'string' && typeof text === 'string') return { name: from.name, text };
	for (const each of Object.values(value)) {
		const found = messageIn(each);
		if (found) return found;
	}
	return undefined;
}

/**
 * The test provider's unit composers (7.3), by name: a request whose system prompt is Loam's composer prompt is
 * answered by one, given the composer's one message. `echo-unit` greets the unit's sender by the name its message part
 * gives and repeats the question it was given, so a reply that names anyone else shows a leak between units. It reads
 * the parts of each `<loam-content>` block by key, whatever their order: the desktop's Rust host passes a mounted
 * result on with its keys sorted.
 */
export const UNIT_SCRIPTS: Readonly<Record<string, (text: string) => string>> = Object.freeze({
	'echo-unit': (text: string) => {
		// As given, and with its quotes unescaped once, for a block that arrives inside a string.
		for (const given of [text, text.replaceAll('\\"', '"')])
			for (const [, block] of given.matchAll(/<loam-content[^>]*>([\s\S]*?)<\/loam-content/g)) {
				try {
					const found = messageIn(JSON.parse(block ?? ''));
					if (found) return `Dear ${found.name}, you asked: ${found.text}`;
				} catch {
					// Not JSON: no part to read.
				}
			}
		return 'Dear sender,';
	},
});

/**
 * The test provider every place runs the scenarios on (P5-A1): the scripts above, with `extra` beside them, and the
 * `echo-unit` composer unless `compose` names another. The kernel's seed calls it in this process (`seeds.ts`),
 * Chromium's runner in the page, and the desktop's behind a local provider the Rust host reaches
 * (`desktop/test/fixtures/scenario-model.ts`).
 */
export function createScenarioProvider(
	options: {
		extra?: Readonly<Record<string, ModelScriptV1>>;
		compose?: (text: string) => string;
		delayMs?: number;
	} = {}
): TestProviderV1 {
	return createTestProvider({
		scripts: { ...MODEL_SCRIPTS, ...options.extra },
		compose: options.compose ?? UNIT_SCRIPTS['echo-unit'],
		...(options.delayMs !== undefined ? { delayMs: options.delayMs } : {}),
	});
}
