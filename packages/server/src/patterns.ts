/**
 * @fileoverview Common input schemas. Classic Zod, so this module is only for the root entry: it
 * builds its schemas as it loads, which a browser bundle should not pay for unasked.
 */

import { z } from 'zod';

export const patterns = {
	uuid: z.string().uuid(),
	email: z.string().email(),
	url: z.string().url(),
	nonEmpty: z.string().min(1),
	positiveInt: z.number().int().positive(),
	nonNegativeInt: z.number().int().nonnegative(),
	isoDate: z.string().datetime(),
	pagination: z.object({
		limit: z.number().int().min(1).max(100).default(20),
		offset: z.number().int().nonnegative().default(0),
	}),
	sorting: z.object({
		sortBy: z
			.string()
			.min(1)
			.regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/, 'sortBy must be a valid identifier'),
		sortDirection: z.enum(['asc', 'desc']).default('asc'),
	}),
	search: z.object({
		query: z.string().min(1),
		fields: z.array(z.string().min(1)).optional(),
	}),
	dateRange: z
		.object({
			startDate: z.string().datetime(),
			endDate: z.string().datetime(),
		})
		.refine((d) => d.startDate <= d.endDate, {
			message: 'startDate must be before or equal to endDate',
		}),
};

// ═══════════════════════════════════════════════════════════════════════════════
// INFERRED TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** Inferred input type for pagination schema (before defaults applied). */
export type PaginationInput = z.input<typeof patterns.pagination>;

/** Inferred output type for pagination schema (after defaults applied). */
export type Pagination = z.output<typeof patterns.pagination>;

/** Inferred input type for sorting schema (before defaults applied). */
export type SortingInput = z.input<typeof patterns.sorting>;

/** Inferred output type for sorting schema (after defaults applied). */
export type Sorting = z.output<typeof patterns.sorting>;

/** Inferred type for search schema. */
export type Search = z.infer<typeof patterns.search>;

/** Inferred type for date range schema. */
export type DateRange = z.infer<typeof patterns.dateRange>;
