/**
 * Returns true when the element renders right-to-left (honours `dir` on any ancestor
 * and the `direction` CSS property).
 */
export function isRtl(element: Element): boolean {
  return getComputedStyle(element).direction === "rtl";
}

/**
 * Maps a physical arrow key to the logical key for the element's writing direction, so
 * handlers written for left-to-right (ArrowRight = forward) also work in right-to-left.
 * Non-horizontal keys are returned unchanged.
 */
export function logicalArrowKey(key: string, element: Element): string {
  if (key !== "ArrowLeft" && key !== "ArrowRight") {
    return key;
  }

  if (!isRtl(element)) {
    return key;
  }

  return key === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
}

/**
 * Steps a horizontal native range input in the visual direction of ArrowLeft and ArrowRight when it
 * renders right-to-left, and dispatches `input` and `change` as the browser would. Chromium and
 * Firefox already flip these keys, but WebKit does not, so handling them here makes every engine
 * agree. Returns true when it handled the key; the caller must only call it for horizontal inputs.
 */
export function stepRangeInputInVisualDirection(
  event: KeyboardEvent,
  input: HTMLInputElement,
): boolean {
  if (
    (event.key !== "ArrowLeft" && event.key !== "ArrowRight") ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    input.disabled ||
    // stepUp and stepDown throw without a step, so the browser keeps the key.
    input.step === "any" ||
    !isRtl(input)
  ) {
    return false;
  }

  event.preventDefault();
  const before = input.value;
  if (logicalArrowKey(event.key, input) === "ArrowRight") {
    input.stepUp();
  } else {
    input.stepDown();
  }

  if (input.value !== before) {
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return true;
}
