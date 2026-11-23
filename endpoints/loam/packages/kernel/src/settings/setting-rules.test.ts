/**
 * The settings' pure rules (phase 4 specification, 3.2, 3.3, 6.5 and 13): `settingWriteRule`, `isHumanGesture`,
 * `resolveSetting`, `sharedRecordUnavailable`, the route and the writer, and the membership re-read's
 * `needsMembershipRead` (A-P3-1).
 */

import { checkSettingValue, type SettingSectionV1 } from '@lushly-dev/loam-manifest';
import { describe, expect, it } from 'vitest';
import { APPEARANCE_DENSITIES, APPEARANCE_THEMES } from '../appearance.js';
import { HUMAN_COMMANDS } from '../identity/identity-commands.js';
import { PERSONA_SECTIONS } from '../identity/persona.js';
import { needsMembershipRead } from '../identity/session-settle.js';
import {
	HUMAN_SETTING_KEYS,
	isHumanGesture,
	isHumanKey,
	resolveSetting,
	settingRoute,
	settingWriteRule,
	sharedRecordUnavailable,
	writerOf,
} from './setting-rules.js';
import { APPEARANCE_SECTION, DENSITIES, DOCUMENTS_SECTION, THEMES } from './setting-sections.js';

const GENERAL: SettingSectionV1 = {
	id: 'general',
	title: 'General',
	levels: ['person', 'workspace', 'project'],
	schema: {
		type: 'object',
		properties: {
			greeting: { type: 'string', title: 'Greeting', maxLength: 20, default: 'Hello' },
			board: { type: 'boolean', title: 'Board', levels: ['project'], default: false },
		},
		additionalProperties: false,
	},
};
const general = { fullId: 'hello.general', section: GENERAL };

const at = (value: unknown, by = 'mock-user-ada') => ({ value, updatedAt: 1, updatedBy: by });

describe('settingWriteRule (3.2)', () => {
	it('decides by level: the person, a member, an owner', () => {
		expect(settingWriteRule(general, 'greeting', 'person')).toEqual({
			rule: 'person',
			human: false,
		});
		expect(settingWriteRule(general, 'greeting', 'project')).toEqual({ rule: 'member' });
		expect(settingWriteRule(general, 'greeting', 'workspace')).toEqual({ rule: 'owner' });
	});

	it("refuses a level the key does not allow, naming the key's, which narrow its section's", () => {
		expect(settingWriteRule(general, 'board', 'workspace')).toEqual({
			rule: 'unavailable',
			levels: ['project'],
		});
		const appearance = { fullId: 'loam.appearance', section: APPEARANCE_SECTION };
		expect(settingWriteRule(appearance, 'theme', 'project')).toEqual({
			rule: 'unavailable',
			levels: ['person'],
		});
		const documents = { fullId: 'loam.documents', section: DOCUMENTS_SECTION };
		expect(settingWriteRule(documents, 'trashDays', 'workspace')).toEqual({ rule: 'owner' });
	});

	it('marks the human keys, which only the person writes, by section or by key', () => {
		expect(HUMAN_SETTING_KEYS).toEqual([
			'loam.autonomy',
			'loam.keybindings',
			'loam.notifications.muted',
			'loam.experiments',
		]);
		const person: SettingSectionV1 = { ...GENERAL, levels: ['person'] };
		expect(
			settingWriteRule({ fullId: 'loam.keybindings', section: person }, 'greeting', 'person')
		).toEqual({ rule: 'person', human: true });
		expect(isHumanKey('loam.notifications', 'muted')).toBe(true);
		expect(isHumanKey('loam.notifications', 'toastSticky')).toBe(false);
		expect(isHumanKey('loam.appearance', 'theme')).toBe(false);
	});
});

describe('isHumanGesture (the terms; 6.5; R7)', () => {
	it('holds for the palette with no caller and an actor that is not an agent, none included', () => {
		expect(isHumanGesture({ interface: 'palette', actor: { kind: 'human', id: 'a' } })).toBe(true);
		expect(isHumanGesture({ interface: 'palette', actor: undefined })).toBe(true);
		expect(isHumanGesture({ interface: 'palette', actor: { kind: 'test' } as never })).toBe(true);
	});

	it('fails for the agent interface, an agent on the palette, and any port', () => {
		expect(isHumanGesture({ interface: 'agent', actor: { kind: 'human', id: 'a' } })).toBe(false);
		expect(
			isHumanGesture({
				interface: 'palette',
				actor: { kind: 'agent', id: 'shell-agent', onBehalfOf: 'a' },
			})
		).toBe(false);
		expect(
			isHumanGesture({ interface: 'palette', actor: { kind: 'human', id: 'a' }, caller: 'hello' })
		).toBe(false);
	});
});

