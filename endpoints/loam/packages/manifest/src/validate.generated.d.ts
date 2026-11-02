import type { GeneratedValidator } from './validator-errors.js';

// The validators schema:build writes beside this module in dist/; the tests compile them in memory.
export const validateManifest: GeneratedValidator;
export const validateProjection: GeneratedValidator;
