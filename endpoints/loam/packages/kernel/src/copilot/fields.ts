/**
 * @fileoverview The copilot's declared context fields (phase 5 specification, 3.2): `copilotSession`, `turn` and
 * `trace`, journaled, on both registries from stage B. In the `late-copilot` chunk; it imports types alone.
 */

import type { DocumentKit } from '../scope/command-kit.js';
import type { ContextField } from '../types.js';

export function copilotContextFields(z: DocumentKit['z']): ContextField[] {
	return [
		// `session` is a name AFD sets itself (the auth session), so the copilot's session is `copilotSession`.
		{
			name: 'copilotSession',
			meta: 'dev.loam/copilot-session',
			schema: z.string().check(z.minLength(1), z.maxLength(64)),
			journal: true,
		},
		{
			name: 'turn',
			meta: 'dev.loam/turn',
			schema: z.int().check(z.minimum(1)),
			journal: true,
		},
		{
			name: 'trace',
			meta: 'dev.loam/trace',
			schema: z.strictObject({
				session: z.string().check(z.minLength(1), z.maxLength(64)),
				turn: z.int().check(z.minimum(1)),
				call: z.string().check(z.minLength(1), z.maxLength(64)),
			}),
			journal: true,
		},
	];
}
