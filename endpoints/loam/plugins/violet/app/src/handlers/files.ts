/**
 * @fileoverview File export and import handlers (`violet-export`, `violet-tree-import`, `violet-tree-export`, spec §6.5).
 */
import { type AppCallContextV1, type CommandResult, failure, success } from '@lushly-dev/loam-sdk';
import { resolveInterface } from '../interface.js';
import { defaultPort, type TreeFile, type VioletPort } from '../port/engine.js';

export function createFileHandlers(port: VioletPort = defaultPort) {
	return {
		async 'violet-export'(
			input: { document: string; node: string; format: string; selector?: string },
			context: AppCallContextV1
		) {
			return port.read(input.document, context, 'violet-export', async ({ engine }) => {
				const exported = await engine.call<{
					format: string;
					content: string;
					tokenCount: number;
				}>('export', {
					nodeId: input.node,
					format: input.format,
					...(input.selector ? { selector: input.selector } : {}),
				});
				if (!exported.success || !exported.data) return exported as CommandResult<never>;

				const violRes = await engine.call<{ violations: Array<{ nodeId: string }> }>(
					'analyze.violations',
					{ rootId: input.node }
				);
				if (!violRes.success || !violRes.data) return violRes as CommandResult<never>;
				const violations = violRes.data.violations.filter((v) => v.nodeId === input.node).length;

				const ifaceRes = await engine.call<{ missing: unknown[] }>('interface.check', {
					interface: resolveInterface(context.config),
					nodes: [input.node],
				});
				if (!ifaceRes.success || !ifaceRes.data) return ifaceRes as CommandResult<never>;
				const unfilled = ifaceRes.data.missing.length;

				return success({
					format: exported.data.format,
					content: exported.data.content,
					tokenCount: exported.data.tokenCount,
					checks: { violations, unfilled },
				});
			});
		},

		async 'violet-tree-import'(
			input: {
				document: string;
				content: { files: TreeFile[] };
				replace?: boolean;
				exportedRev?: number;
			},
			context: AppCallContextV1
		) {
			return port.write(
				input.document,
				context,
				'violet-tree-import',
				async ({ db, content, replaceDatabase }) => {
					const replace = input.replace ?? false;
					const unexported = content.rev - content.syncedRev;
					if (replace && unexported > 0 && input.exportedRev !== content.rev) {
						return failure({
							code: 'OPERATION_NOT_ALLOWED',
							message: `Tree has ${unexported} unexported change(s); replacing it would discard them`,
							suggestion:
								'Export the tree first with violet-tree-export and pass its rev as exportedRev to violet-tree-import',
						});
					}

					const imported = await port.importFiles(input.content.files, {}, context, {
						...(replace ? {} : { baseDb: db }),
					});
					if (!imported.success || !imported.data) return imported as CommandResult<never>;

					// Preserve existing syncedRev on additive import over a dirty tree (spec §4.5, §5.3).
					const syncRev = replace || unexported === 0;
					replaceDatabase(imported.data.db, { syncRev });

					return success({
						nodes: imported.data.nodes,
						rev: content.rev + 1,
					});
				}
			);
		},

		async 'violet-tree-export'(input: { document: string }, context: AppCallContextV1) {
			return port.read(
				input.document,
				context,
				'violet-tree-export',
				async ({ engine, content }) => {
					const res = await engine.call<{
						files: Array<{ name: string; content: string }>;
						dropped: Array<{ node: string; token?: string; fields: string[] }>;
					}>('export.tree', {});
					if (!res.success || !res.data) return res as CommandResult<never>;

					return success({
						content: {
							files: res.data.files.map((f) => ({ name: f.name, content: f.content })),
						},
						rev: content.rev,
						dropped: [...res.data.dropped],
					});
				}
			);
		},
	};
}
