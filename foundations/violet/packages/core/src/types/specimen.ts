import { z } from 'zod';

/**
 * Which token draws each role of each component specimen (#118):
 * `{ button: { background: 'btn.bg', ... } }`. Stored once per tree, on its
 * root. Roles without an entry fall back to the naming convention,
 * `<component>.<role>`.
 */
export const SpecimenMapSchema = z.record(z.string(), z.record(z.string(), z.string().min(1)));

export type SpecimenMap = z.infer<typeof SpecimenMapSchema>;

/** A tree's stored specimen map */
export interface SpecimenMapRecord {
	rootId: string;
	map: SpecimenMap;
	updatedAt: string;
	updatedBy: string | null;
}
