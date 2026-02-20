/**
 * Adapters Module
 *
 * App-specific adapters for the JTBD testing framework.
 */

// Generic adapter
export {
	createGenericAdapter,
	type GenericAdapterOptions,
	genericAdapter,
} from './generic.js';

// Registry
export {
	createAdapterRegistry,
	detectAdapter,
	getAdapter,
	getGlobalRegistry,
	listAdapters,
	registerAdapter,
	resetGlobalRegistry,
	setGlobalRegistry,
} from './registry.js';
// Todo adapter
export {
	createTodoAdapter,
	type TodoFixture,
	type TodoSeed,
	todoAdapter,
} from './todo.js';
// Types
export type {
	AdapterContext,
	AdapterRegistry,
	AdapterRegistryOptions,
	AppAdapter,
	AppliedCommand,
	ApplyFixtureResult,
	CliConfig,
	CommandHandler,
	CommandsConfig,
	ErrorsConfig,
	FixtureApplicator,
	FixtureConfig,
	FixtureResetter,
	FixtureValidationResult,
	FixtureValidator,
	JobsConfig,
} from './types.js';
