export const packageRoot: string;
export const AJV_OPTIONS: { strict: boolean; allErrors: boolean; inlineRefs: boolean };
export function readCore(): { $id: string; $defs: Record<string, unknown> };
export function readSchema(
	name: 'app-manifest' | 'deployment' | 'projection' | 'server',
	version?: number
): {
	$id: string;
	$defs: Record<string, unknown>;
	properties: Record<string, unknown>;
};
export function schemaAjv(options?: Record<string, unknown>): {
	addSchema(schema: unknown): unknown;
	getSchema(id: string): ((data: unknown) => boolean) & { errors?: unknown[] | null };
};
export function serverAjv(options?: Record<string, unknown>): {
	addSchema(schema: unknown): unknown;
	getSchema(id: string): ((data: unknown) => boolean) & { errors?: unknown[] | null };
};
export function readShapeSchema(): { $id: string };
export function compileValidators(): Record<string, string>;
export function generateTypes(): Promise<string>;
export function generateFacts(): string;
