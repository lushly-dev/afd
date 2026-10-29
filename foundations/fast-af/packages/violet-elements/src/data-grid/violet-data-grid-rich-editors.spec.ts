import { html, Updates } from "@lushly-dev/fast-element";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-data-grid";
import "./violet-data-grid-attachment-cell";
import "./violet-data-grid-multi-picker";
import "./violet-data-grid-persona-picker";
import "./violet-data-grid-reference-picker";
import "./violet-data-grid-rating";
import type {
  VioletDataGrid,
  VioletDataGridCellLocation,
  VioletDataGridCellTemplateContext,
  VioletDataGridChangeDetail,
  VioletDataGridColumn,
  VioletDataGridEditorOption,
} from "./violet-data-grid";
import type {
  VioletDataGridAttachmentCell,
  VioletDataGridAttachmentCellUploadRequestDetail,
} from "./violet-data-grid-attachment-cell";
import {
  parseAttachmentCellValue,
  serializeAttachmentCellValue,
  type VioletDataGridAttachmentItem,
} from "./violet-data-grid-attachment-cell-values";
import {
  parseMultiPickerValue,
  serializeMultiPickerValue,
} from "./violet-data-grid-multi-picker-values";
import {
  parsePersonaPickerValue,
  serializePersonaPickerValue,
} from "./violet-data-grid-persona-picker-values";
import type { VioletDataGridRating } from "./violet-data-grid-rating";
import { parseRatingValue, serializeRatingValue } from "./violet-data-grid-rating-values";
import {
  parseReferencePickerValue,
  serializeReferencePickerValue,
} from "./violet-data-grid-reference-picker-values";

type TestRow = {
  commonName: string;
  tags: string[];
  linkedRecords: string[];
  assignees: string[];
  attachments: VioletDataGridAttachmentItem[];
  rating: number | null;
};

type RichColumnId = Exclude<keyof TestRow, "commonName">;
type PickerElement = HTMLElement & {
  value: string;
  open: boolean;
  selectedValues: string[];
  filterQuery: string;
};

const tagOptions: VioletDataGridEditorOption[] = [
  { value: "Priority Crop", label: "Priority Crop", tone: "gold" },
  { value: "Field Trial", label: "Field Trial", tone: "blue" },
  { value: "Needs Support", label: "Needs Support", tone: "teal" },
];
const referenceOptions: VioletDataGridEditorOption[] = [
  {
    value: "record-gh-04",
    label: "Greenhouse block 4",
    description: "Propagation house",
    keywords: ["propagation"],
  },
  {
    value: "record-packhouse",
    label: "Packhouse queue",
    description: "Friday handoff",
    keywords: ["operations"],
  },
];
const personaOptions: VioletDataGridEditorOption[] = [
  { value: "user-lydia-bauer", label: "Lydia Bauer", initials: "LB" },
  { value: "user-morgan-snow", label: "Morgan Snow", initials: "MS" },
];
const attachmentItems: VioletDataGridAttachmentItem[] = [
  { id: "attachment-bed-plan", label: "Bed plan.pdf", kind: "document", meta: "PDF" },
  { id: "attachment-yield-sheet", label: "Yield sheet.pdf", kind: "document", meta: "PDF" },
];

