type Hook = (target: Element, obligation: string, expectation: string, checked?: boolean) => void;
const hook = () => (globalThis as { __specimenClaim?: Hook }).__specimenClaim;

/**
 * For a retained story's play: link an assertion to the obligation it proves, so coverage can
 * count it. Call this after the assertion, since a failed assertion throws first and never
 * reaches it. Without this, a play keeps its test result and what it proves stays unknown.
 *
 *     await expect(button).toHaveAttribute('disabled');
 *     claim(button, 'property:disabled=true', 'disabled-attribute');
 *
 * It does nothing outside Specimen, so a story that uses it still runs under Storybook.
 */
export function claim(target: Element, obligation: string, expectation: string): void;
/**
 * With a check, `claim()` runs it: a guide statement (`guide:<id>`) is verified only by the check
 * its claim carries, so a `guide:` claim needs one. It records the claim only when the check
 * holds, and rethrows when it does not, so the story fails. Outside Specimen it still runs the
 * check, so the story keeps its assertion under any runner.
 *
 *     await claim(combobox, 'guide:combobox.label-required', 'named-by-label', () =>
 *       expect(input).toHaveAccessibleName('Supplier'));
 */
export function claim(
	target: Element,
	obligation: string,
	expectation: string,
	check: () => unknown
): Promise<void>;
export function claim(
	target: Element,
	obligation: string,
	expectation: string,
	check?: () => unknown
): void | Promise<void> {
	const guide = obligation.startsWith('guide:');
	if (check === undefined) {
		hook()?.(target, obligation, expectation, ...(guide ? [false] : []));
		return;
	}
	return (async () => {
		await check();
		hook()?.(target, obligation, expectation, ...(guide ? [true] : []));
	})();
}
