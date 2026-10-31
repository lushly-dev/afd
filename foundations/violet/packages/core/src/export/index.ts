/**
 * Violet Design Export Module
 *
 * Multi-format token export with pluggable transformers.
 */

export * from './transformer.js';
export * from './registry.js';

// Transformers
export { jsonTransformer } from './transformers/json.js';
export { cssTransformer } from './transformers/css.js';
export { scssTransformer } from './transformers/scss.js';
export { typescriptTransformer } from './transformers/typescript.js';
export { swiftTransformer } from './transformers/swift.js';
export { kotlinTransformer } from './transformers/kotlin.js';
export { dartTransformer } from './transformers/dart.js';
export { tailwindTransformer } from './transformers/tailwind.js';
export { luaTransformer } from './transformers/lua.js';

// Register all built-in transformers
import { transformerRegistry } from './registry.js';
import { cssTransformer } from './transformers/css.js';
import { dartTransformer } from './transformers/dart.js';
import { jsonTransformer } from './transformers/json.js';
import { kotlinTransformer } from './transformers/kotlin.js';
import { luaTransformer } from './transformers/lua.js';
import { scssTransformer } from './transformers/scss.js';
import { swiftTransformer } from './transformers/swift.js';
import { tailwindTransformer } from './transformers/tailwind.js';
import { typescriptTransformer } from './transformers/typescript.js';

/**
 * Initialize export module - registers all built-in transformers
 */
export function initializeExport(): void {
	if (!transformerRegistry.has('json')) {
		transformerRegistry.register(jsonTransformer);
	}
	if (!transformerRegistry.has('css')) {
		transformerRegistry.register(cssTransformer);
	}
	if (!transformerRegistry.has('scss')) {
		transformerRegistry.register(scssTransformer);
	}
	if (!transformerRegistry.has('typescript')) {
		transformerRegistry.register(typescriptTransformer);
	}
	if (!transformerRegistry.has('swift')) {
		transformerRegistry.register(swiftTransformer);
	}
	if (!transformerRegistry.has('kotlin')) {
		transformerRegistry.register(kotlinTransformer);
	}
	if (!transformerRegistry.has('dart')) {
		transformerRegistry.register(dartTransformer);
	}
	if (!transformerRegistry.has('tailwind')) {
		transformerRegistry.register(tailwindTransformer);
	}
	if (!transformerRegistry.has('lua')) {
		transformerRegistry.register(luaTransformer);
	}
}