const tagEditorTemplate = html<VioletDataGridCellTemplateContext<TestRow>>`
  <violet-data-grid-multi-picker
    class="cell-editor" data-cell-editor="custom" data-commit-on-change="true"
    data-row-id="${(x) => x.rowId}" data-column-id="${(x) => x.columnId}"
    aria-label="${(x) => `Edit ${x.columnLabel} for ${x.rowLabel}`}"
    :value="${(x) => x.editValue ?? x.text}"
    :options="${(x) => x.editorOptions ?? []}"
  ></violet-data-grid-multi-picker>
`;
const referenceEditorTemplate = html<VioletDataGridCellTemplateContext<TestRow>>`
  <violet-data-grid-reference-picker
    class="cell-editor" data-cell-editor="custom" data-commit-on-change="true"
    multiple
    data-row-id="${(x) => x.rowId}" data-column-id="${(x) => x.columnId}"
    aria-label="${(x) => `Edit ${x.columnLabel} for ${x.rowLabel}`}"
    :value="${(x) => x.editValue ?? x.text}"
    :options="${(x) => x.editorOptions ?? []}"
  ></violet-data-grid-reference-picker>
`;
const personaEditorTemplate = html<VioletDataGridCellTemplateContext<TestRow>>`
  <violet-data-grid-persona-picker
    class="cell-editor" data-cell-editor="custom" data-commit-on-change="true"
    multiple
    data-row-id="${(x) => x.rowId}" data-column-id="${(x) => x.columnId}"
    aria-label="${(x) => `Edit ${x.columnLabel} for ${x.rowLabel}`}"
    :value="${(x) => x.editValue ?? x.text}"
    :options="${(x) => x.editorOptions ?? []}"
  ></violet-data-grid-persona-picker>
`;
const attachmentEditorTemplate = html<VioletDataGridCellTemplateContext<TestRow>>`
  <violet-data-grid-attachment-cell
    class="cell-editor" data-cell-editor="custom" data-commit-on-change="true"
    data-row-id="${(x) => x.rowId}" data-column-id="${(x) => x.columnId}"
    aria-label="${(x) => `Edit ${x.columnLabel} for ${x.rowLabel}`}"
    :value="${(x) => x.editValue ?? x.text}"
  ></violet-data-grid-attachment-cell>
`;
const ratingDisplayTemplate = html<VioletDataGridCellTemplateContext<TestRow>>`
  <violet-data-grid-rating readonly aria-label="${(x) => x.columnLabel}"
    :rating="${(x) => parseRatingValue(x.rawValue)}"
  ></violet-data-grid-rating>
`;
const ratingEditorTemplate = html<VioletDataGridCellTemplateContext<TestRow>>`
  <violet-data-grid-rating
    class="cell-editor" data-cell-editor="custom" data-commit-on-change="true"
    data-row-id="${(x) => x.rowId}" data-column-id="${(x) => x.columnId}"
    aria-label="${(x) => `Edit ${x.columnLabel} for ${x.rowLabel}`}"
    :rating="${(x) => parseRatingValue(x.rawValue)}"
  ></violet-data-grid-rating>
`;

const richColumns: VioletDataGridColumn<TestRow>[] = [
  {
    id: "tags",
    label: "Tags",
    editable: true,
    editor: "custom",
    value: (row) => serializeMultiPickerValue(row.tags),
    editorTemplate: tagEditorTemplate,
    editorOptions: tagOptions,
    parse: parseMultiPickerValue,
    serialize: (value) => serializeMultiPickerValue(parseMultiPickerValue(value)),
  },
  {
    id: "linkedRecords",
    label: "Linked records",
    editable: true,
    editor: "custom",
    value: (row) => serializeReferencePickerValue(row.linkedRecords),
    editorTemplate: referenceEditorTemplate,
    editorOptions: referenceOptions,
    parse: parseReferencePickerValue,
    serialize: (value) => serializeReferencePickerValue(parseReferencePickerValue(value)),
  },
  {
    id: "assignees",
    label: "Assignees",
    editable: true,
    editor: "custom",
    value: (row) => serializePersonaPickerValue(row.assignees),
    editorTemplate: personaEditorTemplate,
    editorOptions: personaOptions,
    parse: parsePersonaPickerValue,
    serialize: (value) => serializePersonaPickerValue(parsePersonaPickerValue(value)),
  },
  {
    id: "attachments",
    label: "Attachments",
    editable: true,
    editor: "custom",
    value: (row) => serializeAttachmentCellValue(row.attachments),
    editorTemplate: attachmentEditorTemplate,
    parse: parseAttachmentCellValue,
    serialize: (value) => serializeAttachmentCellValue(parseAttachmentCellValue(value)),
  },
  {
    id: "rating",
    label: "Rating",
    editable: true,
    editor: "custom",
    value: (row) => row.rating,
    cellTemplate: ratingDisplayTemplate,
    editorTemplate: ratingEditorTemplate,
    parse: (value) => parseRatingValue(value),
    serialize: (value) => serializeRatingValue(value),
  },
];

