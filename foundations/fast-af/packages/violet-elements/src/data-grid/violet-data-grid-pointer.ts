export interface VioletDataGridPointerSelectionSession<Location> {
    anchor: Location | null;
    pointerId: number | null;
    moved: boolean;
}

export interface VioletDataGridFillSession<Range> {
    pointerId: number | null;
    sourceRange: Range | null;
}

export function beginPointerSelection<Location>(
    pointerId: number,
    anchor: Location
): VioletDataGridPointerSelectionSession<Location> {
    return {
        anchor,
        pointerId,
        moved: false,
    };
}

export function isPointerSelectionEventForSession<Location>(
    session: VioletDataGridPointerSelectionSession<Location>,
    pointerId: number
): boolean {
    return session.pointerId !== null && session.anchor !== null && session.pointerId === pointerId;
}

export function markPointerSelectionMoved<Location>(
    session: VioletDataGridPointerSelectionSession<Location>
): VioletDataGridPointerSelectionSession<Location> {
    return {
        ...session,
        moved: true,
    };
}

export function clearedPointerSelectionSession<Location>(): VioletDataGridPointerSelectionSession<Location> {
    return {
        anchor: null,
        pointerId: null,
        moved: false,
    };
}

export function pointerSelectionSuppressesNextClick<Location>(
    session: VioletDataGridPointerSelectionSession<Location>,
    suppressRequested: boolean
): boolean {
    return suppressRequested && session.moved;
}

export function beginFillDrag<Range>(pointerId: number, sourceRange: Range | null): VioletDataGridFillSession<Range> | null {
    if (!sourceRange) {
        return null;
    }

    return {
        pointerId,
        sourceRange,
    };
}

export function isFillPointerEventForSession<Range>(
    session: VioletDataGridFillSession<Range>,
    pointerId: number
): boolean {
    return session.pointerId !== null && session.pointerId === pointerId;
}

export function clearedFillSession<Range>(): VioletDataGridFillSession<Range> {
    return {
        pointerId: null,
        sourceRange: null,
    };
}
