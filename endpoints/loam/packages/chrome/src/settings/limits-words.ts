/**
 * @fileoverview The words beside each key of the Limits section (phase 4 specification, 3.7 and section 11): what each
 * app uses of it, from `limit-usage-get`. Pure, so a unit holds the words.
 */

/** The five keys, in section 11's order. */
export const LIMIT_KEYS = [
	'messageBytes',
	'inputBytes',
	'callsPerSecond',
	'storeBytes',
	'journalEntryBytes',
] as const;

export type LimitKey = (typeof LIMIT_KEYS)[number];

/** One app's row of `limit-usage-get` (section 11). */
export interface LimitUsageRow {
	instance: string;
	storeBytes: { used: number; limit: number };
	refusals: Record<LimitKey, number>;
}

/** A whole number with its thousands marked, as the keys' descriptions write them. */
const count = (value: number): string => value.toLocaleString('en-US');

const times = (value: number): string => (value === 1 ? 'once' : `${count(value)} times`);

/**
 * The line beside `key`: the apps it refused in the last hour, most first, and for `storeBytes` the apps that store
 * the most, with the limit. `titleOf` names an instance as the rail does.
 */
export function usageLine(
	key: LimitKey,
	rows: readonly LimitUsageRow[],
	titleOf: (instance: string) => string
): string {
	const refused = rows
		.filter((row) => row.refusals[key] > 0)
		.sort((a, b) => b.refusals[key] - a.refusals[key] || a.instance.localeCompare(b.instance))
		.map((row) => `${titleOf(row.instance)} ${times(row.refusals[key])}`);
	const refusals =
		refused.length === 0
			? 'No app was refused by it in the last hour.'
			: `Refused in the last hour: ${refused.join(', ')}.`;
	if (key !== 'storeBytes') return refusals;
	const storing = rows
		.filter((row) => row.storeBytes.used > 0)
		.sort((a, b) => b.storeBytes.used - a.storeBytes.used || a.instance.localeCompare(b.instance))
		.slice(0, 3)
		.map((row) => `${titleOf(row.instance)} ${count(row.storeBytes.used)} bytes`);
	const stored =
		storing.length === 0 ? 'No app stores anything yet.' : `Stored most: ${storing.join(', ')}.`;
	return `${stored} ${refusals}`;
}

/** Why the usage is not shown, by the code `limit-usage-get` answered. */
export function usageUnavailable(code: string | undefined): string {
	return code === 'OWNER_REQUIRED'
		? 'Only an owner of the workspace sees what each app uses.'
		: 'What each app uses could not be read.';
}
