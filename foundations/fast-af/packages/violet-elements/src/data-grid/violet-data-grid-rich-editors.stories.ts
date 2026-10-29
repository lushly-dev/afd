import { html } from "@lushly-dev/fast-element";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "./violet-data-grid";
import "./violet-data-grid-multi-picker";
import "./violet-data-grid-reference-picker";
import "./violet-data-grid-persona-picker";
import "./violet-data-grid-attachment-cell";
import "./violet-data-grid-rating";
import type {
  VioletDataGrid,
  VioletDataGridCellTemplateContext,
  VioletDataGridChangeDetail,
  VioletDataGridColumn,
  VioletDataGridEditorOption,
  VioletDataGridRow,
} from "./violet-data-grid";
import { displayOptionForValue } from "./violet-data-grid-editor-option-helpers";
import {
  parseMultiPickerValue,
  serializeMultiPickerValue,
} from "./violet-data-grid-multi-picker-values";
import {
  parseAttachmentCellValue,
  serializeAttachmentCellValue,
} from "./violet-data-grid-attachment-cell-values";
import type { VioletDataGridAttachmentItem } from "./violet-data-grid-attachment-cell-values";
import { parseRatingValue, serializeRatingValue } from "./violet-data-grid-rating-values";
import type { VioletDataGridMultiPicker } from "./violet-data-grid-multi-picker";

type ProjectRow = {
  name: string;
  tags: string[];
  records: string[];
  people: string[];
  attachments: VioletDataGridAttachmentItem[];
  rating: number | null;
};

type ProjectGrid = Omit<VioletDataGrid, "rows" | "columns"> & {
  rows: VioletDataGridRow<ProjectRow>[];
  columns: VioletDataGridColumn<ProjectRow>[];
};

const tags: VioletDataGridEditorOption[] = [
  { value: "priority", label: "Priority", tone: "gold" },
  { value: "trial", label: "Field Trial", tone: "blue", keywords: ["experiment"] },
  { value: "support", label: "Needs Support", tone: "teal" },
];
const records: VioletDataGridEditorOption[] = [
  {
    value: "greenhouse",
    label: "Greenhouse block 4",
    description: "Propagation house",
    tone: "blue",
  },
  { value: "cedar", label: "Cedar bed 5", description: "North field", tone: "olive" },
];
const people: VioletDataGridEditorOption[] = [
  { value: "lydia", label: "Lydia Bauer", description: "Propagation lead", initials: "LB" },
  { value: "morgan", label: "Morgan Snow", description: "Operations", initials: "MS" },
];

function selectionDisplay(options: VioletDataGridEditorOption[]) {
  return html<VioletDataGridCellTemplateContext<ProjectRow>>`
        <span class="cell-content">
            ${(x) =>
              parseMultiPickerValue(x.rawValue)
                .map((value) => displayOptionForValue(options, value).label)
                .join(", ") || "None"}
        </span>
    `;
}

