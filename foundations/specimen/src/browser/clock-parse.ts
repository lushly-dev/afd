/**
 * Shared calendar-valid ISO-8601 clock pin parser used by browser `clock.ts`, Zod `schema.ts`,
 * Zod-free `validate.ts`, and `jobs.ts`. Rejects calendar rollovers such as `2026-02-30T09:00:00Z`.
 */

const ISO_CLOCK_PARTS =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

/** Parse an ISO-8601 instant with explicit timezone (`Z` or `±HH:MM`) and calendar validation, or return `null`. */
export function parseIsoClockMs(iso: string): number | null {
	const match = ISO_CLOCK_PARTS.exec(iso);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	const second = Number(match[6]);
	const millis = match[7] ? Number(match[7].padEnd(3, '0')) : 0;
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	if (hour > 23 || minute > 59 || second > 59) return null;

	// Verify exact calendar date (rejects e.g. Feb 30, Apr 31, non-leap Feb 29).
	const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millis));
	if (
		probe.getUTCFullYear() !== year ||
		probe.getUTCMonth() !== month - 1 ||
		probe.getUTCDate() !== day
	) {
		return null;
	}

	let offsetMs = 0;
	if (match[8] !== 'Z') {
		const sign = match[9] === '+' ? 1 : -1;
		const tzHour = Number(match[10]);
		const tzMinute = Number(match[11]);
		if (tzHour > 23 || tzMinute > 59) return null;
		offsetMs = sign * (tzHour * 60 + tzMinute) * 60_000;
	}
	const epochMs = probe.getTime() - offsetMs;
	return Number.isFinite(epochMs) ? epochMs : null;
}

/** Return true iff `value` is a calendar-valid ISO-8601 instant with explicit timezone. */
export function isValidIsoClock(value: string): boolean {
	return parseIsoClockMs(value) !== null;
}
