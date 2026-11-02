// Not real component code: a corpus case for the lint's tagged-template reader.
const css = (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values });
const display = 'block';

export const styles = css`
	:host {
		display: ${display};
		padding: 12px;
		color: #18181b;
	}
	${css`:host { gap: 4px; }`}
`;

export const fragment = css.partial`color: red; padding: 12px;`;
