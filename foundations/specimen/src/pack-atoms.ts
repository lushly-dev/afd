import { z } from 'zod';

/** The component pack format's current version. Readers accept uniform format 1 and format 2. */
export const PACK_FORMAT_VERSION = 2;

/** Format versions `checkPack` accepts (uniform within each library). */
export const SUPPORTED_PACK_FORMAT_VERSIONS = [1, 2] as const;

/**
 * Identifier patterns. A reader may put a value that matches one of these outside the part of an
 * answer labelled as content, so each admits only a short ASCII alphabet with no spaces. Every
 * pattern is ASCII-only and means the same in ECMAScript and in Rust's `regex` crate.
 */
export const PACK_PATTERNS = {
	library: /^[a-z][a-z0-9-]{0,63}$/,
	tag: /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/,
	prefix: /^[a-z][a-z0-9._]*-$/,
	element: /^[a-z][a-z0-9._-]*$/,
	id: /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/,
	version:
		/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
	digest: /^sha256:[0-9a-f]{64}$/,
	revision: /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/,
	package: /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/,
	specifier: /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(?:\/[A-Za-z0-9._~-]+)*$/,
	story: /^[a-z0-9][a-z0-9._-]*$/,
	attribute: /^[a-z][a-z0-9_.:-]*$/,
	property: /^[A-Za-z_$][A-Za-z0-9_$]*$/,
	slot: /^(?:|[A-Za-z][A-Za-z0-9_.:-]*)$/,
	event: /^[A-Za-z][A-Za-z0-9_.:-]*$/,
	command: /^(?:--)?[a-z][a-z0-9-]*$/,
	cssProperty: /^--[A-Za-z0-9_-]+$/,
	state: /^[a-z][a-z0-9-]*$/,
	role: /^[a-z]+$/,
	axeRule: /^[a-z0-9-]+$/,
	pattern: /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/,
	qualifiedPattern: /^[a-z][a-z0-9-]{0,63}\/[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/,
	copyName: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
	setup: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
	gate: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
	alias: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
	facetKey: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
	facetValue: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
	stepId: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
} as const;

/** Longest identifier of each kind, in characters. */
export const IDENTIFIER_MAX: Record<keyof typeof PACK_PATTERNS, number> = {
	library: 64,
	tag: 100,
	prefix: 32,
	element: 100,
	id: 128,
	version: 64,
	digest: 71,
	revision: 64,
	package: 214,
	specifier: 256,
	story: 200,
	attribute: 100,
	property: 100,
	slot: 100,
	event: 100,
	command: 100,
	cssProperty: 100,
	state: 64,
	role: 32,
	axeRule: 64,
	pattern: 64,
	qualifiedPattern: 129,
	copyName: 64,
	setup: 64,
	gate: 64,
	alias: 64,
	facetKey: 64,
	facetValue: 64,
	stepId: 64,
};

/** Longest text of each kind, in Unicode code points. */
export const PACK_TEXT_LIMITS = {
	summary: 160,
	statement: 240,
	title: 80,
	value: 200,
	detail: 8000,
	example: 4000,
	copyHtml: 16000,
	copyCss: 8000,
} as const;

/** Marks a text or identifier issue so a check can name it apart from a shape problem. */
export const TEXT_TOO_LONG = 'pack-text-too-long';
export const TEXT_INVALID = 'pack-text-invalid';
export const IDENTIFIER_INVALID = 'pack-identifier-invalid';

// A one-line text has no control character (C0, DEL or C1) and no bidirectional embedding,
// override or isolate; a multi-line text may also hold tabs and line feeds.
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const SINGLE_LINE = /^[^\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]*$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const MULTI_LINE = /^[^\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]*$/;

/** An identifier field of this kind. Guide and pattern files use the same fields as the pack. */
export const packIdentifier = (kind: keyof typeof PACK_PATTERNS) => {
	const base = z.string().max(IDENTIFIER_MAX[kind]).regex(PACK_PATTERNS[kind]);
	if (kind !== 'qualifiedPattern') return base;
	return base
		.refine((value) => {
			const slash = value.indexOf('/');
			return (
				slash > 0 &&
				slash <= IDENTIFIER_MAX.library &&
				value.length - slash - 1 <= IDENTIFIER_MAX.pattern
			);
		}, 'Both library and pattern segments must be at most 64 characters')
		.meta({ allOf: [{ pattern: '/[a-z0-9.-]{1,64}$' }] });
};

/**
 * A pattern reference: either a local `<pattern>` or a qualified `<library>/<pattern>` (each
 * segment at most 64 characters). Reports a single `IDENTIFIER_INVALID` for any malformed string
 * while emitting the draft 2020-12 `anyOf` JSON Schema.
 */
export const packPatternRef = () =>
	z
		.string()
		.superRefine((value, context) => {
			if (value.includes('/')) {
				const slash = value.indexOf('/');
				const ok =
					value.length <= IDENTIFIER_MAX.qualifiedPattern &&
					PACK_PATTERNS.qualifiedPattern.test(value) &&
					slash > 0 &&
					slash <= IDENTIFIER_MAX.library &&
					value.length - slash - 1 <= IDENTIFIER_MAX.pattern;
				if (!ok)
					context.addIssue({
						code: 'custom',
						message: 'Invalid qualified pattern identifier',
						params: { pack: IDENTIFIER_INVALID },
					});
			} else if (value.length > IDENTIFIER_MAX.pattern || !PACK_PATTERNS.pattern.test(value)) {
				context.addIssue({
					code: 'custom',
					message: 'Invalid pattern identifier',
					params: { pack: IDENTIFIER_INVALID },
				});
			}
		})
		.meta({
			anyOf: [
				{
					type: 'string',
					maxLength: IDENTIFIER_MAX.pattern,
					pattern: PACK_PATTERNS.pattern.source,
				},
				{
					type: 'string',
					maxLength: IDENTIFIER_MAX.qualifiedPattern,
					pattern: PACK_PATTERNS.qualifiedPattern.source,
					allOf: [{ pattern: '/[a-z0-9.-]{1,64}$' }],
				},
			],
		});

/** A text field of at most `max` code points, refusing control characters. */
export const packText = (max: number, lines: 'single' | 'multi' = 'single', min = 1) => {
	const allowed = lines === 'single' ? SINGLE_LINE : MULTI_LINE;
	return z
		.string()
		.min(min)
		.superRefine((value, context) => {
			if ([...value].length > max)
				context.addIssue({
					code: 'custom',
					message: `Longer than ${max} characters`,
					params: { pack: TEXT_TOO_LONG },
				});
			if (!allowed.test(value) || !value.isWellFormed())
				context.addIssue({
					code: 'custom',
					message:
						lines === 'single'
							? 'Contains a control character, a line break or a lone surrogate'
							: 'Contains a control character or a lone surrogate',
					params: { pack: TEXT_INVALID },
				});
		})
		.meta({ maxLength: max, pattern: allowed.source });
};

export const isAscendingUnique = (values: readonly string[]): boolean => {
	for (let index = 1; index < values.length; index++) {
		if ((values[index - 1] as string) >= (values[index] as string)) return false;
	}
	return true;
};

export const isUnique = (values: readonly string[]): boolean =>
	new Set(values).size === values.length;

const viewportBoundsSchema = z
	.strictObject({
		minWidth: z.number().int().min(1).max(8192).optional(),
		maxWidth: z.number().int().min(1).max(8192).optional(),
		minHeight: z.number().int().min(1).max(8192).optional(),
		maxHeight: z.number().int().min(1).max(8192).optional(),
	})
	.refine(
		(value) =>
			value.minWidth !== undefined ||
			value.maxWidth !== undefined ||
			value.minHeight !== undefined ||
			value.maxHeight !== undefined,
		'Viewport bounds must specify at least one of minWidth, maxWidth, minHeight, or maxHeight'
	)
	.refine(
		(value) =>
			value.minWidth === undefined ||
			value.maxWidth === undefined ||
			value.maxWidth >= value.minWidth,
		{ message: 'maxWidth must be >= minWidth', path: ['maxWidth'] }
	)
	.refine(
		(value) =>
			value.minHeight === undefined ||
			value.maxHeight === undefined ||
			value.maxHeight >= value.minHeight,
		{ message: 'maxHeight must be >= minHeight', path: ['maxHeight'] }
	)
	.meta({ minProperties: 1 });

/**
 * Implementation contexts for pack records: leaves `themes` ordering/uniqueness to `checkPack` so
 * out-of-order reports `NOT_CANONICAL` and repeats report `DUPLICATE_ID` at the element pointer.
 */
export const packImplementationContextsSchema = z
	.strictObject({
		viewport: viewportBoundsSchema.optional(),
		themes: z
			.array(z.enum(['dark', 'high-contrast', 'light']))
			.min(1)
			.max(3)
			.optional(),
		reason: packText(PACK_TEXT_LIMITS.statement),
	})
	.refine(
		(value) => value.viewport !== undefined || value.themes !== undefined,
		'Implementation contexts must specify at least one of viewport or themes'
	)
	.meta({
		anyOf: [{ required: ['viewport'] }, { required: ['themes'] }],
	});

/**
 * Pattern facets for pack records: leaves per-key value ordering/uniqueness to `checkPack` so
 * out-of-order reports `NOT_CANONICAL` and repeats report `DUPLICATE_ID`.
 */
export const packFacetsSchema = z
	.record(packIdentifier('facetKey'), z.array(packIdentifier('facetValue')).min(1).max(16))
	.refine((value) => Object.keys(value).length <= 8, 'A pattern may declare at most 8 facet keys')
	.meta({ maxProperties: 8 });

export const roleSetSchema = z.union([
	packIdentifier('role'),
	z
		.array(packIdentifier('role'))
		.min(1)
		.max(8)
		.refine(isUnique, 'Target roles must be unique')
		.meta({ uniqueItems: true }),
]);

export const patternTargetSchema = z
	.strictObject({
		role: roleSetSchema,
		name: packText(PACK_TEXT_LIMITS.summary).optional(),
		nameStartsWith: packText(PACK_TEXT_LIMITS.summary).optional(),
		nameContains: packText(PACK_TEXT_LIMITS.summary).optional(),
	})
	.refine((value) => {
		const count =
			Number(value.name !== undefined) +
			Number(value.nameStartsWith !== undefined) +
			Number(value.nameContains !== undefined);
		return count <= 1;
	}, 'Specify at most one of name, nameStartsWith, or nameContains')
	.meta({
		not: {
			anyOf: [
				{ required: ['name', 'nameStartsWith'] },
				{ required: ['name', 'nameContains'] },
				{ required: ['nameStartsWith', 'nameContains'] },
			],
		},
	});

export const patternSetupSchema = z.strictObject({
	text: packText(PACK_TEXT_LIMITS.statement),
	targets: z
		.record(packIdentifier('alias'), patternTargetSchema)
		.refine((record) => {
			const count = Object.keys(record).length;
			return count >= 1 && count <= 16;
		}, 'A setup must declare between 1 and 16 targets')
		.meta({ minProperties: 1, maxProperties: 16 }),
});

const timeoutMsSchema = z.number().int().min(1).max(60_000);

export const portableActionSchema = z.union([
	z.strictObject({ click: packIdentifier('alias') }),
	z.strictObject({ focus: packIdentifier('alias') }),
	z.strictObject({ hover: packIdentifier('alias') }),
	z.strictObject({
		fill: packIdentifier('alias'),
		value: packText(PACK_TEXT_LIMITS.statement, 'multi', 0),
	}),
	z.strictObject({
		press: packText(64, 'single', 1),
		target: packIdentifier('alias').optional(),
	}),
]);

export const standardDomEventSchema = z.enum(['input', 'change', 'submit', 'reset']);

export const portableEventExpectationSchema = z.strictObject({
	event: standardDomEventSchema,
	target: packIdentifier('alias').optional(),
	since: packIdentifier('stepId'),
	timeoutMs: timeoutMsSchema.optional(),
	absent: z.boolean().optional(),
});

export const portableFormExpectationSchema = z.strictObject({
	target: packIdentifier('alias'),
	form: z.strictObject({
		name: packText(PACK_TEXT_LIMITS.summary),
		value: packText(PACK_TEXT_LIMITS.value, 'multi', 0).nullable(),
	}),
	timeoutMs: timeoutMsSchema.optional(),
});

export const portableValidityExpectationSchema = z.strictObject({
	target: packIdentifier('alias'),
	validity: z.strictObject({ valid: z.boolean() }),
	timeoutMs: timeoutMsSchema.optional(),
});

export const a11yExpectationSchema = z.strictObject({
	target: packIdentifier('alias'),
	a11y: z
		.strictObject({
			role: roleSetSchema.optional(),
			name: packText(PACK_TEXT_LIMITS.summary, 'single', 0).optional(),
			nameNonEmpty: z.boolean().optional(),
			nameContains: packText(PACK_TEXT_LIMITS.summary).optional(),
			expanded: z.boolean().optional(),
			selected: z.boolean().optional(),
			checked: z.union([z.boolean(), z.literal('mixed')]).optional(),
			pressed: z.union([z.boolean(), z.literal('mixed')]).optional(),
			disabled: z.boolean().optional(),
			invalid: z.union([z.boolean(), z.literal('grammar'), z.literal('spelling')]).optional(),
			readonly: z.boolean().optional(),
			required: z.boolean().optional(),
			level: z.number().int().min(1).max(6).optional(),
		})
		.refine(
			(value) => Object.keys(value).length > 0,
			'An a11y expectation must assert at least one property'
		)
		.refine(
			(value) =>
				value.name === undefined ||
				(value.nameNonEmpty === undefined && value.nameContains === undefined),
			'a11y.name is mutually exclusive with nameNonEmpty and nameContains'
		)
		.meta({
			minProperties: 1,
			not: {
				anyOf: [{ required: ['name', 'nameNonEmpty'] }, { required: ['name', 'nameContains'] }],
			},
		}),
	timeoutMs: timeoutMsSchema.optional(),
});

export const focusExpectationSchema = z.strictObject({
	target: packIdentifier('alias'),
	focus: z.boolean(),
	timeoutMs: timeoutMsSchema.optional(),
});

export const layoutExpectationSchema = z.strictObject({
	target: packIdentifier('alias'),
	layout: z
		.strictObject({
			minHeight: z.number().int().min(1).max(8192).optional(),
			minWidth: z.number().int().min(1).max(8192).optional(),
			noOverflow: z.boolean().optional(),
			noOuterMargin: z.boolean().optional(),
		})
		.refine(
			(value) => Object.keys(value).length > 0,
			'A layout expectation must assert at least one property'
		)
		.meta({ minProperties: 1 }),
	timeoutMs: timeoutMsSchema.optional(),
});

export const portableExpectationSchema = z.union([
	portableEventExpectationSchema,
	portableFormExpectationSchema,
	portableValidityExpectationSchema,
	a11yExpectationSchema,
	focusExpectationSchema,
	layoutExpectationSchema,
]);

export const portableScenarioStepSchema = z.union([
	z.strictObject({ id: packIdentifier('stepId'), action: portableActionSchema }),
	z.strictObject({ id: packIdentifier('stepId'), expect: portableExpectationSchema }),
]);

export const packPatternGateContextSchema = z.strictObject({
	viewport: z
		.strictObject({
			width: z.number().int().min(1).max(8192),
			height: z.number().int().min(1).max(8192),
		})
		.optional(),
	container: z
		.strictObject({
			width: z.number().int().min(1).max(8192),
			height: z.number().int().min(1).max(8192).optional(),
		})
		.optional(),
	theme: z.enum(['light', 'dark', 'high-contrast']).optional(),
	locale: packText(PACK_TEXT_LIMITS.summary, 'single', 1).optional(),
	reducedMotion: z.enum(['reduce', 'no-preference']).optional(),
	motion: z.enum(['natural', 'settled']).optional(),
});

export const packPatternGateSchema = z.strictObject({
	setup: packIdentifier('setup'),
	context: packPatternGateContextSchema.optional(),
	scenario: z.array(portableScenarioStepSchema).min(1).max(32),
});

export const patternStatementSchema = z.strictObject({
	id: packIdentifier('id'),
	text: packText(PACK_TEXT_LIMITS.statement),
});

export const patternKeepStatementSchema = z.strictObject({
	id: packIdentifier('id'),
	text: packText(PACK_TEXT_LIMITS.statement),
	gate: packIdentifier('gate').optional(),
});
