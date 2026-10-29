export type VioletDataGridValueEditor = "text" | "number" | "checkbox" | "select" | "custom";

export interface VioletDataGridValueCellLike<RowData = unknown> {
    editor: VioletDataGridValueEditor;
    rawValue?: unknown;
    rowData: RowData;
    parse?: (value: unknown, row: RowData) => unknown;
}

export type VioletDataGridEditingValueResolution =
  | { valid: true; value: unknown }
  | { valid: false; message: string };

export function editStringForRawValue(rawValue: unknown): string {
    if (rawValue === null || rawValue === undefined) {
        return "";
    }

    return String(rawValue);
}

export function booleanCellValue(value: unknown): boolean {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
    return Number.isFinite(value) && value !== 0;
    }

    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
    return (
      normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on"
    );
    }

  // Checkbox cells are binary. Null, mixed, objects, and unrecognized
  // strings render false and toggle to true rather than becoming an
  // accidental truthy state.
  return false;
}

export function normalizedEditingValue<RowData>(
    cell: VioletDataGridValueCellLike<RowData>,
  value: unknown,
): unknown {
    if (cell.parse) {
        return cell.parse(value, cell.rowData);
    }

    if (cell.editor === "checkbox") {
        return booleanCellValue(value);
    }

    if (cell.editor === "number") {
        const textValue = String(value ?? "");
        if (textValue.trim() === "") {
            return null;
        }

        const numericValue = Number(textValue);
        return Number.isNaN(numericValue) ? textValue : numericValue;
    }

    return value;
}

export function resolveEditingValue<RowData>(
  cell: VioletDataGridValueCellLike<RowData>,
  value: unknown,
): VioletDataGridEditingValueResolution {
  if (cell.editor === "number" && !cell.parse) {
    const textValue = String(value ?? "");
    if (textValue.trim() !== "" && !Number.isFinite(Number(textValue))) {
      return { valid: false, message: "Enter a valid number." };
    }
  }

  try {
    return { valid: true, value: normalizedEditingValue(cell, value) };
  } catch (error) {
    return {
      valid: false,
      message:
        error instanceof Error && error.message.trim() ? error.message : "Enter a valid value.",
    };
  }
}

export function opensOnSingleActiveClick(editor: VioletDataGridValueEditor): boolean {
    return editor === "select" || editor === "custom";
}
