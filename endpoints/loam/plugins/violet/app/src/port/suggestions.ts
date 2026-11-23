/**
 * @fileoverview Error suggestion rewriting from Violet's dotted commands to Loam's `violet-*` commands (spec §5.8).
 */
import type { CommandError } from '@lushly-dev/loam-sdk';

const COMMAND_REWRITES: ReadonlyArray<readonly [RegExp, string]> = [
	[/\bviolet\s+call\s+[^\s'"]+\s+--schema\b/g, 'afd-detail'],
	[/\bviolet\s+call\b/g, 'afd-call'],
	[/\bviolet\s+node\s+list\b/g, 'violet-node-list'],
	[/\bnode\.list\b/g, 'violet-node-list'],
	[/\bnode\.get\b/g, 'violet-node-get'],
	[/\bnode\.create\b/g, 'violet-node-create'],
	[/\bnode\.delete\b/g, 'violet-node-delete'],
	[/\bnode\.update\b/g, 'violet-node-create'],
	[/\btokens\.resolve\b/g, 'violet-token-resolve'],
	[/\btokens\.compare\b/g, 'violet-token-compare'],
	[/\btokens\.catalog\b/g, 'violet-token-find'],
	[/\btoken\.lineage\b/g, 'violet-token-lineage'],
	[/\btoken\.add\b/g, 'violet-token-add'],
	[/\btoken\.override\b/g, 'violet-token-override'],
	[/\btoken\.reset\b/g, 'violet-token-reset'],
	[/\btoken\.remove\b/g, 'violet-token-reset'],
	[/\btoken\.subtract\b/g, 'violet-token-reset'],
	[/\btoken\.copy\b/g, 'violet-token-override'],
	[/\bchanges\.impact\b/g, 'violet-change-preview'],
	[/\baudit\.list\b/g, 'violet-change-list'],
	[/\bconstraints\.set\b/g, 'violet-constraint-set'],
	[/\banalyze\.violations\b/g, 'violet-violation-list'],
	[/\binterface\.check\b/g, 'violet-interface-check'],
	[/\bexport\.tree\b/g, 'violet-tree-export'],
	[/\bimport\.tree\b/g, 'violet-tree-import'],
	[/\bexport\b(?=\s+command|\s+with)/g, 'violet-export'],
];

/** Rewrite dotted Violet command names and forbidden CLI flags inside any text. */
export function rewriteText(text: string): string {
	let out = text;
	for (const [pattern, replacement] of COMMAND_REWRITES) {
		out = out.replace(pattern, replacement);
	}
	out = out.replace(/,\s*or\s+pass\s+force:\s*true\b/gi, '');
	out = out.replace(/\bwith\s+force:\s*true\b/gi, '');
	out = out.replace(/\bforce:\s*true\b/gi, '');
	out = out.replace(/\s+--force\b/g, '');
	out = out.replace(/\b--force\b/g, '');
	out = out.replace(/\s+--schema\b/g, '');
	out = out.replace(/\b--schema\b/g, '');
	return out.replace(/\s{2,}/g, ' ').trim();
}

export interface RewriteErrorOptions {
	appCommand: string;
	violetCommand: string;
	otherDocument?: string;
	tokenType?: string;
	warnings?: ReadonlyArray<{ code?: string; message?: string; details?: Record<string, unknown> }>;
}

/** Map a Violet error into a Loam `CommandError` whose suggestion names only real app commands (spec §5.8). */
export function rewriteVioletError(
	raw: {
		code: string;
		message: string;
		suggestion?: string;
		retryable?: boolean;
		details?: Record<string, unknown>;
	},
	options: RewriteErrorOptions
): CommandError {
	const code = raw.code;
	const message = rewriteText(raw.message);
	let suggestion = raw.suggestion ? rewriteText(raw.suggestion) : '';

	switch (code) {
		case 'NODE_NOT_FOUND': {
			suggestion = options.otherDocument
				? `Use violet-node-list on tree '${options.otherDocument}' to see available nodes`
				: 'Use violet-node-list to see available nodes';
			break;
		}
		case 'TOKEN_NOT_FOUND': {
			if (options.violetCommand === 'token.lineage') {
				suggestion = 'Use violet-token-find to search for tokens in this tree';
			} else if (options.violetCommand === 'token.override') {
				suggestion =
					'Use violet-token-add to define a new token, or violet-token-find to search existing tokens';
			} else if (options.violetCommand === 'token.remove') {
				suggestion =
					'Use violet-token-lineage or violet-node-get to see which node defines or overrides this token';
			} else {
				suggestion = suggestion || 'Use violet-token-find to search for tokens in this tree';
			}
			break;
		}
		case 'NODE_ALREADY_EXISTS': {
			if (message.toLowerCase().includes('deleted')) {
				suggestion =
					'Use violet-node-list to see active nodes, or call violet-node-create with restore: true to bring back the deleted node';
			} else {
				suggestion = 'Use violet-node-list to see existing nodes and choose a different id';
			}
			break;
		}
		case 'NODE_HAS_CHILDREN': {
			const childrenWarning = options.warnings?.find((w) => w.code === 'HAS_CHILDREN');
			const warningText = childrenWarning?.message ? rewriteText(childrenWarning.message) : '';
			suggestion = warningText
				? `Delete or move child nodes first (${warningText}), then run violet-node-delete again`
				: 'Delete child nodes first (use violet-node-list to see them), then run violet-node-delete again';
			break;
		}
		case 'INVALID_TOKEN_VALUE': {
			const prefix = options.tokenType
				? `Give a plain ${options.tokenType} value`
				: 'Give a plain value of the token type';
			const detail = suggestion ? ` (${suggestion.replace(/colour/gi, 'color')})` : '';
			suggestion = `${prefix}${detail}`;
			break;
		}
		case 'INVALID_PARENT': {
			suggestion =
				'Use violet-node-list to pick an existing, active parent node id before creating or importing';
			break;
		}
		case 'OPERATION_NOT_ALLOWED': {
			if (options.violetCommand === 'export.tree') {
				suggestion =
					'Replace each subtract, reset or copy with violet-token-override or violet-token-reset, then run violet-tree-export again';
			} else if (options.violetCommand === 'token.remove') {
				suggestion =
					suggestion ||
					'Remove or update dependent nodes first with violet-token-reset, then try again';
			} else if (options.violetCommand === 'import.tree') {
				suggestion =
					'Export unexported changes first with violet-tree-export, then pass exportedRev to violet-tree-import';
			} else {
				suggestion = suggestion || 'Check the tree state with violet-node-list before retrying';
			}
			break;
		}
		case 'TOKEN_REFERENCE_NOT_FOUND': {
			suggestion =
				'Use violet-token-lineage to inspect the missing reference and fix it with violet-token-override';
			break;
		}
		case 'CIRCULAR_REFERENCE': {
			suggestion =
				'Use violet-token-lineage to inspect the alias cycle and break it with violet-token-override';
			break;
		}
		case 'NOT_IMPLEMENTED': {
			suggestion =
				'Replace the reference transform with a plain value using violet-token-override before exporting';
			break;
		}
		case 'DUPLICATE_CONSTRAINT_ID': {
			suggestion =
				'Give each constraint a unique id, or pass merge: false to violet-constraint-set to replace existing rules';
			break;
		}
		case 'TOKEN_ALREADY_EXISTS': {
			suggestion = 'Use violet-token-override to change an existing token value';
			break;
		}
		case 'VALIDATION_ERROR': {
			suggestion =
				suggestion ||
				`Check the input against ${options.appCommand}'s schema (afd-detail returns it)`;
			break;
		}
		case 'INTERNAL_ERROR': {
			suggestion = 'Report this with the tree exported files from violet-tree-export';
			break;
		}
		default: {
			suggestion =
				suggestion ||
				`Check the input against ${options.appCommand}'s schema (afd-detail returns it)`;
			break;
		}
	}

	return {
		code,
		message,
		suggestion: rewriteText(suggestion),
		...(raw.retryable !== undefined ? { retryable: raw.retryable } : {}),
		...(raw.details !== undefined ? { details: raw.details } : {}),
	};
}
