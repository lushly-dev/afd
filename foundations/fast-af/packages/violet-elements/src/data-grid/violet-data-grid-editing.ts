export interface VioletDataGridEditingLocationLike {
    rowId: string;
    columnId: string;
}

export interface VioletDataGridEditableCellLike {
    editable: boolean;
    editor: string;
}

export interface VioletDataGridEditingState<Location> {
    editingCell: Location | null;
    editingValue: string;
}

export interface VioletDataGridEditingCommitDetail {
    rowId: string;
    columnId: string;
    value: unknown;
}

export function beginEditingState<Location>(
    location: Location,
    cell: VioletDataGridEditableCellLike | null,
    editValue: string
): VioletDataGridEditingState<Location> | null {
    if (!cell?.editable || cell.editor === "checkbox") {
        return null;
    }

    return {
        editingCell: location,
        editingValue: editValue,
    };
}

export function commitEditingState<Location extends VioletDataGridEditingLocationLike, Cell>(options: {
    editingCell: Location | null;
    editingValue: string;
    cell: Cell | null;
    normalizeValue: (cell: Cell, value: unknown) => unknown;
}): {
    nextState: VioletDataGridEditingState<Location>;
    detail: VioletDataGridEditingCommitDetail | null;
} {
    const nextState = clearedEditingState<Location>();

    if (!options.editingCell || !options.cell) {
        return {
            nextState,
            detail: null,
        };
    }

    return {
        nextState,
        detail: {
            rowId: options.editingCell.rowId,
            columnId: options.editingCell.columnId,
            value: options.normalizeValue(options.cell, options.editingValue),
        },
    };
}

export function cancelEditingState<Location>(editingCell: Location | null): {
    nextState: VioletDataGridEditingState<Location>;
    cancelledCell: Location | null;
} {
    return {
        nextState: clearedEditingState<Location>(),
        cancelledCell: editingCell,
    };
}

export function clearedEditingState<Location>(): VioletDataGridEditingState<Location> {
    return {
        editingCell: null,
        editingValue: "",
    };
}

export function editorStringValue(target: { value?: string } | null): string {
    return typeof target?.value === "string" ? target.value : "";
}

/**
 * Write the editor's starting value imperatively.
 *
 * The editor template must NOT bind `:value` reactively. That makes it a
 * controlled input, so every FAST render pass writes the model back onto the
 * element and overwrites whatever the user is typing — cell editing silently
 * refuses input. The editor owns its value while open; `handleGridInput`
 * mirrors it back into `editingValue` for commit.
 */
export function seedEditorValue(editor: HTMLElement | null, value: string): void {
    const valued = editor as (HTMLElement & { value?: string }) | null;
    if (!valued) return;
    valued.value = value;
}

export function focusEditorAtEnd(editor: HTMLElement | null): void {
    const focusableEditor = editor as
        | (HTMLElement & {
              value?: string;
              focus?: (options?: FocusOptions) => void;
          })
        | null;
    focusableEditor?.focus?.({ preventScroll: true });

    if (editor instanceof HTMLTextAreaElement) {
        const end = editor.value.length;
        editor.setSelectionRange(end, end);
        return;
    }

    if (editor instanceof HTMLInputElement) {
        const end = editor.value.length;

        try {
            editor.setSelectionRange(end, end);
        } catch {
            // Some input types, such as number, do not support selection ranges.
        }
    }
}
