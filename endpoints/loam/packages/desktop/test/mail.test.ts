/**
 * P5-A9 on the desktop (phase 5 specification, 8 and 18; step 7): the real `loam-mail` engine, mounted by hand as
 * its README's step 4 writes the entry, against its scripted IMAP and SMTP servers (`fixtures/mail-engine.ts`), with
 * `mailapp`, the mail app, beside it. The copilot runs in its production frame on a scripted model
 * (`fixtures/mail-model.ts`) that reaches the provider through the Rust host, so every call it makes is a real call
 * to the engine through the desktop's `http` lane on MCP 2026-07-28, with the engine's approver token as the bearer.
 *
 * What this proves, against the real engine: the entry the README gives mounts it, with labels per part and the
 * shell's approvals; a stranger's instruction read in mail raises a confirmation naming Mail, and declining it makes
 * nothing; a send the copilot asks for, and one the person makes by pressing Send in the mail app, are each asked
 * once in the shell with the engine's own preview and sent once on the person's confirm, to the thread's sender; a
 * reply set's units are each composed from only their own message, and the conversation never sees either; no
 * approval token or bearer reaches the page, its storage or the app's log. What it does not prove: a model's
 * judgment (its scripts choose for it), the hold's ordering or a changed preview (the kernel's units over `mailfix`),
 * the engine's own rules (its tests and scenarios), or any of this on Windows, where `test-world` is refused and
 * `vitest.desktop.config.ts` leaves this file out, or macOS, whose suite is `test:macos`. Every wait is a poll with a deadline.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type MailEngine, startMailEngine } from './fixtures/mail-engine';
import { MAIL_MODEL, type MailModel, startMailModel } from './fixtures/mail-model';
import {
	type CommandResultLike,
	type Desktop,
	desktopDeployment,
	LOAM,
	openDesktop,
	packApp,
	pageText,
	storedText,
	untilInstance,
} from './harness';

const MAIL = join(LOAM, 'plugins/mail');
const KEY = `sk-mail-${randomBytes(12).toString('hex')}`;
/** The person's reply in the mail app. */
const BODY = `Sending it this afternoon, ${randomBytes(4).toString('hex')}.`;

let desktop: Desktop;
let engine: MailEngine;
let model: MailModel;
let bearer = '';

/** The entry the mail README's step 4 gives, with this run's port and token, the mail app beside it, and the model. */
async function deployment(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'loam-desktop-mail-model-'));
	const keyFile = join(directory, 'key');
	await writeFile(keyFile, KEY, { mode: 0o600 });
	// Only its owner may read it, as the Rust host requires of a key file (4.2), whatever the umask.
	await chmod(keyFile, 0o600);
	const mount = await packApp(join(MAIL, 'mount'));
	const app = await packApp(join(MAIL, 'app'));
	const command = (name: string, lines: string[]) => [
		`[apps.mail.commands.${JSON.stringify(name)}]`,
		...lines,
		'',
	];
	const held = (name: string, preview: string, input: string[]) =>
		command(name, [
			'expose = { agent = true, apps = true }',
			`preview = { command = ${JSON.stringify(preview)}, input = ${JSON.stringify(input)} }`,
		]);
	const reachable = (name: string) =>
		command(name, ['expose = { agent = true, palette = true, apps = true }']);
	return [
		desktopDeployment([
			'[apps.mail]',
			'app = "mail"',
			`package = ${JSON.stringify(mount)}`,
			'prefix = "mail"',
			'audience = "person"',
			'transport = "http"',
			`url = ${JSON.stringify(engine.url)}`,
			`bearer_file = ${JSON.stringify(engine.approverTokenFile)}`,
			'labels = "per-part"',
			'approvals = "shell"',
			'expose = { agent = true, palette = true }',
			'',
			...held('mail-operation-approve', 'mail-operation-show', ['operation', 'digest']),
			...held('mail-draft-send', 'mail-draft-show', ['draft', 'revision']),
			...held('mail-unsubscribe', 'mail-unsubscribe-show', ['message', 'digest']),
			...held('mail-replyset-send', 'mail-replyset-show', ['replyset', 'revision']),
			...command('mail-replyset-submit', ['expose = { agent = true }']),
			...reachable('mail-thread-open'),
			...reachable('mail-draft-show'),
			...reachable('mail-draft-create'),
			...reachable('mail-draft-update'),
			'[apps.mailapp]',
			'app = "mailapp"',
			`package = ${JSON.stringify(app)}`,
		]),
		'[copilot]',
		'default = "local"',
		'',
		'[[copilot.providers]]',
		'id = "local"',
		'kind = "openai-compatible"',
		`model = "${MAIL_MODEL}"`,
		`endpoint = ${JSON.stringify(model.url)}`,
		`key = { file = ${JSON.stringify(keyFile)} }`,
		'',
	].join('\n');
}