const pickerCases: {
  columnId: "tags" | "linkedRecords" | "assignees";
  query: string;
  initial: string;
  added: string;
}[] = [
  { columnId: "tags", query: "trial", initial: "Priority Crop", added: "Field Trial" },
  {
    columnId: "linkedRecords",
    query: "operations",
    initial: "record-gh-04",
    added: "record-packhouse",
  },
  {
    columnId: "assignees",
    query: "morgan",
    initial: "user-lydia-bauer",
    added: "user-morgan-snow",
  },
];

async function settle(): Promise<void> {
  await Updates.next();
  for (let index = 0; index < 2; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

function shadowElement<T extends HTMLElement>(host: HTMLElement, selector: string): T {
  const element = host.shadowRoot?.querySelector<T>(selector);
  if (!element) throw new Error(`Expected ${host.localName} shadow element ${selector}.`);
  return element;
}

async function renderGrid(columnId: RichColumnId): Promise<{
  grid: VioletDataGrid;
  changes: VioletDataGridChangeDetail[];
}> {
  const column = richColumns.find((candidate) => candidate.id === columnId);
  if (!column) throw new Error(`Missing rich editor column ${columnId}.`);
  const grid = document.createElement("violet-data-grid") as VioletDataGrid;
  // Keep both columns inside the default 414px browser-test viewport. When the table overflows
  // horizontally, macOS overlay scrollbars sit on top of this one-row grid's editor and swallow
  // pointer clicks aimed at the editor trigger (headless Linux Chromium hides them).
  grid.columns = [
    { id: "commonName", label: "Plant", width: "6rem", value: (row: TestRow) => row.commonName },
    { ...column, width: "18rem" },
  ] as VioletDataGridColumn[];
  grid.rows = [
    {
      id: "black-currant",
      label: "Black currant",
      data: {
        commonName: "Black currant",
        tags: ["Priority Crop"],
        linkedRecords: ["record-gh-04"],
        assignees: ["user-lydia-bauer"],
        attachments: attachmentItems.map((item) => ({ ...item })),
        rating: 4,
      } satisfies TestRow,
    },
  ];
  grid.focusMode = "cell";
  grid.selectionMode = "none";
  grid.showFilter = false;
  grid.virtualize = false;
  const changes: VioletDataGridChangeDetail[] = [];
  grid.addEventListener("cell-change", (event) => {
    changes.push((event as CustomEvent<VioletDataGridChangeDetail>).detail);
  });
  document.body.append(grid);
  await settle();
  return { grid, changes };
}

async function openEditor<T extends HTMLElement>(
  grid: VioletDataGrid,
  columnId: RichColumnId,
): Promise<T> {
  grid.activeCell = { rowId: "black-currant", columnId };
  await settle();
  shadowElement<HTMLElement>(grid, ".table-scroll").focus();
  await userEvent.keyboard("{F2}");
  await settle();
  expect(grid.editingCell).toEqual({ rowId: "black-currant", columnId });
  return shadowElement<T>(grid, `.cell-editor[data-column-id="${columnId}"]`);
}

function expectCommit(
  grid: VioletDataGrid,
  changes: VioletDataGridChangeDetail[],
  columnId: RichColumnId,
  value: unknown,
): void {
  expect(changes).toEqual([{ rowId: "black-currant", columnId, value }]);
  expect(grid.editingCell).toBeNull();
  expect(grid.shadowRoot?.querySelector(".cell-editor")).toBeNull();
}

describe("violet-data-grid rich editor integration", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  for (const { columnId, query, initial, added } of pickerCases) {
    it(`${columnId}: types a search, selects with the keyboard, and commits only on close`, async () => {
      const { grid, changes } = await renderGrid(columnId);
      const editor = await openEditor<PickerElement>(grid, columnId);
      expect(editor.selectedValues).toEqual([initial]);
      expect(editor.value).toBe(JSON.stringify([initial]));
      expect(grid.editingValue).toBe(editor.value);
      await userEvent.click(shadowElement(editor, ".trigger"));
      await settle();
      const search = shadowElement<HTMLInputElement>(editor, ".search");
      expect(editor.shadowRoot?.activeElement).toBe(search);
      await userEvent.keyboard(query);
      await settle();
      expect(search.value).toBe(query);
      expect(editor.filterQuery).toBe(query);
      expect(changes).toEqual([]);
      const listbox = shadowElement<HTMLElement>(editor, "violet-listbox");
      expect(listbox.hasAttribute("multiple")).toBe(true);
      expect(
        [...listbox.querySelectorAll("violet-option")].map((option) =>
          option.getAttribute("value"),
        ),
      ).toEqual([added]);
      await userEvent.keyboard("{ArrowDown}");
      await settle();
      expect(listbox.shadowRoot?.activeElement).toBe(shadowElement(listbox, ".control"));
      await userEvent.keyboard(" ");
      await settle();
      expect(editor.selectedValues).toEqual([initial, added]);
      expect(editor.value).toBe(JSON.stringify([initial, added]));
      expect(changes).toEqual([]);
      expect(grid.editingCell?.columnId).toBe(columnId);
      await userEvent.click(shadowElement(editor, ".trigger"));
      await settle();
      expectCommit(grid, changes, columnId, [initial, added]);
    });

    it(`${columnId}: preserves native caret/backspace behavior and commits removal of the last selection`, async () => {
      const { grid, changes } = await renderGrid(columnId);
      const editor = await openEditor<PickerElement>(grid, columnId);
      await userEvent.click(shadowElement(editor, ".trigger"));
      await settle();
      const search = shadowElement<HTMLInputElement>(editor, ".search");
      await userEvent.keyboard("ab{ArrowLeft}{Backspace}");
      await settle();
      expect(search.value).toBe("b");
      expect(editor.filterQuery).toBe("b");
      expect(editor.selectedValues).toEqual([initial]);
      await userEvent.keyboard("{ArrowRight}{Backspace}");
      await settle();
      expect(search.value).toBe("");
      expect(editor.selectedValues).toEqual([initial]);
      await userEvent.keyboard("{Backspace}");
      await settle();
      expect(editor.selectedValues).toEqual([]);
      expect(changes).toEqual([]);
      await userEvent.click(shadowElement(editor, ".trigger"));
      await settle();
      expectCommit(grid, changes, columnId, []);
    });
  }

  it("attachments: commits an uploaded document only when the panel closes", async () => {
    const { grid, changes } = await renderGrid("attachments");
    const editor = await openEditor<VioletDataGridAttachmentCell>(grid, "attachments");
    expect(editor.attachments).toEqual(attachmentItems);
    expect(editor.value).toBe(serializeAttachmentCellValue(attachmentItems));
    expect(grid.editingValue).toBe(editor.value);
    await userEvent.click(shadowElement(editor, ".trigger"));
    await settle();
    const upload = shadowElement(editor, "violet-file-upload");
    const input = shadowElement<HTMLInputElement>(upload, 'input[type="file"]');
    const file = new File(["yield"], "Harvest.csv", { type: "text/csv", lastModified: 42 });
    // Native file choosers cannot be typed into; exercise the real input/change path.
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await settle();
    expect(editor.attachments).toHaveLength(3);
    expect(editor.attachments[2]).toMatchObject({
      id: "Harvest.csv:5:42",
      label: "Harvest.csv",
      kind: "document",
    });
    expect(changes).toEqual([]);
    const pending = parseAttachmentCellValue(editor.value);
    await userEvent.click(shadowElement(editor, ".trigger"));
    await settle();
    expectCommit(grid, changes, "attachments", pending);
  });

  it("attachments: exposes original image files and commits no expired local preview", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const { grid, changes } = await renderGrid("attachments");
    const requests: VioletDataGridAttachmentCellUploadRequestDetail[] = [];
    grid.addEventListener("upload-request", (event) => {
      requests.push((event as CustomEvent<VioletDataGridAttachmentCellUploadRequestDetail>).detail);
    });
    const editor = await openEditor<VioletDataGridAttachmentCell>(grid, "attachments");
    await userEvent.click(shadowElement(editor, ".trigger"));
    await settle();
    const upload = shadowElement(editor, "violet-file-upload");
    const input = shadowElement<HTMLInputElement>(upload, 'input[type="file"]');
    const file = new File(["image bytes"], "Bed.png", { type: "image/png", lastModified: 42 });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await settle();
    expect(requests).toHaveLength(1);
    expect(requests[0].files).toEqual([file]);
    expect(requests[0].attachments[0].previewSrc).toBeUndefined();
    const preview = editor.attachments.at(-1)!.previewSrc!;
    expect(preview.startsWith("blob:")).toBe(true);
    const committed = parseAttachmentCellValue(editor.value);
    expect(committed.at(-1)?.previewSrc).toBeUndefined();
    await userEvent.click(shadowElement(editor, ".trigger"));
    await settle();
    expectCommit(grid, changes, "attachments", committed);
    expect(revoke).toHaveBeenCalledWith(preview);
    grid.rows = grid.rows.map((row) => ({
      ...row,
      data: { ...(row.data as TestRow), attachments: committed },
    }));
    await settle();
    const reopened = await openEditor<VioletDataGridAttachmentCell>(grid, "attachments");
    expect(reopened.attachments.at(-1)?.previewSrc).toBeUndefined();
  });

  it("attachments: removes a document with a keyboard-activated action and commits on close", async () => {
    const { grid, changes } = await renderGrid("attachments");
    const editor = await openEditor<VioletDataGridAttachmentCell>(grid, "attachments");
    await userEvent.click(shadowElement(editor, ".trigger"));
    await settle();
    const remove = shadowElement(editor, ".remove-button");
    shadowElement<HTMLElement>(remove, "button").focus();
    await userEvent.keyboard(" ");
    await settle();
    expect(editor.attachments).toEqual([attachmentItems[1]]);
    expect(changes).toEqual([]);
    await userEvent.click(shadowElement(editor, ".trigger"));
    await settle();
    expectCommit(grid, changes, "attachments", [attachmentItems[1]]);
  });

  for (const { key, value } of [
    { key: "{ArrowLeft}", value: 3 },
    { key: "{End}", value: 5 },
    { key: "{Delete}", value: null },
  ]) {
    it(`rating: immediately commits normalized ${String(value)} via ${key}`, async () => {
      const { grid, changes } = await renderGrid("rating");
      const display = shadowElement<VioletDataGridRating>(
        grid,
        'td[data-column-id="rating"] violet-data-grid-rating',
      );
      expect(display.readonly).toBe(true);
      expect(shadowElement(display, ".control").getAttribute("role")).toBe("img");
      const editor = await openEditor<VioletDataGridRating>(grid, "rating");
      expect(editor.value).toBe("4");
      shadowElement<HTMLElement>(editor, ".control").focus();
      await userEvent.keyboard(key);
      await settle();
      expectCommit(grid, changes, "rating", value);
    });
  }

  for (const columnId of ["tags", "linkedRecords", "assignees", "attachments", "rating"] as const) {
    it(`${columnId}: cancels an editor without emitting cell-change`, async () => {
      const { grid, changes } = await renderGrid(columnId);
      const cancellations: VioletDataGridCellLocation[] = [];
      grid.addEventListener("edit-cancel", (event) => {
        cancellations.push((event as CustomEvent<VioletDataGridCellLocation>).detail);
      });
      const editor = await openEditor(grid, columnId);
      shadowElement<HTMLElement>(editor, columnId === "rating" ? ".control" : ".trigger").focus();
      await userEvent.keyboard("{Escape}");
      await settle();
      expect(changes).toEqual([]);
      expect(cancellations).toEqual([{ rowId: "black-currant", columnId }]);
      expect(grid.editingCell).toBeNull();
      expect(grid.shadowRoot?.querySelector(".cell-editor")).toBeNull();
    });
  }
});
