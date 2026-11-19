import { describe, expect, it, vi } from 'vitest';
import {
	type AppDefinitionV1,
	confirmationsOver,
	defineApp,
	failure,
	KIT_ELEMENT_NAMES_V1,
	type LoamClientV1,
	notificationsOver,
	projectsOver,
	SDK_VERSION,
	settingsOver,
	success,
} from './index.js';

describe('the SDK root', () => {
	it('returns the definition it is given', () => {
		const definition: AppDefinitionV1 = {
			sdk: 1,
			handlers: { 'hello-ping': async () => success({ pong: true }) },
		};
		expect(defineApp(definition)).toBe(definition);
		expect(SDK_VERSION).toBe(1);
	});

	it('lets a handler type its input', async () => {
		const definition = defineApp({
			sdk: 1,
			handlers: {
				'hello-greet': async (input: { name: string }) => success(`Hello, ${input.name}!`),
			},
		});
		const handler = definition.handlers['hello-greet'] as unknown as (
			input: unknown
		) => Promise<{ data?: unknown }>;
		expect((await handler({ name: 'Ada' })).data).toBe('Hello, Ada!');
	});

	it('re-exports the result helpers, so an app imports no AFD server code', () => {
		expect(success(1)).toEqual({ success: true, data: 1 });
		const error = { code: 'NOPE', message: 'No.', suggestion: 'Stop.' };
		expect(failure(error)).toEqual({ success: false, error });
	});

	it('lists the kit named by the specification', () => {
		expect(KIT_ELEMENT_NAMES_V1).toHaveLength(14);
		expect(KIT_ELEMENT_NAMES_V1).toContain('loam-list');
		// The documents specification's 9.2: an editor embeds another document by name.
		expect(KIT_ELEMENT_NAMES_V1).toContain('loam-embed');
	});
});

/** A client answering each command from `answers`, recording its calls. */
function clientOf(answers: Record<string, unknown>) {
	const call = vi.fn(async (name: string) => answers[name] as never);
	return { client: { call } as unknown as LoamClientV1, call };
}

describe('settingsOver: the settings grant (phase 4 specification, 3.8)', () => {
	it("reads a key's resolved value and a section's values by key", async () => {
		const { client, call } = clientOf({
			'setting-get': success({ value: 'Hi', from: 'workspace' }),
			'setting-list': success({
				values: [
					{ section: 'hello.general', key: 'greeting', value: 'Hi' },
					{ section: 'hello.general', key: 'shout', value: false },
				],
			}),
		});
		const settings = settingsOver(client);
		expect(await settings.get('hello.general', 'greeting')).toBe('Hi');
		expect(await settings.section('hello.general')).toEqual({ greeting: 'Hi', shout: false });
		expect(call.mock.calls).toEqual([
			['setting-get', { section: 'hello.general', key: 'greeting' }],
			['setting-list', { section: 'hello.general' }],
		]);
	});

	it("rejects with the refusal's code and suggestion", async () => {
		const refusal = failure({
			code: 'SETTING_NOT_OWNED',
			message: "'other.prefs' is another app's section",
			suggestion: "Read only this app's own sections",
		});
		const { client } = clientOf({ 'setting-get': refusal, 'setting-list': refusal });
		const settings = settingsOver(client);
		await expect(settings.get('other.prefs', 'x')).rejects.toMatchObject({
			message: "'other.prefs' is another app's section",
			code: 'SETTING_NOT_OWNED',
			suggestion: "Read only this app's own sections",
		});
		await expect(settings.section('other.prefs')).rejects.toMatchObject({
			code: 'SETTING_NOT_OWNED',
		});
	});

	it('rejects a success with no data, and an error with no message, in its own words', async () => {
		const { client } = clientOf({
			'setting-get': { success: true },
			'setting-list': { success: false },
		});
		const settings = settingsOver(client);
		await expect(settings.get('hello.general', 'greeting')).rejects.toThrow(
			'The setting could not be read'
		);
		await expect(settings.section('hello.general')).rejects.toMatchObject({
			message: 'The setting could not be read',
			code: undefined,
		});
	});
});

