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
export function claim(target: Element, obligation: string, expectation: string): void {
	(globalThis as { __specimenClaim?: typeof claim }).__specimenClaim?.(
		target,
		obligation,
		expectation
	);
}
