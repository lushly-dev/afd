import type { GeneratedValidator } from './validator-errors.js';

// Only `@lushly-dev/loam-manifest/plugin` imports it: a plugin's manifest is read by a deployer's tool, never a page.
export const validatePluginManifest: GeneratedValidator;