const dataOf = <T>(result: CommandResultLike): T => {
	expect(result.success, JSON.stringify(result.error)).toBe(true);
	return result.data as T;
};

interface Call {
	command: string;
	outcome?: string;
	mode?: string;
	reason?: string;
	labels?: { content?: number };
	unit?: { state?: string };
}

interface Turn {
	state: string;
	calls: Call[];
}

/** A new session, and the turn the person's text starts in it, once it settles or waits. */
async function turn(text: string): Promise<{ session: string; turn: Turn }> {
	const started = dataOf<{ session: { id: string } }>(
		await desktop.call('copilot-session-start', {})
	);
	const session = started.session.id;
	const sent = dataOf<{ turn: Turn }>(
		await desktop.call('copilot-message-send', { session, text, wait: true })
	);
	return { session, turn: sent.turn };
}

interface Confirmation {
	id: string;
	confirmation?: {
		command: string;
		caller?: string;
		state: string;
		asked?: { reason?: string; sources?: string[] };
		preview?: { command: string; digest?: string; data?: Record<string, unknown> };
	};
}

async function pending(): Promise<Confirmation[]> {
	const listed = dataOf<{ notifications: Confirmation[] }>(
		await desktop.call('notification-list', { kind: 'confirmation', body: true })
	);
	return listed.notifications.filter((each) => each.confirmation?.state === 'pending');
}

async function until<T>(
	read: () => Promise<T | undefined>,
	what: string,
	ms = 30_000,
	explain?: () => Promise<unknown>
): Promise<T> {
	const deadline = Date.now() + ms;
	for (;;) {
		const found = await read();
		if (found !== undefined) return found;
		if (Date.now() > deadline)
			throw new Error(
				`timed out waiting for ${what}${explain ? `: ${String(await explain().catch((cause) => cause))}` : ''}`
			);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

type MailAction = 'found' | 'ready' | 'sent' | 'type' | 'press' | 'state';

/**
 * Acts in the page on the mail app's main surface, `mail-reply`, found through every shadow root: whether it is there,
 * its To once a thread is ready, its notice once sent, a value typed into one of its fields as the person's input
 * event, or a press of one of its buttons. The shell's policy runs no `eval`, so each action is named here.
 */
function inMailApp<T>(action: MailAction, selector = '', value = ''): Promise<T | undefined> {
	return desktop.browser
		.execute(
			(action: MailAction, selector: string, value: string) => {
				const deep = (root: Document | ShadowRoot, wanted: string): Element | null => {
					const found = root.querySelector(wanted);
					if (found) return found;
					for (const each of root.querySelectorAll('*')) {
						const inner = each.shadowRoot ? deep(each.shadowRoot, wanted) : null;
						if (inner) return inner;
					}
					return null;
				};
				const reply = deep(document, 'mail-reply') as
					| (HTMLElement & { phase?: string; to?: string; noticeText?: string })
					| null;
				if (action === 'state')
					return JSON.stringify({
						element: reply ? reply.localName : null,
						upgraded: reply ? reply.matches(':defined') : null,
						shadow: reply?.shadowRoot ? reply.shadowRoot.innerHTML.slice(0, 400) : null,
						phase: reply?.phase ?? null,
						notice: reply?.noticeText ?? null,
					});
				// WebDriver answers `undefined` as `null`.
				if (!reply) return null;
				// Found once its template has rendered: the element can be in the page before it is upgraded.
				if (action === 'found') return reply.shadowRoot?.querySelector('.thread-id') ? true : null;
				if (action === 'ready') return reply.phase === 'ready' ? (reply.to ?? '') : null;
				if (action === 'sent') return reply.phase === 'sent' ? (reply.noticeText ?? '') : null;
				const target = reply.shadowRoot?.querySelector(selector) as
					| (HTMLElement & { value?: string })
					| null;
				if (!target) return null;
				if (action === 'type') {
					target.value = value;
					target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
				} else target.click();
				return true;
			},
			action,
			selector,
			value
		)
		.then((answered) => (answered === null ? undefined : (answered as T)));
}

/**
 * Types into, or presses, the mail app's `selector`, retrying while the surface is replaced or still rendering (the
 * shell can mount a new `mail-reply` as the app opens), and saying what the app held if it never could. A press that
 * found nothing pressed nothing, so a retry never presses twice.
 */
async function act(action: 'type' | 'press', selector: string, value = ''): Promise<void> {
	await until(
		() => inMailApp<boolean>(action, selector, value),
		`${action} ${selector} in the mail app`,
		15_000,
		() => inMailApp<string>('state')
	);
}

const type = (selector: string, value: string) => act('type', selector, value);
const press = (selector: string) => act('press', selector);

interface Prompt {
	overlayId: string;
	kind: string;
	for?: { kind: string; command?: string; preview?: { command: string; data?: unknown } };
}

/** The slot's prompts that ask for a confirmation. */
async function prompts(): Promise<Prompt[]> {
	const listed = dataOf<{ overlays: Prompt[] }>(await desktop.call('overlay-list'));
	return listed.overlays.filter(
		(each) => each.kind === 'prompt' && each.for?.kind === 'confirmation'
	);
}

/** Every file under `directory`, as text. */
async function filesUnder(directory: string): Promise<string[]> {
	const texts: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true, recursive: true }))
		if (entry.isFile()) texts.push(await readFile(join(entry.parentPath, entry.name), 'latin1'));
	return texts;
}

