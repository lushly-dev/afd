import type { GeneratedValidator } from './validator-errors.js';

// Not imported by what a page loads, so `sideEffects: false` keeps it out of the page's chunk.
export const validateCoreManifest: GeneratedValidator;
export const validateDeployment: GeneratedValidator;
export const validateDeploymentV2: GeneratedValidator;
export const validateDeploymentV3: GeneratedValidator;
