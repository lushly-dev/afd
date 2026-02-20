/**
 * @fileoverview AFD Bootstrap Tools
 *
 * These tools are automatically added to every AFD MCP server to enable
 * agent discovery and onboarding.
 */

export { createAfdDocsCommand } from './afd-docs.js';
export { createAfdHelpCommand } from './afd-help.js';
export { createAfdSchemaCommand } from './afd-schema.js';

export { getBootstrapCommands } from './registry.js';