const tagEditor = html<VioletDataGridCellTemplateContext<ProjectRow>>`
    <violet-data-grid-multi-picker
        class="cell-editor" data-cell-editor="custom" data-commit-on-change="true"
        data-row-id="${(x) => x.rowId}" data-column-id="${(x) => x.columnId}"
        aria-label="Edit tags" placeholder="Add tags"
        :value="${(x) => x.editValue}"
        :options="${() => tags}"
    ></violet-data-grid-multi-picker>
`;
const referenceEditor = html<VioletDataGridCellTemplateContext<ProjectRow>>`
    <violet-data-grid-reference-picker
        class="cell-editor" data-cell-editor="custom" data-commit-on-change="true"
        data-row-id="${(x) => x.rowId}" data-column-id="${(x) => x.columnId}"
        aria-label="Edit linked records" placeholder="Link records" multiple
        :value="${(x) => x.editValue}"
        :options="${() => records}"
    ></violet-data-grid-reference-picker>
`;
const personaEditor = html<VioletDataGridCellTemplateContext<ProjectRow>>`
    <violet-data-grid-persona-picker
        class="cell-editor" data-cell-editor="custom" data-commit-on-change="true"
        data-row-id="${(x) => x.rowId}" data-column-id="${(x) => x.columnId}"
        aria-label="Edit assignees" placeholder="Assign people" multiple
        :value="${(x) => x.editValue}"
        :options="${() => people}"
    ></violet-data-grid-persona-picker>
`;
const attachmentEditor = html<VioletDataGridCellTemplateContext<ProjectRow>>`
    <violet-data-grid-attachment-cell
        class="cell-editor" data-cell-editor="custom" data-commit-on-change="true"
        data-row-id="${(x) => x.rowId}" data-column-id="${(x) => x.columnId}"
        aria-label="Edit attachments"
        :value="${(x) => x.editValue}"
    ></violet-data-grid-attachment-cell>
`;
const ratingDisplay = html<VioletDataGridCellTemplateContext<ProjectRow>>`
    <violet-data-grid-rating readonly aria-label="Project rating"
        :value="${(x) => serializeRatingValue(x.rawValue)}"
    ></violet-data-grid-rating>
`;
const ratingEditor = html<VioletDataGridCellTemplateContext<ProjectRow>>`
    <violet-data-grid-rating
        class="cell-editor" data-cell-editor="custom" data-commit-on-change="true"
        data-row-id="${(x) => x.rowId}" data-column-id="${(x) => x.columnId}"
        aria-label="Edit rating"
        :value="${(x) => serializeRatingValue(x.rawValue)}"
    ></violet-data-grid-rating>
`;

const columns: VioletDataGridColumn<ProjectRow>[] = [
  { id: "name", label: "Project", width: "12rem", value: (row) => row.name },
  {
    id: "tags",
    label: "Tags",
    width: "14rem",
    editable: true,
    editor: "custom",
    value: (row) => row.tags,
    cellTemplate: selectionDisplay(tags),
    editorTemplate: tagEditor,
    parse: parseMultiPickerValue,
    serialize: (value) => serializeMultiPickerValue(parseMultiPickerValue(value)),
  },
  {
    id: "records",
    label: "Linked records",
    width: "14rem",
    editable: true,
    editor: "custom",
    value: (row) => row.records,
    cellTemplate: selectionDisplay(records),
    editorTemplate: referenceEditor,
    parse: parseMultiPickerValue,
    serialize: (value) => serializeMultiPickerValue(parseMultiPickerValue(value)),
  },
  {
    id: "people",
    label: "Assignees",
    width: "12rem",
    editable: true,
    editor: "custom",
    value: (row) => row.people,
    cellTemplate: selectionDisplay(people),
    editorTemplate: personaEditor,
    parse: parseMultiPickerValue,
    serialize: (value) => serializeMultiPickerValue(parseMultiPickerValue(value)),
  },
  {
    id: "attachments",
    label: "Attachments",
    width: "14rem",
    editable: true,
    editor: "custom",
    value: (row) => row.attachments,
    editorTemplate: attachmentEditor,
    cellTemplate: html<VioletDataGridCellTemplateContext<ProjectRow>>`
            <span class="cell-content">${(x) =>
              parseAttachmentCellValue(x.rawValue)
                .map((item) => item.label)
                .join(", ") || "Add attachments"}</span>
        `,
    parse: parseAttachmentCellValue,
    serialize: (value) => serializeAttachmentCellValue(parseAttachmentCellValue(value)),
  },
  {
    id: "rating",
    label: "Rating",
    width: "10rem",
    editable: true,
    editor: "custom",
    value: (row) => row.rating,
    cellTemplate: ratingDisplay,
    editorTemplate: ratingEditor,
    parse: (value) => parseRatingValue(value),
    serialize: (value) => serializeRatingValue(value),
  },
];

function sampleRows(): VioletDataGridRow<ProjectRow>[] {
  return [
    {
      id: "currant",
      label: "Black currant",
      data: {
        name: "Black currant",
        tags: ["priority"],
        records: ["greenhouse"],
        people: ["lydia"],
        attachments: [
          { id: "plan", label: "Bed plan cover.png", kind: "image", meta: "image/png" },
        ],
        rating: 4,
      },
    },
    {
      id: "romanesco",
      label: "Romanesco",
      data: {
        name: "Romanesco",
        tags: ["trial", "support"],
        records: ["cedar"],
        people: ["morgan"],
        attachments: [],
        rating: 2,
      },
    },
    {
      id: "new",
      label: "New planting",
      data: {
        name: "New planting",
        tags: [],
        records: [],
        people: [],
        attachments: [],
        rating: null,
      },
    },
  ];
}

