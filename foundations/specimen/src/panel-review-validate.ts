/** Zod-free runtime validators for `panel-review` and `panel-calibrate` requests (Phase C3). */

import {
	type CalibrationVerdict,
	MAX_CALIBRATION_COUNT,
	MAX_PANEL_SIZE,
	type PanelCalibrateJudgement,
	type PanelCalibrateRequest,
	type PanelReviewBudget,
	type PanelReviewCaptures,
	type PanelReviewRequest,
} from './panel-review-types.js';
import { isValidWalkTargetUrl } from './panel-validate.js';

const APP_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function fail(path: string, message: string): never {
	throw new TypeError(`Invalid ${path}: ${message}`);
}

function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		fail(path, 'expected an object');
	}
	const obj = value as Record<string, unknown>;
	const allowed = new Set(keys);
	for (const key of Object.keys(obj)) {
		if (!allowed.has(key)) fail(path, `unknown property "${key}"`);
	}
	return obj;
}

function text(value: unknown, path: string): string {
	if (typeof value !== 'string' || !value.trim()) fail(path, 'expected a non-empty string');
	return value.trim();
}

function isValidCalendarDate(dateStr: string): boolean {
	if (!APP_DATE_PATTERN.test(dateStr)) return false;
	const [yearStr, monthStr, dayStr] = dateStr.split('-') as [string, string, string];
	const year = Number(yearStr);
	const month = Number(monthStr);
	const day = Number(dayStr);
	if (month < 1 || month > 12 || day < 1 || day > 31) return false;
	const parsed = new Date(Date.UTC(year, month - 1, day));
	return (
		parsed.getUTCFullYear() === year &&
		parsed.getUTCMonth() === month - 1 &&
		parsed.getUTCDate() === day
	);
}

export function parsePanelReviewRequest(value: unknown): PanelReviewRequest {
	const path = 'panel-review request';
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		fail(path, 'expected an object');
	}
	const raw = value as Record<string, unknown>;
	if (raw.action === 'withdraw') {
		const fields = record(value, path, ['action', 'run', 'reason']);
		return {
			action: 'withdraw',
			run: text(fields.run, `${path}.run`),
			reason: text(fields.reason, `${path}.reason`),
		};
	}
	if (raw.action !== undefined && raw.action !== 'review') {
		fail(`${path}.action`, 'expected "review" or "withdraw"');
	}
	const fields = record(value, path, [
		'action',
		'change',
		'author',
		'jobs',
		'target',
		'appDate',
		'captures',
		'panelSize',
		'budget',
		'baseline',
	]);
	const change = text(fields.change, `${path}.change`);
	const author = fields.author === undefined ? undefined : text(fields.author, `${path}.author`);
	if (!Array.isArray(fields.jobs) || fields.jobs.length === 0 || fields.jobs.length > 32) {
		fail(`${path}.jobs`, 'expected a non-empty array of 1 to 32 job ids');
	}
	const jobs = fields.jobs.map((item, idx) => text(item, `${path}.jobs[${idx}]`));
	const target = text(fields.target, `${path}.target`);
	if (!isValidWalkTargetUrl(target)) {
		fail(`${path}.target`, 'expected a valid http:// or https:// URL');
	}
	const appDate = text(fields.appDate, `${path}.appDate`);
	if (!isValidCalendarDate(appDate)) {
		fail(`${path}.appDate`, 'expected a calendar-valid YYYY-MM-DD date');
	}

	let captures: PanelReviewCaptures | undefined;
	if (fields.captures !== undefined) {
		const c = record(fields.captures, `${path}.captures`, ['before', 'after']);
		captures = {
			...(c.before === undefined ? {} : { before: text(c.before, `${path}.captures.before`) }),
			...(c.after === undefined ? {} : { after: text(c.after, `${path}.captures.after`) }),
		};
	}

	let panelSize: number | undefined;
	if (fields.panelSize !== undefined) {
		if (
			typeof fields.panelSize !== 'number' ||
			!Number.isSafeInteger(fields.panelSize) ||
			fields.panelSize < 1 ||
			fields.panelSize > MAX_PANEL_SIZE
		) {
			fail(`${path}.panelSize`, `expected an integer from 1 to ${MAX_PANEL_SIZE}`);
		}
		panelSize = fields.panelSize;
	}

	let budget: PanelReviewBudget | undefined;
	if (fields.budget !== undefined) {
		const b = record(fields.budget, `${path}.budget`, ['maxRounds', 'maxCostUsd']);
		let maxRounds: number | undefined;
		if (b.maxRounds !== undefined) {
			if (
				typeof b.maxRounds !== 'number' ||
				!Number.isSafeInteger(b.maxRounds) ||
				b.maxRounds < 0 ||
				b.maxRounds > 20
			) {
				fail(`${path}.budget.maxRounds`, 'expected an integer from 0 to 20');
			}
			maxRounds = b.maxRounds;
		}
		let maxCostUsd: number | undefined;
		if (b.maxCostUsd !== undefined) {
			if (
				typeof b.maxCostUsd !== 'number' ||
				!Number.isFinite(b.maxCostUsd) ||
				b.maxCostUsd < 0 ||
				b.maxCostUsd > 10000
			) {
				fail(`${path}.budget.maxCostUsd`, 'expected a finite number from 0 to 10000');
			}
			maxCostUsd = b.maxCostUsd;
		}
		budget = {
			...(maxRounds === undefined ? {} : { maxRounds }),
			...(maxCostUsd === undefined ? {} : { maxCostUsd }),
		};
	}

	const baseline =
		fields.baseline === undefined ? undefined : text(fields.baseline, `${path}.baseline`);

	return {
		...(fields.action === 'review' ? { action: 'review' } : {}),
		change,
		...(author === undefined ? {} : { author }),
		jobs,
		target,
		appDate,
		...(captures === undefined ? {} : { captures }),
		...(panelSize === undefined ? {} : { panelSize }),
		...(budget === undefined ? {} : { budget }),
		...(baseline === undefined ? {} : { baseline }),
	};
}

