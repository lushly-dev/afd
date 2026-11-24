// Not real component code: a corpus case for the lint's tagged-template reader.
const css = (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values });
const display = 'block';
const label = `a #ffffff template that is not CSS, 12px`;

export const styles = css`
	:host {
		display: ${display};
		padding: var(--violet-space-inline-md);
		color: var(--violet-color-text-primary);
	}
	${css`:host { gap: var(--violet-size-space-sm); }`}
`;
export { label };
