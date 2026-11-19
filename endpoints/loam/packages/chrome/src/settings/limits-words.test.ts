import { describe, expect, it } from 'vitest';
import { type LimitUsageRow, usageLine, usageUnavailable } from './limits-words.js';

const none = {
	messageBytes: 0,
	inputBytes: 0,
	callsPerSecond: 0,
	storeBytes: 0,
	journalEntryBytes: 0,
};
const rows: LimitUsageRow[] = [
	{
		instance: 'alpha',
		storeBytes: { used: 1_200, limit: 26_214_400 },
		refusals: { ...none, inputBytes: 2 },
	},
	{
		instance: 'beta',
		storeBytes: { used: 3_500_000, limit: 26_214_400 },
		refusals: { ...none, inputBytes: 1, storeBytes: 1 },
	},
	{ instance: 'gamma', storeBytes: { used: 0, limit: 26_214_400 }, refusals: none },
];
const titleOf = (instance: string) => instance[0]?.toUpperCase() + instance.slice(1);

describe("the Limits section's usage words (3.7, section 11)", () => {
	it('names the apps a limit refused in the hour, most first', () => {
		expect(usageLine('inputBytes', rows, titleOf)).toBe(
			'Refused in the last hour: Alpha 2 times, Beta once.'
		);
		expect(usageLine('callsPerSecond', rows, titleOf)).toBe(
			'No app was refused by it in the last hour.'
		);
	});

	it('names the apps that store the most beside storeBytes', () => {
		expect(usageLine('storeBytes', rows, titleOf)).toBe(
			'Stored most: Beta 3,500,000 bytes, Alpha 1,200 bytes. Refused in the last hour: Beta once.'
		);
		expect(usageLine('storeBytes', [], titleOf)).toBe(
			'No app stores anything yet. No app was refused by it in the last hour.'
		);
	});

	it('says why no usage is shown', () => {
		expect(usageUnavailable('OWNER_REQUIRED')).toContain('Only an owner');
		expect(usageUnavailable(undefined)).toContain('could not be read');
	});
});
