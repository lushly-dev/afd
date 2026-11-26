import {
	MAX_WALK_ACTIONS,
	MODALITY_VALUES,
	type Modality,
	type PanelConfig,
	type PanelWalkRequest,
	type PersonaDefinition,
} from './panel-types.js';

const APP_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function fail(path: string, message: string): never {
	throw new TypeError(`Invalid ${path}: ${message}`);
}

function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		fail(path, 'expected an object');
	const object = value as Record<string, unknown>;
	const allowed = new Set(keys);
	for (const key of Object.keys(object)) {
		if (!allowed.has(key)) fail(path, `unknown property "${key}"`);
	}
	return object;
}

function text(value: unknown, path: string): string {
	if (typeof value !== 'string' || !value.trim()) fail(path, 'expected a non-empty string');
	return value.trim();
}

export function isValidWalkTargetUrl(value: string): boolean {
	if (!URL.canParse(value)) return false;
	const parsed = new URL(value);
	return (
		(parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname.length > 0
	);
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

function modalityChoice(value: unknown, path: string): Modality {
	if (typeof value !== 'string' || !(MODALITY_VALUES as readonly string[]).includes(value)) {
		fail(path, `expected one of ${MODALITY_VALUES.join(', ')}`);
	}
	return value as Modality;
}

/** Zero-Zod runtime validator for `panel-walk` requests; kept in parity with `panelWalkRequestSchema`. */
export function parsePanelWalkRequest(value: unknown): PanelWalkRequest {
	const path = 'panel-walk request';
	const fields = record(value, path, [
		'job',
		'persona',
		'modality',
		'target',
		'appDate',
		'maxActions',
		'baselineWalk',
		'requestedTools',
	]);
	const job = text(fields.job, `${path}.job`);
	const persona = text(fields.persona, `${path}.persona`);
	const modality = modalityChoice(fields.modality, `${path}.modality`);
	const target = text(fields.target, `${path}.target`);
	if (!isValidWalkTargetUrl(target)) {
		fail(`${path}.target`, 'expected a valid http:// or https:// URL');
	}

	let appDate: string | undefined;
	if (fields.appDate !== undefined) {
		const raw = text(fields.appDate, `${path}.appDate`);
		if (!isValidCalendarDate(raw)) {
			fail(`${path}.appDate`, 'expected a valid calendar date in YYYY-MM-DD format');
		}
		appDate = raw;
	}

	let maxActions: number | undefined;
	if (fields.maxActions !== undefined) {
		if (
			typeof fields.maxActions !== 'number' ||
			!Number.isSafeInteger(fields.maxActions) ||
			fields.maxActions < 1 ||
			fields.maxActions > MAX_WALK_ACTIONS
		) {
			fail(`${path}.maxActions`, `expected an integer from 1 to ${MAX_WALK_ACTIONS}`);
		}
		maxActions = fields.maxActions;
	}

	const baselineWalk =
		fields.baselineWalk === undefined
			? undefined
			: text(fields.baselineWalk, `${path}.baselineWalk`);

	let requestedTools: string[] | undefined;
	if (fields.requestedTools !== undefined) {
		if (!Array.isArray(fields.requestedTools) || fields.requestedTools.length === 0) {
			fail(`${path}.requestedTools`, 'expected a non-empty array of tool names');
		}
		requestedTools = fields.requestedTools.map((item, idx) =>
			text(item, `${path}.requestedTools[${idx}]`)
		);
	}

	return {
		job,
		persona,
		modality,
		target,
		...(appDate === undefined ? {} : { appDate }),
		...(maxActions === undefined ? {} : { maxActions }),
		...(baselineWalk === undefined ? {} : { baselineWalk }),
		...(requestedTools === undefined ? {} : { requestedTools }),
	};
}

/** Zero-Zod validator for optional `panel` section in `specimen.config.json`. */
export function parsePanelConfig(value: unknown): PanelConfig {
	const path = 'configuration.panel';
	const fields = record(value, path, [
		'personas',
		'jobs',
		'scenariosDir',
		'driver',
		'allowUnverifiedLocal',
		'changeAuthors',
		'memberCostUsd',
	]);

	let personas: PersonaDefinition[] | undefined;
	if (fields.personas !== undefined) {
		if (!Array.isArray(fields.personas)) {
			fail(`${path}.personas`, 'expected an array of persona definitions');
		}
		personas = fields.personas.map((entry, idx) => {
			const entryPath = `${path}.personas[${idx}]`;
			const obj = record(entry, entryPath, ['id', 'modality', 'name', 'stance', 'card', 'family']);
			return {
				id: text(obj.id, `${entryPath}.id`),
				modality: modalityChoice(obj.modality, `${entryPath}.modality`),
				...(obj.name === undefined ? {} : { name: text(obj.name, `${entryPath}.name`) }),
				...(obj.stance === undefined ? {} : { stance: text(obj.stance, `${entryPath}.stance`) }),
				...(obj.card === undefined ? {} : { card: text(obj.card, `${entryPath}.card`) }),
				...(obj.family === undefined ? {} : { family: text(obj.family, `${entryPath}.family`) }),
			};
		});
	}

	let jobs: string[] | undefined;
	if (fields.jobs !== undefined) {
		if (!Array.isArray(fields.jobs)) fail(`${path}.jobs`, 'expected an array of job names');
		jobs = fields.jobs.map((item, idx) => text(item, `${path}.jobs[${idx}]`));
	}

	const scenariosDir =
		fields.scenariosDir === undefined
			? undefined
			: text(fields.scenariosDir, `${path}.scenariosDir`);
	const driver = fields.driver === undefined ? undefined : text(fields.driver, `${path}.driver`);

	let allowUnverifiedLocal: boolean | undefined;
	if (fields.allowUnverifiedLocal !== undefined) {
		if (typeof fields.allowUnverifiedLocal !== 'boolean') {
			fail(`${path}.allowUnverifiedLocal`, 'expected a boolean');
		}
		allowUnverifiedLocal = fields.allowUnverifiedLocal;
	}

	let changeAuthors: Record<string, string> | undefined;
	if (fields.changeAuthors !== undefined) {
		if (
			typeof fields.changeAuthors !== 'object' ||
			fields.changeAuthors === null ||
			Array.isArray(fields.changeAuthors)
		) {
			fail(`${path}.changeAuthors`, 'expected a record of change id to author id');
		}
		changeAuthors = {};
		for (const [k, v] of Object.entries(fields.changeAuthors as Record<string, unknown>)) {
			if (!k.trim()) fail(`${path}.changeAuthors`, 'expected a non-empty change id key');
			changeAuthors[k] = text(v, `${path}.changeAuthors.${k}`);
		}
	}

	let memberCostUsd: number | undefined;
	if (fields.memberCostUsd !== undefined) {
		if (
			typeof fields.memberCostUsd !== 'number' ||
			!Number.isFinite(fields.memberCostUsd) ||
			fields.memberCostUsd < 0
		) {
			fail(`${path}.memberCostUsd`, 'expected a finite non-negative number');
		}
		memberCostUsd = fields.memberCostUsd;
	}

	return {
		...(personas === undefined ? {} : { personas }),
		...(jobs === undefined ? {} : { jobs }),
		...(scenariosDir === undefined ? {} : { scenariosDir }),
		...(driver === undefined ? {} : { driver }),
		...(allowUnverifiedLocal === undefined ? {} : { allowUnverifiedLocal }),
		...(changeAuthors === undefined ? {} : { changeAuthors }),
		...(memberCostUsd === undefined ? {} : { memberCostUsd }),
	};
}