describe('projectsOver: the projects grant (phase 2 specification, 5)', () => {
	const atlas = { id: 'prj_atlas', slug: 'atlas', name: 'Atlas' };

	it('reads the active project, the list and one by id or slug', async () => {
		const { client, call } = clientOf({
			'project-get': success(atlas),
			'project-list': success({ projects: [atlas] }),
		});
		const projects = projectsOver(client, 'prj_atlas');
		expect(await projects.active()).toEqual(atlas);
		expect(await projects.list()).toEqual([atlas]);
		expect(await projects.get('atlas')).toEqual(atlas);
		expect(call.mock.calls[0]).toEqual(['project-get', { project: 'prj_atlas' }]);
	});

	it('answers null and nothing for no project and for a refusal', async () => {
		const refusal = failure({
			code: 'PROJECT_NOT_FOUND',
			message: 'No.',
			suggestion: 'List them.',
		});
		const { client, call } = clientOf({ 'project-get': refusal, 'project-list': refusal });
		expect(await projectsOver(client, undefined).active()).toBeNull();
		expect(call).not.toHaveBeenCalled();
		const projects = projectsOver(client, 'prj_gone');
		expect(await projects.active()).toBeNull();
		expect(await projects.get('gone')).toBeNull();
		expect(await projects.list()).toEqual([]);
	});
});

describe('confirmationsOver: the confirmations an app raised (phase 4 specification, 7.2, 12)', () => {
	it('reads and withdraws one by its notice', async () => {
		const { client, call } = clientOf({
			'confirmation-get': success({ state: 'pending', expiresAt: 5 }),
			'confirmation-withdraw': success({ state: 'withdrawn' }),
		});
		const confirmations = confirmationsOver(client);
		expect(await confirmations.get('ntf_0000000000000001')).toEqual({
			state: 'pending',
			expiresAt: 5,
		});
		expect(await confirmations.withdraw('ntf_0000000000000001')).toEqual({ state: 'withdrawn' });
		expect(call.mock.calls).toEqual([
			['confirmation-get', { notification: 'ntf_0000000000000001' }],
			['confirmation-withdraw', { notification: 'ntf_0000000000000001' }],
		]);
	});

	it("rejects with the refusal's code and suggestion, or in its own words", async () => {
		const refused = failure({
			code: 'NOTIFICATION_NOT_FOUND',
			message: 'You raised no confirmation',
			suggestion: 'Read only your own',
		});
		const { client } = clientOf({
			'confirmation-get': refused,
			'confirmation-withdraw': success(undefined),
		});
		await expect(confirmationsOver(client).get('x')).rejects.toMatchObject({
			code: 'NOTIFICATION_NOT_FOUND',
			suggestion: 'Read only your own',
		});
		await expect(confirmationsOver(client).withdraw('x')).rejects.toThrow(
			'The confirmation could not be read'
		);
	});
});

describe('notificationsOver: the inbox, as an app reaches it (phase 4 specification, 10.2, 12)', () => {
	it('pushes a notice and answers it', async () => {
		const notice = { id: 'ntf_0000000000000001', title: 'Ada is waiting', source: 'hello' };
		const { client, call } = clientOf({ 'notification-push': success({ notification: notice }) });
		const notifications = notificationsOver(client);
		expect(await notifications.push({ title: 'Ada is waiting' })).toEqual(notice);
		expect(call.mock.calls).toEqual([['notification-push', { title: 'Ada is waiting' }]]);
	});

	it("rejects with the refusal's code and suggestion, or in its own words", async () => {
		const refused = failure({
			code: 'RATE_LIMITED',
			message: 'An app pushes at most 10 notices a minute',
			suggestion: 'Wait for retryAfterMs; the rate is fixed',
		});
		await expect(
			notificationsOver(clientOf({ 'notification-push': refused }).client).push({ title: 'x' })
		).rejects.toMatchObject({
			code: 'RATE_LIMITED',
			suggestion: 'Wait for retryAfterMs; the rate is fixed',
		});
		await expect(
			notificationsOver(clientOf({ 'notification-push': { success: false } }).client).push({
				title: 'x',
			})
		).rejects.toThrow('The notice was not pushed');
	});
});
