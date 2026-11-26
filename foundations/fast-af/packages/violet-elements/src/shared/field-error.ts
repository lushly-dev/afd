export interface FieldErrorOptions {
  invalid: boolean;
  disabled?: boolean;
  readonly?: boolean;
  errorText?: string;
  fallbackValidationMessage?: string;
}

/**
 * Resolves the visible field error message under the shared Violet field-error rule:
 * shown only while `invalid` is set and the control is neither disabled nor readonly,
 * preferring trimmed `errorText` and falling back to the browser validation message.
 */
export function resolveFieldErrorText(options: FieldErrorOptions): string {
  if (!options.invalid || options.disabled || options.readonly) {
    return "";
  }

  const customError = (options.errorText ?? "").trim();
  if (customError) {
    return customError;
  }

  return (options.fallbackValidationMessage ?? "").trim();
}
