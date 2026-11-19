import { describe, expect, it } from 'vitest';
import {
	checkSettingValue,
	keyLevels,
	type SettingKeyV1,
	type SettingSectionV1,
} from './settings.js';

const text: SettingKeyV1 = { type: 'string', title: 'Greeting', maxLength: 5, default: 'Hello' };
const choice: SettingKeyV1 = {
	type: 'string',
	title: 'Theme',
	enum: ['light', 'dark'],
	default: 'light',
};
const days: SettingKeyV1 = {
	type: 'integer',
	title: 'Days',
	minimum: 1,
	maximum: 365,
	default: 30,
};
const ratio: SettingKeyV1 = {
	type: 'number',
	title: 'Ratio',
	minimum: 0,
	maximum: 1,
	default: 0.5,
};
const flag: SettingKeyV1 = { type: 'boolean', title: 'On', default: true };
const tags: SettingKeyV1 = {
	type: 'array',
	title: 'Tags',
	items: { type: 'string', enum: ['a', 'b', 'c'] },
	maxItems: 2,
	uniqueItems: true,
	default: [],
};

describe('checkSettingValue (phase 4 specification, 3.1)', () => {
	it('accepts a value inside its key', () => {
		for (const [key, value] of [
			[text, 'Hi\tthere'.slice(0, 5)],
			[text, 'a\nb'],
			[choice, 'dark'],
			[days, 365],
			[ratio, 0.25],
			[flag, false],
			[tags, ['a', 'c']],
		] as const) {
			expect(checkSettingValue(key, value), JSON.stringify(value)).toBeUndefined();
		}
	});

	it('refuses a value outside its key, saying why', () => {
		expect(checkSettingValue(text, 'Hello!')).toBe('must be at most 5 characters');
		expect(checkSettingValue(text, 'a\u0007')).toBe('must not hold a control character');
		expect(checkSettingValue(text, 'a‮')).toBe('must not hold a control character');
		expect(checkSettingValue(text, 3)).toBe('must be a string');
		expect(checkSettingValue(choice, 'sepia')).toBe('must be one of light, dark');
		expect(checkSettingValue(days, 0)).toBe('must be from 1 to 365');
		expect(checkSettingValue(days, 1.5)).toBe('must be a whole number');
		expect(checkSettingValue(ratio, Number.NaN)).toBe('must be a number');
		expect(checkSettingValue(flag, 'true')).toBe('must be true or false');
		expect(checkSettingValue(tags, ['a', 'a'])).toBe('must not repeat an item');
		expect(checkSettingValue(tags, ['a', 'b', 'c'])).toBe('must hold at most 2 items');
		expect(checkSettingValue(tags, ['d'])).toBe('must hold only a, b, c');
		expect(checkSettingValue(tags, 'a')).toBe('must be a list');
	});

	it("reads a key's levels, which narrow its section's", () => {
		const section: SettingSectionV1 = {
			id: 'general',
			title: 'General',
			levels: ['workspace', 'project'],
			schema: { type: 'object', properties: { text }, additionalProperties: false },
		};
		expect(keyLevels(section, text)).toEqual(['workspace', 'project']);
		expect(keyLevels(section, { ...text, levels: ['project'] })).toEqual(['project']);
	});
});
