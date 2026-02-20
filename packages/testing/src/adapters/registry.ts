/**
 * Adapter Registry
 *
 * Manages registration and lookup of app adapters.
 */

import type { AdapterRegistry, AdapterRegistryOptions, AppAdapter } from './types.js';

// ============================================================================
// Registry Implementation
// ============================================================================

/**
 * Create an adapter registry.
 */
export function createAdapterRegistry(options: AdapterRegistryOptions = {}): AdapterRegistry {
	const adapters = new Map<string, AppAdapter>();
	const { defaultAdapter } = options;

	// Register initial adapters
	for (const adapter of options.adapters ?? []) {
		adapters.set(adapter.name, adapter);
	}

	return {
		register(adapter: AppAdapter): void {
			if (adapters.has(adapter.name)) {
				throw new Error(`Adapter '${adapter.name}' is already registered`);
			}
			adapters.set(adapter.name, adapter);
		},

		get(name: string): AppAdapter | undefined {
			return adapters.get(name);
		},

		list(): AppAdapter[] {
			return Array.from(adapters.values());
		},

		detect(fixture: unknown): AppAdapter | undefined {
			// Try to detect from fixture's 'app' field
			if (isFixtureWithApp(fixture)) {
				const adapter = adapters.get(fixture.app);
				if (adapter) return adapter;
			}

			// Try each adapter's detection logic
			for (const adapter of adapters.values()) {
				if (canAdapterHandleFixture(adapter, fixture)) {
					return adapter;
				}
			}

			// Return default adapter if specified
			if (defaultAdapter) {
				return adapters.get(defaultAdapter);
			}

			return undefined;
		},

		has(name: string): boolean {
			return adapters.has(name);
		},
	};
}

// ============================================================================
// Detection Helpers
// ============================================================================

/**
 * Check if fixture has an 'app' field.
 */
function isFixtureWithApp(fixture: unknown): fixture is { app: string; [key: string]: unknown } {
	return (
		typeof fixture === 'object' &&
		fixture !== null &&
		'app' in fixture &&
		typeof (fixture as Record<string, unknown>).app === 'string'
	);
}

/**
 * Check if an adapter can handle a fixture based on its schema.
 */
function canAdapterHandleFixture(adapter: AppAdapter, fixture: unknown): boolean {
	// If adapter has a validator, use it
	if (adapter.fixture.validate) {
		// We don't want to await here, so this is a sync check
		// For async validation, use detect() externally
		return false;
	}

	// Check for app-specific fields in fixture
	if (isFixtureWithApp(fixture)) {
		return fixture.app === adapter.name;
	}

	return false;
}

// ============================================================================
// Global Registry
// ============================================================================

let globalRegistry: AdapterRegistry | undefined;

/**
 * Get the global adapter registry.
 * Creates one if it doesn't exist.
 */
export function getGlobalRegistry(): AdapterRegistry {
	if (!globalRegistry) {
		globalRegistry = createAdapterRegistry();
	}
	return globalRegistry;
}

/**
 * Set the global adapter registry.
 */
export function setGlobalRegistry(registry: AdapterRegistry): void {
	globalRegistry = registry;
}

/**
 * Reset the global adapter registry.
 */
export function resetGlobalRegistry(): void {
	globalRegistry = undefined;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Register an adapter in the global registry.
 */
export function registerAdapter(adapter: AppAdapter): void {
	getGlobalRegistry().register(adapter);
}

/**
 * Get an adapter from the global registry.
 */
export function getAdapter(name: string): AppAdapter | undefined {
	return getGlobalRegistry().get(name);
}

/**
 * List all adapters in the global registry.
 */
export function listAdapters(): AppAdapter[] {
	return getGlobalRegistry().list();
}

/**
 * Detect adapter for a fixture from the global registry.
 */
export function detectAdapter(fixture: unknown): AppAdapter | undefined {
	return getGlobalRegistry().detect(fixture);
}
