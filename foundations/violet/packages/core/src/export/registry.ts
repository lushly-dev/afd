import type { Transformer } from './transformer.js';

/**
 * Transformer Registry
 *
 * Central registry for all export transformers.
 * Supports dynamic registration of format plugins.
 */
export class TransformerRegistry {
	private transformers = new Map<string, Transformer>();

	/**
	 * Register a transformer
	 */
	register(transformer: Transformer): void {
		if (this.transformers.has(transformer.format)) {
			throw new Error(`Transformer for format '${transformer.format}' is already registered`);
		}
		this.transformers.set(transformer.format, transformer);
	}

	/**
	 * Get a transformer by format
	 */
	get(format: string): Transformer | undefined {
		return this.transformers.get(format);
	}

	/**
	 * List all registered formats
	 */
	list(): Array<{ format: string; name: string; fileExtension: string }> {
		return Array.from(this.transformers.values()).map((t) => ({
			format: t.format,
			name: t.name,
			fileExtension: t.fileExtension,
		}));
	}

	/**
	 * Check if a format is registered
	 */
	has(format: string): boolean {
		return this.transformers.has(format);
	}
}

/**
 * Singleton transformer registry instance
 */
export const transformerRegistry = new TransformerRegistry();
