/**
 * @fileoverview Unit tests for export command
 */

import { createMemoryDatabase } from '@lushly-dev/violet-core/engine';
import { initializeExport } from '@lushly-dev/violet-core/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeCreateCommand } from '../node/create.js';
import type { CommandContext } from '../registry.js';
import { tokenAddCommand } from '../token/add.js';
import { exportCommand } from './export.js';

// Initialize export transformers
initializeExport();

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

describe('export command', () => {
	let db: ReturnType<typeof createMemoryDatabase>;
	let context: CommandContext;

	beforeEach(async () => {
		db = createMemoryDatabase();
		context = { db, actor: 'test', traceId: 'test-trace' };

		// Create a test node with tokens
		await nodeCreateCommand.handler({ name: 'test-root', type: 'root', parentId: null }, context);

		await tokenAddCommand.handler(
			{
				nodeId: 'test-root',
				tokenId: 'color.brand.primary',
				value: '#0078D4',
			},
			context,
		);

		await tokenAddCommand.handler(
			{
				nodeId: 'test-root',
				tokenId: 'color.brand.secondary',
				value: '#00A4EF',
			},
			context,
		);

		await tokenAddCommand.handler(
			{
				nodeId: 'test-root',
				tokenId: 'spacing.small',
				value: '8px',
			},
			context,
		);
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// JSON EXPORT
	// ═══════════════════════════════════════════════════════════════════════════

	describe('JSON export', () => {
		it('exports tokens as Style Dictionary JSON', async () => {
			const result = await exportCommand.handler({ nodeId: 'test-root', format: 'json' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.format).toBe('json');
			expect(result.data?.tokenCount).toBe(3);

			const parsed = JSON.parse(result.data?.content || '{}');
			expect(parsed.color.brand.primary.value).toBe('#0078D4');
			expect(parsed.color.brand.secondary.value).toBe('#00A4EF');
			expect(parsed.spacing.small.value).toBe('8px');
		});

		it('filters tokens by pattern', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'json', filter: 'color.*' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.tokenCount).toBe(2);
		});

		it('applies prefix to token names', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'json', prefix: 'ds' },
				context,
			);

			expect(result.success).toBe(true);
			const parsed = JSON.parse(result.data?.content || '{}');
			expect(parsed.ds).toBeDefined();
			expect(parsed.ds.color).toBeDefined();
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// CSS EXPORT
	// ═══════════════════════════════════════════════════════════════════════════

	describe('CSS export', () => {
		it('exports tokens as CSS custom properties', async () => {
			const result = await exportCommand.handler({ nodeId: 'test-root', format: 'css' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.format).toBe('css');
			expect(result.data?.content).toContain(':root');
			expect(result.data?.content).toContain('--color-brand-primary: #0078D4');
			expect(result.data?.content).toContain('--color-brand-secondary: #00A4EF');
			expect(result.data?.content).toContain('--spacing-small: 8px');
		});

		it('uses custom selector', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'css', selector: '.theme-dark' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.content).toContain('.theme-dark');
			expect(result.data?.content).not.toContain(':root');
		});

		it('includes comments when requested', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'css', includeComments: true },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.content).toContain('/*');
		});

		it('applies prefix to variable names', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'css', prefix: 'ds' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.content).toContain('--ds-color-brand-primary');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// SCSS EXPORT
	// ═══════════════════════════════════════════════════════════════════════════

	describe('SCSS export', () => {
		it('exports tokens as SCSS variables', async () => {
			const result = await exportCommand.handler({ nodeId: 'test-root', format: 'scss' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.format).toBe('scss');
			expect(result.data?.content).toContain('$color-brand-primary: #0078D4');
			expect(result.data?.content).toContain('$color-brand-secondary: #00A4EF');
			expect(result.data?.content).toContain('$spacing-small: 8px');
		});

		it('groups by category when requested', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'scss', groupByCategory: true },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.content).toContain('// Color');
			expect(result.data?.content).toContain('// Spacing');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// TYPESCRIPT EXPORT
	// ═══════════════════════════════════════════════════════════════════════════

	describe('TypeScript export', () => {
		it('exports tokens as TypeScript constants (nested)', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'typescript', exportStyle: 'nested' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.format).toBe('typescript');
			expect(result.data?.content).toContain('export const tokens');
			expect(result.data?.content).toContain('color:');
			expect(result.data?.content).toContain('brand:');
			expect(result.data?.content).toContain("primary: '#0078D4'");
		});

		it('exports tokens as TypeScript constants (flat)', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'typescript', exportStyle: 'flat' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.content).toContain('colorBrandPrimary');
			expect(result.data?.content).toContain('colorBrandSecondary');
			expect(result.data?.content).toContain('spacingSmall');
		});

		it('uses default export when requested', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'typescript', exportType: 'default' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.content).toContain('export default');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// SWIFT EXPORT (Phase 2.3)
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Swift export', () => {
		it('exports tokens as Swift struct', async () => {
			const result = await exportCommand.handler({ nodeId: 'test-root', format: 'swift' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.format).toBe('swift');
			expect(result.data?.content).toContain('struct VioletTokens');
			expect(result.data?.content).toContain('SwiftUI.Color');
			expect(result.data?.content).toContain('0078D4');
		});

		it('uses custom class name', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'swift', className: 'DesignTokens' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.content).toContain('struct DesignTokens');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// KOTLIN EXPORT (Phase 2.3)
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Kotlin export', () => {
		it('exports tokens as Kotlin object', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'kotlin' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.format).toBe('kotlin');
			expect(result.data?.content).toContain('object VioletTokens');
			expect(result.data?.content).toContain('Color(0xFF');
			expect(result.data?.content).toContain('.dp');
		});

		it('uses custom package name', async () => {
			const result = await exportCommand.handler(
				{
					nodeId: 'test-root',
					format: 'kotlin',
					packageName: 'com.myapp.tokens',
				},
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.content).toContain('package com.myapp.tokens');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// DART EXPORT (Phase 2.3)
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Dart export', () => {
		it('exports tokens as Dart class', async () => {
			const result = await exportCommand.handler({ nodeId: 'test-root', format: 'dart' }, context);

			expect(result.success).toBe(true);
			expect(result.data?.format).toBe('dart');
			expect(result.data?.content).toContain('class VioletTokens');
			expect(result.data?.content).toContain('VioletTokens._();');
			expect(result.data?.content).toContain('Color(0xFF');
		});

		it('uses custom class name', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'dart', className: 'AppTokens' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.content).toContain('class AppTokens');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// TAILWIND EXPORT (Phase 2.3)
	// ═══════════════════════════════════════════════════════════════════════════

	describe('Tailwind export', () => {
		it('exports tokens as Tailwind config', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'tailwind' },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.format).toBe('tailwind');
			expect(result.data?.content).toContain('module.exports');
			expect(result.data?.content).toContain('theme:');
			expect(result.data?.content).toContain('extend:');
			expect(result.data?.content).toContain('colors:');
		});

		it('uses ESM export when requested', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'tailwind', esm: true },
				context,
			);

			expect(result.success).toBe(true);
			expect(result.data?.content).toContain('export default');
			expect(result.data?.content).not.toContain('module.exports');
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// PROTOTYPE POLLUTION / PATH COLLISIONS
	// ═══════════════════════════════════════════════════════════════════════════

	describe('unsafe and colliding token paths', () => {
		/** Store a token operation directly, bypassing token.add validation (legacy/imported data) */
		const storeRaw = async (tokenId: string, value: string) => {
			const ops = await db.getOperations('test-root');
			await db.addOperation({
				id: `raw-${ops.length + 1}`,
				nodeId: 'test-root',
				sequence: ops.length + 1,
				type: 'add',
				tokenId,
				value: JSON.stringify(value),
				metadata: null,
				fromNode: null,
				asTokenId: null,
				toAncestor: null,
				reason: null,
				author: 'test',
				createdAt: new Date().toISOString(),
			});
		};

		const pollutionProbe = () => (({}) as Record<string, unknown>).polluted;

		afterEach(() => {
			// Never leave pollution behind for other tests, even if an assertion failed
			Reflect.deleteProperty(Object.prototype, 'polluted');
		});

		it.each(['json', 'typescript', 'tailwind'] as const)(
			'does not pollute Object.prototype when exporting %s',
			async (format) => {
				await storeRaw('__proto__.polluted', 'yes');
				await storeRaw('color.__proto__.polluted', 'yes');
				await storeRaw('constructor.prototype.polluted', 'yes');

				const result = await exportCommand.handler({ nodeId: 'test-root', format }, context);

				expect(result.success).toBe(true);
				expect(pollutionProbe()).toBeUndefined();
				expect(result.data?.content).not.toContain('polluted');
				// Safe tokens are still exported
				expect(result.data?.content).toContain('primary');
			},
		);

		it.each(['json', 'typescript', 'tailwind'] as const)(
			'does not throw when a leaf and a group share a path (%s)',
			async (format) => {
				// color.brand.primary already exists, so color.brand is now both group and leaf
				await storeRaw('color.brand', '#FFFFFF');

				const result = await exportCommand.handler({ nodeId: 'test-root', format }, context);

				expect(result.success).toBe(true);
				expect(result.data?.content).toContain('primary');
			},
		);

		it('resolves leaf/group collisions the same way regardless of token order', async () => {
			// Group wins: the colliding leaf is dropped, children are kept
			await storeRaw('color.brand', '#FFFFFF');
			const leafLast = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'json' },
				context,
			);

			const parsed = JSON.parse(leafLast.data?.content || '{}');
			expect(parsed.color.brand.primary.value).toBe('#0078D4');
			expect(parsed.color.brand.value).toBeUndefined();

			// Same pair, leaf registered first
			const db2 = createMemoryDatabase();
			const ctx2 = { db: db2, actor: 'test', traceId: 't2' };
			await nodeCreateCommand.handler({ name: 'other', type: 'root', parentId: null }, ctx2);
			await tokenAddCommand.handler(
				{ nodeId: 'other', tokenId: 'color.brand', value: '#FFFFFF' },
				ctx2,
			);
			await tokenAddCommand.handler(
				{ nodeId: 'other', tokenId: 'color.brand.primary', value: '#0078D4' },
				ctx2,
			);
			const leafFirst = await exportCommand.handler({ nodeId: 'other', format: 'json' }, ctx2);

			expect(JSON.parse(leafFirst.data?.content || '{}')).toEqual({
				color: { brand: { primary: { value: '#0078D4' } } },
			});
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// REFERENCES
	// ═══════════════════════════════════════════════════════════════════════════

	describe('references', () => {
		const add = (tokenId: string, value: unknown) =>
			tokenAddCommand.handler({ nodeId: 'test-root', tokenId, value } as never, context);

		beforeEach(async () => {
			await add('color.text.link', '{color.brand.primary}');
			await add('color.focus', { ref: 'color.text.link' });
		});

		it('exports resolved values for aliases in every format', async () => {
			const css = await exportCommand.handler({ nodeId: 'test-root', format: 'css' }, context);
			expect(css.data?.content).toContain('--color-text-link: #0078D4;');
			expect(css.data?.content).toContain('--color-focus: #0078D4;');

			for (const format of [
				'json',
				'scss',
				'typescript',
				'swift',
				'kotlin',
				'dart',
				'lua',
			] as const) {
				const result = await exportCommand.handler({ nodeId: 'test-root', format }, context);
				expect(result.success, format).toBe(true);
				expect(result.data?.content, format).not.toContain('{color.');
				expect(result.data?.content, format).not.toContain('"ref"');
			}
		});

		it('resolves aliases to tokens left out by the filter', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'css', filter: 'color.text.*' },
				context,
			);
			expect(result.data?.content).toContain('--color-text-link: #0078D4;');
		});

		it('keeps aliases as var() with outputReferences', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'css', prefix: 'vlt', outputReferences: true },
				context,
			);
			expect(result.data?.content).toContain('--vlt-color-brand-primary: #0078D4;');
			expect(result.data?.content).toContain(
				'--vlt-color-text-link: var(--vlt-color-brand-primary);',
			);
			expect(result.data?.content).toContain('--vlt-color-focus: var(--vlt-color-text-link);');
		});

		it('falls back to the value when the var() target is filtered out', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'css', filter: 'color.text.*', outputReferences: true },
				context,
			);
			expect(result.data?.content).toContain('--color-text-link: #0078D4;');
		});

		it('rejects outputReferences outside css', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'scss', outputReferences: true },
				context,
			);
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('fails on a missing reference', async () => {
			await add('color.border', '{color.nope}');
			const result = await exportCommand.handler({ nodeId: 'test-root', format: 'css' }, context);
			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('TOKEN_REFERENCE_NOT_FOUND');
			expect(result.error?.message).toContain('color.nope');
		});

		it('fails on a circular reference', async () => {
			await add('a', '{b}');
			await add('b', '{a}');
			const result = await exportCommand.handler({ nodeId: 'test-root', format: 'css' }, context);
			expect(result.error?.code).toBe('CIRCULAR_REFERENCE');
		});

		it('fails on a reference transform', async () => {
			await add('spacing.large', { ref: 'spacing.small', transform: 'multiply(2)' });
			const result = await exportCommand.handler({ nodeId: 'test-root', format: 'css' }, context);
			expect(result.error?.code).toBe('NOT_IMPLEMENTED');
		});

		it('ignores broken references outside the filter', async () => {
			await add('color.border', '{color.nope}');
			const result = await exportCommand.handler(
				{ nodeId: 'test-root', format: 'css', filter: 'spacing.*' },
				context,
			);
			expect(result.success).toBe(true);
		});
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// ERROR HANDLING
	// ═══════════════════════════════════════════════════════════════════════════

	describe('error handling', () => {
		it('returns error for non-existent node', async () => {
			const result = await exportCommand.handler(
				{ nodeId: 'nonexistent', format: 'json' },
				context,
			);

			expect(result.success).toBe(false);
			expect(result.error?.code).toBe('NODE_NOT_FOUND');
		});
	});
});