export function parsePanelCalibrateRequest(value: unknown): PanelCalibrateRequest {
	const path = 'panel-calibrate request';
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		fail(path, 'expected an object');
	}
	const raw = value as Record<string, unknown>;
	if (raw.action === 'sample') {
		const fields = record(value, path, ['action', 'count', 'seed']);
		let count: number | undefined;
		if (fields.count !== undefined) {
			if (
				typeof fields.count !== 'number' ||
				!Number.isSafeInteger(fields.count) ||
				fields.count < 1 ||
				fields.count > MAX_CALIBRATION_COUNT
			) {
				fail(`${path}.count`, `expected an integer from 1 to ${MAX_CALIBRATION_COUNT}`);
			}
			count = fields.count;
		}
		let seed: number | undefined;
		if (fields.seed !== undefined) {
			if (
				typeof fields.seed !== 'number' ||
				!Number.isSafeInteger(fields.seed) ||
				fields.seed < 0 ||
				fields.seed > 2147483647
			) {
				fail(`${path}.seed`, 'expected a non-negative 32-bit integer');
			}
			seed = fields.seed;
		}
		return {
			action: 'sample',
			...(count === undefined ? {} : { count }),
			...(seed === undefined ? {} : { seed }),
		};
	}
	if (raw.action === 'record') {
		const fields = record(value, path, ['action', 'sample', 'judgements']);
		const sample = text(fields.sample, `${path}.sample`);
		if (!Array.isArray(fields.judgements) || fields.judgements.length > MAX_CALIBRATION_COUNT) {
			fail(
				`${path}.judgements`,
				`expected an array of at most ${MAX_CALIBRATION_COUNT} judgements`
			);
		}
		const judgements: PanelCalibrateJudgement[] = fields.judgements.map((entry, idx) => {
			const jPath = `${path}.judgements[${idx}]`;
			const j = record(entry, jPath, ['item', 'verdict', 'reason']);
			if (j.verdict !== 'accept' && j.verdict !== 'reject') {
				fail(`${jPath}.verdict`, 'expected "accept" or "reject"');
			}
			return {
				item: text(j.item, `${jPath}.item`),
				verdict: j.verdict as CalibrationVerdict,
				...(j.reason === undefined ? {} : { reason: text(j.reason, `${jPath}.reason`) }),
			};
		});
		return {
			action: 'record',
			sample,
			judgements,
		};
	}
	fail(`${path}.action`, 'expected "sample" or "record"');
}