describe('resolveSetting (3.3)', () => {
	const resolve = (
		stored: Parameters<typeof resolveSetting>[2],
		inProject = true,
		warn?: (message: string) => void
	) => resolveSetting(general, 'greeting', stored, inProject, checkSettingValue, warn);

	it('takes the person, then the project, then the workspace, then the default', () => {
		const all = { person: at('Mine'), project: at('Atlas'), workspace: at('Team') };
		expect(resolve(all)).toEqual({
			value: 'Mine',
			from: 'person',
			updatedAt: 1,
			updatedBy: 'mock-user-ada',
		});
		expect(resolve({ project: at('Atlas'), workspace: at('Team') }).from).toBe('project');
		expect(resolve({ workspace: at('Team') }).from).toBe('workspace');
		expect(resolve({})).toEqual({ value: 'Hello', from: 'default' });
	});

	it("reads no project's value with no project in scope", () => {
		expect(resolve({ project: at('Atlas'), workspace: at('Team') }, false)).toMatchObject({
			value: 'Team',
			from: 'workspace',
		});
	});

	it('skips a level the key no longer allows', () => {
		const narrowed = {
			fullId: 'hello.general',
			section: { ...GENERAL, levels: ['workspace'] } as SettingSectionV1,
		};
		expect(
			resolveSetting(narrowed, 'greeting', { person: at('Mine') }, true, checkSettingValue)
		).toEqual({ value: 'Hello', from: 'default' });
	});

	it('skips a stored value that no longer validates, with a warning', () => {
		const warnings: string[] = [];
		expect(
			resolve({ person: at('x'.repeat(30)), workspace: at('Team') }, true, (message) =>
				warnings.push(message)
			)
		).toMatchObject({ value: 'Team', from: 'workspace' });
		expect(warnings).toEqual([
			'hello.general.greeting at person must be at most 20 characters, so it is skipped',
		]);
	});
});

describe("section 13's hosted refusal", () => {
	it('refuses shared setting writes, every autonomy write and workspace experiments, hosted alone', () => {
		for (const level of ['workspace', 'project']) {
			expect(sharedRecordUnavailable(true, 'setting-set', { level })).toBe(true);
			expect(sharedRecordUnavailable(true, 'setting-reset', { level })).toBe(true);
			expect(sharedRecordUnavailable(false, 'setting-set', { level })).toBe(false);
		}
		expect(sharedRecordUnavailable(true, 'setting-set', { level: 'person' })).toBe(false);
		expect(sharedRecordUnavailable(true, 'autonomy-set', { level: 'person' })).toBe(true);
		expect(sharedRecordUnavailable(true, 'experiment-enable', { audience: 'workspace' })).toBe(
			true
		);
		expect(sharedRecordUnavailable(true, 'experiment-enable', { audience: 'person' })).toBe(false);
		expect(sharedRecordUnavailable(true, 'setting-get', {})).toBe(false);
	});
});

describe('the hand-off and the writer (3.2)', () => {
	it("routes to the settings section at the key, and names an agent's write as its own", () => {
		expect(settingRoute('hello.general', 'greeting')).toBe('~/settings/hello.general#greeting');
		expect(writerOf({ kind: 'agent', id: 'shell-agent', onBehalfOf: 'a' }, 'a')).toBe(
			'agent:shell-agent'
		);
		expect(writerOf({ kind: 'human', id: 'a' }, 'a')).toBe('a');
	});
});

describe("phase 3's lists, as phase 4 adds to them (A-P3-1)", () => {
	it('reads membership again before a write of a workspace value, and no other setting write', () => {
		expect(needsMembershipRead('setting-set', { level: 'workspace' })).toBe(true);
		expect(needsMembershipRead('setting-reset', { level: 'workspace' })).toBe(true);
		expect(needsMembershipRead('setting-set', { level: 'project' })).toBe(false);
		expect(needsMembershipRead('setting-set', { level: 'person' })).toBe(false);
		expect(needsMembershipRead('setting-get', { level: 'workspace' })).toBe(false);
		// Phase 3's own, unchanged.
		expect(needsMembershipRead('project-create', {})).toBe(true);
		expect(needsMembershipRead('project-update', { access: { mode: 'workspace' } })).toBe(true);
		expect(needsMembershipRead('project-update', { name: 'x' })).toBe(false);
		expect(needsMembershipRead('member-invite', null)).toBe(true);
	});

	it('names notification-act and palette-run human commands, before their steps build them', () => {
		expect(HUMAN_COMMANDS).toEqual(expect.arrayContaining(['notification-act', 'palette-run']));
		for (const name of ['setting-set', 'setting-reset', 'setting-get'])
			expect(HUMAN_COMMANDS).not.toContain(name);
	});

	it("widens a persona's emphasized sections with settings and the inbox", () => {
		expect(PERSONA_SECTIONS).toEqual(['projects', 'documents', 'account', 'settings', 'inbox']);
	});

	it("holds the appearance section's literals equal to first paint's", () => {
		expect(THEMES).toEqual([...APPEARANCE_THEMES]);
		expect(DENSITIES).toEqual([...APPEARANCE_DENSITIES]);
	});
});
