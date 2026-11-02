/**
 * @fileoverview What a reader keeps of a generated validator's errors (spec/plugin-manifest.md,
 * Validators): Ajv's `if` errors are dropped, since the failure itself names the key, and each key
 * is reported once, since a closing profile reaches the core by two paths.
 */

/** The fields of an Ajv error a reader uses. */
export interface ValidatorError {
	keyword: string;
	instancePath: string;
	params: Record<string, unknown>;
	/** Set on an error inside `propertyNames`, whose instance path is the object holding the name. */
	propertyName?: string;
	message?: string;
}

/** A generated standalone validator. */
export type GeneratedValidator = ((data: unknown) => boolean) & {
	errors?: ValidatorError[] | null;
};

/** The pointer of the key an error refuses. */
export function pointerOf(error: ValidatorError): string {
	const { missingProperty, unevaluatedProperty, additionalProperty, propertyName } = error.params;
	const key =
		missingProperty ??
		unevaluatedProperty ??
		additionalProperty ??
		propertyName ??
		error.propertyName;
	if (key === undefined) return error.instancePath;
	return `${error.instancePath}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

/** An error that refuses a key as a whole, rather than its value. */
export function refusesKey(error: ValidatorError): boolean {
	return (
		error.keyword === 'false schema' ||
		error.keyword === 'unevaluatedProperties' ||
		error.keyword === 'additionalProperties'
	);
}

/**
 * Each refused key once, in the validator's order. A key refused as a whole hides what the core
 * says about its contents, which the second path reports.
 */
export function reportedErrors(errors: readonly ValidatorError[]): Map<string, ValidatorError> {
	const kept = errors.filter((error) => error.keyword !== 'if');
	const whole = kept.filter(refusesKey).map(pointerOf);
	const reported = new Map<string, ValidatorError>();
	for (const error of kept) {
		const pointer = pointerOf(error);
		if (whole.some((key) => pointer.startsWith(`${key}/`))) continue;
		const seen = reported.get(pointer);
		if (seen === undefined || (refusesKey(error) && !refusesKey(seen)))
			reported.set(pointer, error);
	}
	return reported;
}