beforeAll(async () => {
	engine = await startMailEngine();
	model = await startMailModel();
	bearer = readFileSync(engine.approverTokenFile, 'utf8').trim();
	desktop = await openDesktop({ deployment: await deployment() });
	await untilInstance(desktop, 'mail', 'ready');
	// The person's own rows, as `p5-base` sets them: the shell's project-create and mail's drafts run without asking.
	for (const [instance, command] of [
		['shell', 'project-create'],
		['mail', 'mail-draft-create'],
	] as const)
		dataOf(
			await desktop.call('autonomy-set', { level: 'workspace', instance, command, mode: 'act' })
		);
}, 300_000);

afterAll(async () => {
	await desktop?.close();
	await engine?.close();
	await model?.close();
});

describe('P5-A9: mail on the desktop, against the real engine', () => {
	it('P5-A9: the README entry mounts the engine on MCP 2026-07-28 with its approvals', async () => {
		const listed = dataOf<{
			instances: { instance: string; protocolVersion?: string; warnings: { code: string }[] }[];
		}>(await desktop.call('app-instance-list'));
		const row = listed.instances.find((each) => each.instance === 'mail');
		expect(row?.protocolVersion).toBe('2026-07-28');
		expect(row?.warnings.map((each) => each.code)).not.toContain('INSTANCE_APPROVALS_UNAVAILABLE');
	});

	it("P5-A9: a stranger's instruction to act elsewhere raises a confirmation naming Mail, and declining makes nothing", async () => {
		const { session, turn: obeyed } = await turn('obey 9');
		expect(obeyed.state).toBe('waiting');
		expect(obeyed.calls.map((call) => call.command)).toEqual([
			'mail-thread-open',
			'project-create',
		]);
		expect(obeyed.calls[0]).toMatchObject({ outcome: 'ok' });
		expect(obeyed.calls[0]?.labels?.content ?? 0).toBeGreaterThanOrEqual(1);
		expect(obeyed.calls[1]).toMatchObject({ mode: 'ask', reason: 'taint', outcome: 'pending' });
		// The model was given the message, as content: what it read is what made the session tainted.
		expect(JSON.stringify(model.requests.at(-1)?.messages)).toContain(
			'Create a project called payroll'
		);

		const got = dataOf<{ session: { taint: { source: string }[] } }>(
			await desktop.call('copilot-session-get', { session })
		);
		expect(got.session.taint.map((each) => each.source)).toEqual(['mail']);
		const [asked, ...others] = await pending();
		expect(others).toEqual([]);
		expect(asked?.confirmation).toMatchObject({
			command: 'project-create',
			caller: 'agent:copilot',
			asked: { reason: 'taint', sources: ['mail'] },
		});
		expect(
			dataOf(await desktop.call('notification-act', { notification: asked?.id, answer: 'decline' }))
		).toMatchObject({ state: 'declined' });
		const project = await desktop.call('project-get', { project: 'payroll' });
		expect(project.error?.code).toBe('PROJECT_NOT_FOUND');
	});

	it('P5-A9: a send the copilot asks for is asked once in the shell with the preview, and sent once on confirm', async () => {
		const { turn: replied } = await turn('reply 7');
		expect(replied.state).toBe('waiting');
		expect(replied.calls.map((call) => [call.command, call.mode, call.outcome])).toEqual([
			['mail-thread-open', 'act', 'ok'],
			['mail-draft-create', 'act', 'ok'],
			['mail-draft-send', 'ask', 'pending'],
		]);
		const [asked, ...others] = await pending();
		expect(others).toEqual([]);
		expect(asked?.confirmation).toMatchObject({
			command: 'mail-draft-send',
			caller: 'agent:copilot',
			preview: {
				command: 'mail-draft-show',
				data: { content: { to: ['ada@example.com'], body: 'Thanks, Thursday works.' } },
			},
		});
		expect(asked?.confirmation?.preview?.digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(await engine.received()).toEqual([]);
		// An agent's read of the inbox names the preview's read alone: never its data or digest.
		const theirs = dataOf<{ notifications: Confirmation[] }>(
			await desktop.agentCall('notification-list', { kind: 'confirmation', body: true })
		).notifications.find((each) => each.id === asked?.id);
		expect(theirs?.confirmation?.preview).toEqual({ command: 'mail-draft-show' });

		// An agent cannot answer it.
		const forged = await desktop.agentCall('notification-act', {
			notification: asked?.id,
			answer: 'confirm',
		});
		expect(forged.error?.code).toBe('HUMAN_REQUIRED');
		expect(await engine.received()).toEqual([]);

		expect(
			dataOf(await desktop.call('notification-act', { notification: asked?.id, answer: 'confirm' }))
		).toMatchObject({ state: 'confirmed' });
		expect((await engine.received()).map((each) => each.to)).toEqual([['ada@example.com']]);
		// Once: the ended confirmation is answered where it stands, and nothing more is sent.
		expect(
			dataOf(await desktop.call('notification-act', { notification: asked?.id, answer: 'confirm' }))
		).toMatchObject({ state: 'confirmed' });
		expect(await engine.received()).toHaveLength(1);
	});

	it("P5-A9: a reply set's units are each composed from only their own message, and the conversation sees neither", async () => {
		const before = model.requests.length;
		const { session, turn: composed } = await turn('compose 1');
		expect(composed.state).toBe('done');
		expect(composed.calls.map((call) => [call.command, call.outcome, call.unit?.state])).toEqual([
			['mail-replyset-next', 'ok', 'composed'],
			['mail-replyset-next', 'ok', 'composed'],
		]);
		const got = dataOf<{ session: { taint: unknown[] } }>(
			await desktop.call('copilot-session-get', { session })
		);
		expect(got.session.taint).toEqual([]);

		// This turn's requests alone: an earlier session's continuation, after its confirmation ended, may land between.
		const since = model.requests.slice(before);
		const requests = since.filter((each) => each.asked === 'compose 1');
		expect(requests.filter((each) => each.tools).length).toBeGreaterThanOrEqual(3);
		const composers = since
			.filter((request) => request.asked === 'compose')
			.map((request) => JSON.stringify(request));
		expect(since.filter((request) => !request.tools && request.asked !== 'compose')).toEqual([]);
		expect(composers).toHaveLength(2);
		expect(composers[0]).toContain('Ada Lovelace');
		expect(composers[0]).not.toContain('Bea');
		expect(composers[1]).toContain('Bea');
		expect(composers[1]).not.toContain('Ada');
		// The session's own requests carry neither sender's message.
		for (const request of requests.filter((each) => each.tools)) {
			const text = JSON.stringify(request);
			expect(text).not.toContain('Does Thursday work for you?');
			expect(text).not.toContain('Can you send the invoice?');
		}

		const shown = dataOf<{
			replyset: {
				replies: { content: { recipient: { address: string }; text: string | null } }[];
			};
		}>(await desktop.call('mail-replyset-show', { replyset: 1 }));
		expect(
			shown.replyset.replies.map((each) => [each.content.recipient.address, each.content.text])
		).toEqual([
			['ada@example.com', 'Dear Ada Lovelace, you asked: Does Thursday work for you?'],
			['bea@example.com', 'Dear Bea, you asked: Can you send the invoice?'],
		]);
	});

	it('P5-A9: the person presses Send in the mail app; it is asked once in the slot with the preview, and sent once', async () => {
		const sentBefore = (await engine.received()).length;
		dataOf(await desktop.call('app-open', { instance: 'mailapp' }));
		const state = () => inMailApp<string>('state');
		await until(() => inMailApp<boolean>('found'), 'the mail app', 30_000, state);
		await type('.thread-id', '8');
		await press('.open');
		expect(await until(() => inMailApp<string>('ready'), "Bea's thread", 30_000, state)).toBe(
			'bea@example.com'
		);
		// Text no seed holds, so finding it on the page can only be the slot showing this draft.
		await type('.body', BODY);
		await press('.send');

		const prompt = await until(
			async () => (await prompts())[0],
			'the slot asking to send',
			30_000,
			state
		);
		expect(prompt.for).toMatchObject({
			command: 'mail-draft-send',
			preview: {
				command: 'mail-draft-show',
				data: { content: { to: ['bea@example.com'], body: BODY } },
			},
		});
		// Shown to the person in the slot once it has drawn (the record comes first), and nothing sent before they answer.
		await until(
			async () => ((await pageText(desktop.browser)).includes(BODY) ? true : undefined),
			'the slot to show the draft',
			30_000,
			state
		);
		expect(await engine.received()).toHaveLength(sentBefore);
		// Asked once: one prompt, and nothing in the inbox.
		expect(await prompts()).toHaveLength(1);
		expect(await pending()).toEqual([]);

		// An agent cannot answer the slot's prompt.
		const forged = await desktop.agentCall('overlay-dismiss', {
			overlayId: prompt.overlayId,
			result: 'confirm',
		});
		expect(forged.error?.code).toBe('HUMAN_REQUIRED');
		expect(await engine.received()).toHaveLength(sentBefore);
		expect(await prompts()).toHaveLength(1);
		dataOf(
			await desktop.call('overlay-dismiss', { overlayId: prompt.overlayId, result: 'confirm' })
		);
		const notice = await until(
			() => inMailApp<string>('sent'),
			'the app to say it was sent',
			30_000,
			state
		);
		expect(notice).toBe('Sent');
		const received = await engine.received();
		expect(received.slice(sentBefore).map((each) => each.to)).toEqual([['bea@example.com']]);
		expect(await prompts()).toEqual([]);
		expect(await pending()).toEqual([]);
	});

	it('P5-A9: no approval token or bearer is in the page, its storage, the site, the app’s log or the engine’s', async () => {
		const page = await pageText(desktop.browser);
		const stored = await storedText(desktop.browser);
		const logged = desktop.stderr.lines.join('\n');
		// The engine's own log, and every file the deployment wrote for the webview to serve.
		const engineLogged = engine.stderr.join('\n');
		const site = await filesUnder(join(desktop.data, 'site'));
		expect(site.length).toBeGreaterThan(0);
		for (const text of [page, stored, logged, engineLogged, ...site]) {
			expect(text).not.toContain('afdap1.');
			expect(text).not.toContain(bearer);
		}
		expect(bearer).toMatch(/^lmail_approver_/);
		// Nor did the model ever see one.
		expect(JSON.stringify(model.requests)).not.toContain('afdap1.');
		expect(JSON.stringify(model.requests)).not.toContain(bearer);
	});
});
