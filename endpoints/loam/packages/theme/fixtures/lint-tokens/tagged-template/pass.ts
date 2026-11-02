// Not real component code: a corpus case for the lint's tagged-template reader.
const css = (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values });
const display = 'block';
const label = `a #ffffff template that is not CSS, 12px`;

export const styles = css`
	:host {
		display: ${display};
		padding: var(--space-inline-md);
		color: var(--color-text-primary);
	}
	${css`:host { gap: var(--size-space-sm); }`}
`;
export { label };
