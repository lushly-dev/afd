/** Generated at build and test time by tooling/report-validator.ts from Health's schema. */
declare module 'virtual:health-report-schema' {
	export interface ValidationError {
		instancePath: string;
		keyword: string;
		message?: string;
		params: Record<string, unknown>;
	}
	export const validateReport: {
		(data: unknown): boolean;
		errors?: ValidationError[] | null;
	};
	export const schemaId: string;
	export const schemaVersion: string;
}
