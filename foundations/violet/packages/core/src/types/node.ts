import { z } from 'zod';

/**
 * Node types in the design system tree
 */
export const NodeTypeSchema = z.enum([
	'root', // Global base node
	'product', // Product line (Xbox, VS Code)
	'platform', // Technical platform (web, ios, android)
	'device', // Input/interaction (touch, mouse, controller)
	'locale', // Language/region (en-US, de-DE)
	'theme', // Visual theme (light, dark, high-contrast)
	'experiment', // A/B test variant
	'shared', // Published for external use
	'custom', // Any other context
]);

export type NodeType = z.infer<typeof NodeTypeSchema>;

/**
 * Node status
 */
export const NodeStatusSchema = z.enum(['active', 'deprecated', 'experimental']);

export type NodeStatus = z.infer<typeof NodeStatusSchema>;

/**
 * Include policy for mixin composition
 */
export const IncludePolicySchema = z.enum(['merge', 'override']);

export type IncludePolicy = z.infer<typeof IncludePolicySchema>;

/**
 * A calendar day, `YYYY-MM-DD`: when a deprecated node goes away
 */
export const SunsetDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-03-31')
	.refine(
		(date) => {
			const day = new Date(`${date}T00:00:00Z`);
			return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(date);
		},
		{ message: 'Not a real calendar date' },
	);

/**
 * Node in the design system tree
 */
export const NodeSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	parentId: z.string().nullable(),
	type: NodeTypeSchema,
	owner: z.string().optional(),
	status: NodeStatusSchema.default('active'),

	// Deprecation plan: the day the node goes away and the node that replaces it
	sunsetAt: SunsetDateSchema.nullable().optional(),
	replacedBy: z.string().min(1).nullable().optional(),

	// Composition via includes (mixins)
	includes: z.array(z.string()).default([]),
	includePolicy: IncludePolicySchema.default('merge'),

	// Tags for cross-cutting queries
	tags: z.array(z.string()).default([]),

	// Timestamps
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
	deletedAt: z.string().datetime().nullable().default(null),
});

export type Node = z.infer<typeof NodeSchema>;

/**
 * Input for creating a new node
 */
export const CreateNodeInputSchema = z.object({
	id: z.string().min(1).optional(), // Auto-generated if not provided
	name: z.string().min(1),
	parentId: z.string().nullable().optional().default(null),
	type: NodeTypeSchema.optional().default('custom'),
	owner: z.string().optional(),
	status: NodeStatusSchema.optional().default('active'),
	sunsetAt: SunsetDateSchema.optional(),
	replacedBy: z.string().min(1).optional(),
	includes: z.array(z.string()).optional().default([]),
	includePolicy: IncludePolicySchema.optional().default('merge'),
	tags: z.array(z.string()).optional().default([]),
});

export type CreateNodeInput = z.infer<typeof CreateNodeInputSchema>;

/**
 * Input for updating a node
 */
export const UpdateNodeInputSchema = z.object({
	name: z.string().min(1).optional(),
	type: NodeTypeSchema.optional(),
	owner: z.string().optional(),
	status: NodeStatusSchema.optional(),
	/** null clears the date */
	sunsetAt: SunsetDateSchema.nullable().optional(),
	/** null clears the replacement */
	replacedBy: z.string().min(1).nullable().optional(),
	includes: z.array(z.string()).optional(),
	includePolicy: IncludePolicySchema.optional(),
	tags: z.array(z.string()).optional(),
});

export type UpdateNodeInput = z.infer<typeof UpdateNodeInputSchema>;

/**
 * Node with computed properties (for queries)
 */
export interface NodeWithAncestry extends Node {
	ancestryChain: string[];
	depth: number;
}

/**
 * Node tree view (for listing)
 */
export interface NodeTreeItem {
	id: string;
	name: string;
	type: NodeType;
	status: NodeStatus;
	depth: number;
	children: NodeTreeItem[];
}
