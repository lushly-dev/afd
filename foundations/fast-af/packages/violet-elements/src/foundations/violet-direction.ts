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
