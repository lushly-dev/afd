export interface VioletDataGridResizeSession {
    pointerId: number | null;
    columnId: string | null;
    startX: number;
    startWidth: number;
}

export function beginColumnResize(options: {
    button: number;
    pointerId: number;
    columnId: string;
    clientX: number;
    startWidth: number;
}): VioletDataGridResizeSession | null {
    if (options.button !== 0) {
        return null;
    }

    return {
        pointerId: options.pointerId,
        columnId: options.columnId,
        startX: options.clientX,
        startWidth: options.startWidth,
    };
}

export function isColumnResizeEventForSession(
    session: VioletDataGridResizeSession,
    pointerId: number
): boolean {
    return session.pointerId !== null && session.columnId !== null && pointerId === session.pointerId;
}

export function resizedColumnWidth(options: {
    session: VioletDataGridResizeSession;
    clientX: number;
    minimumWidth: number;
}): number {
    return Math.max(
        options.minimumWidth,
        Math.round(options.session.startWidth + (options.clientX - options.session.startX))
    );
}

const KEYBOARD_RESIZE_STEP = 8;
const KEYBOARD_RESIZE_LARGE_STEP = 32;

/**
 * Width after an ArrowLeft/ArrowRight press on a column resizer, or null for other keys.
 * The arrow that moves the resizer toward the trailing edge grows the column, so in RTL the
 * directions swap. Shift uses the large step.
 */
export function keyboardResizedColumnWidth(options: {
    key: string;
    shiftKey: boolean;
    currentWidth: number;
    minimumWidth: number;
    rtl: boolean;
}): number | null {
    if (options.key !== "ArrowLeft" && options.key !== "ArrowRight") {
        return null;
    }

    const step = options.shiftKey ? KEYBOARD_RESIZE_LARGE_STEP : KEYBOARD_RESIZE_STEP;
    const grows = (options.key === "ArrowRight") !== options.rtl;

    return Math.max(options.minimumWidth, Math.round(options.currentWidth + (grows ? step : -step)));
}

export function clearedColumnResizeSession(): VioletDataGridResizeSession {
    return {
        pointerId: null,
        columnId: null,
        startX: 0,
        startWidth: 0,
    };
}

/** Chord that moves keyboard focus to a column's resizer, in `aria-keyshortcuts` syntax. */
export const columnResizeKeyShortcut = "Control+Alt+R";

/** Whether a keydown is the column resize chord (Ctrl+Alt+R, matched by physical key for macOS Option). */
export function isColumnResizeShortcut(event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "code">): boolean {
    return event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey && event.code === "KeyR";
}