type Args = { virtualize: boolean };
const meta: Meta<Args> = {
  title: "Components/Data Grid/Rich Editors",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Grid-native editors composed through the grid's custom cell contract. Double-click a cell to edit; picker selections commit when the panel closes.",
      },
    },
  },
  args: { virtualize: false },
  render: (args) => {
    const grid = document.createElement("violet-data-grid") as ProjectGrid;
    grid.columns = columns;
    grid.rows = sampleRows();
    grid.focusMode = "cell";
    grid.selectionMode = "none";
    grid.showFilter = false;
    grid.virtualize = args.virtualize;
    grid.setAttribute("aria-label", "Planting projects");
    grid.addEventListener("cell-change", (event) => {
      const change = (event as CustomEvent<VioletDataGridChangeDetail>).detail;
      grid.rows = grid.rows.map((row) =>
        row.id === change.rowId
          ? { ...row, data: { ...row.data, [change.columnId]: change.value } }
          : row,
      );
    });
    if (args.virtualize) {
      grid.style.blockSize = "22rem";
    }
    return grid;
  },
};
export default meta;
type Story = StoryObj<Args>;

export const Overview: Story = {
  play: async ({ canvasElement }) => {
    const grid = canvasElement.querySelector("violet-data-grid") as ProjectGrid;
    await waitFor(() => expect(grid.shadowRoot?.querySelector("table")).toBeTruthy());
    const cell = grid.shadowRoot!.querySelector(
      'td[data-row-id="currant"][data-column-id="tags"]',
    ) as HTMLElement;
    const bounds = cell.getBoundingClientRect();
    await userEvent.pointer({
      keys: "[MouseLeft][MouseLeft]",
      target: cell,
      coords: { clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 },
    });
    await waitFor(() =>
      expect(grid.shadowRoot?.querySelector("violet-data-grid-multi-picker")).toBeTruthy(),
    );
    const picker = grid.shadowRoot!.querySelector(
      "violet-data-grid-multi-picker",
    ) as VioletDataGridMultiPicker;
    await waitFor(() => expect(picker.selectedValues).toEqual(["priority"]));
    // Editor creation precedes the grid's queued focus handoff.
    await waitFor(() => {
      expect(grid.shadowRoot?.activeElement).toBe(picker);
      expect(picker.shadowRoot?.activeElement?.className).toBe("trigger");
    });
    await userEvent.click(picker.shadowRoot!.querySelector(".trigger") as HTMLElement);
    await waitFor(() => expect(picker.shadowRoot?.activeElement?.className).toBe("search"));
    await userEvent.keyboard("trial");
    await waitFor(() => {
      expect(picker.filterQuery).toBe("trial");
      expect(picker.selectedValues).toEqual(["priority"]);
      expect(picker.shadowRoot?.querySelectorAll("violet-option")).toHaveLength(1);
    });
    const listbox = picker.shadowRoot!.querySelector("violet-listbox")!;
    await userEvent.click(
      listbox.querySelector("violet-option")!.shadowRoot!.querySelector(".control")!,
    );
    await waitFor(() => expect(picker.selectedValues).toEqual(["priority", "trial"]));
    await userEvent.click(picker.shadowRoot!.querySelector(".trigger") as HTMLElement);
    await waitFor(() => {
      expect(grid.editingCell).toBeNull();
      expect(grid.rows[0].data.tags).toEqual(["priority", "trial"]);
    });
  },
};

export const Virtualized: Story = {
  args: { virtualize: true },
  play: async ({ canvasElement }) => {
    const grid = canvasElement.querySelector("violet-data-grid") as ProjectGrid;
    await waitFor(() => {
      expect(grid.virtualize).toBe(true);
      expect(grid.shadowRoot?.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    });
  },
};
