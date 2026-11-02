/**
 * For a retained preview: give the stories the component manifest. It is where a story's event
 * args come from, so a preview calling Storybook's function of this name calls this one instead,
 * and loads none of the helpers or Storybook to do it.
 */
export function setCustomElementsManifest(manifest: unknown): void {
	(
		globalThis as { __STORYBOOK_CUSTOM_ELEMENTS_MANIFEST__?: unknown }
	).__STORYBOOK_CUSTOM_ELEMENTS_MANIFEST__ = manifest;
}
