import { html, repeat } from "@lushly-dev/fast-element";

interface VioletDataGridCellTemplateModel {
    active: boolean;
    align: "start" | "center" | "end";
    columnId: string;
    columnLabel: string;
    editValue: string;
    editable: boolean;
    editor: "text" | "number" | "checkbox" | "select" | "custom";
    editing: boolean;
  editingError: string;
  editingErrorId: string;
    editorOptions: Array<{ label: string; value: string }>;
    fillPreview: boolean;
    rawValue: unknown;
    rowId: string;
    rowLabel: string;
    selected: boolean;
    text: string;
}

export const defaultCellContentTemplate = html<VioletDataGridCellTemplateModel>`
    <span class="cell-content">${(x) => x.text}</span>
`;

export const inputCellEditorTemplate = html<VioletDataGridCellTemplateModel>`
    <input
        class="cell-editor"
        data-cell-editor="${(x) => x.editor}"
        data-row-id="${(x) => x.rowId}"
        data-column-id="${(x) => x.columnId}"
        aria-label="${(x) => `Edit ${x.columnLabel} for ${x.rowLabel}`}"
        aria-invalid="${(x) => (x.editingError ? "true" : "false")}"
        aria-errormessage="${(x) => (x.editingError ? x.editingErrorId : null)}"
        inputmode="${(x) => (x.editor === "number" ? "decimal" : null)}"
        type="text"
    />
`;

export const selectCellEditorTemplate = html<VioletDataGridCellTemplateModel>`
    <select
        class="cell-editor"
        data-cell-editor="select"
        data-row-id="${(x) => x.rowId}"
        data-column-id="${(x) => x.columnId}"
        aria-label="${(x) => `Edit ${x.columnLabel} for ${x.rowLabel}`}"
        aria-invalid="${(x) => (x.editingError ? "true" : "false")}"
        aria-errormessage="${(x) => (x.editingError ? x.editingErrorId : null)}"
        :value="${(x) => x.editValue}"
    >
        ${repeat(
          (x) => x.editorOptions,
            html<{ label: string; value: string }>`
                <option value="${(x) => x.value}">${(x) => x.label}</option>
            `,
        )}
    </select>
`;
