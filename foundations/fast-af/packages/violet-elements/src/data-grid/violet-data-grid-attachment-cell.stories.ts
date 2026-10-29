import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, waitFor } from "storybook/test";

import "./violet-data-grid-attachment-cell";
import type {
  VioletDataGridAttachmentCell,
  VioletDataGridAttachmentCellUploadRequestDetail,
} from "./violet-data-grid-attachment-cell";
import {
  parseAttachmentCellValue,
  type VioletDataGridAttachmentItem,
} from "./violet-data-grid-attachment-cell-values";

type AttachmentCellStoryArgs = {
  attachments: VioletDataGridAttachmentItem[];
  placeholder: string;
  readonly: boolean;
  disabled?: boolean;
};

const attachmentItems: VioletDataGridAttachmentItem[] = [
  {
    id: "attachment-bed-plan",
    label: "Bed plan cover.png",
    kind: "image",
    meta: "PNG · 84 KB",
  },
  {
    id: "attachment-yield-sheet",
    label: "Yield sheet.pdf",
    kind: "document",
    meta: "PDF · 180 KB",
  },
];

function renderAttachmentCell(args: AttachmentCellStoryArgs): HTMLElement {
  const element = document.createElement(
    "violet-data-grid-attachment-cell",
  ) as VioletDataGridAttachmentCell;
  element.attachments = args.attachments;
  element.placeholder = args.placeholder;
  element.readonly = args.readonly;
  element.disabled = args.disabled ?? false;
  element.setAttribute("aria-label", "Attachments");

  return element;
}

const meta = {
  title: "Components/Data Grid/Attachment Cell",
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Compact grid-native attachment editor with top-layer add/remove controls. Listen for `upload-request` to receive original Files and durable attachment metadata before the uploader clears. The host owns file persistence and may replace items by id with persistent preview URLs. Component-owned thumbnail URLs are transient, never serialized, and revoked on removal/disconnect; committed `change.attachments` matches the parsed value. Host-provided preview URLs are preserved.",
      },
    },
  },
  render: (args: AttachmentCellStoryArgs) => renderAttachmentCell(args),
} satisfies Meta<AttachmentCellStoryArgs>;

export default meta;

type Story = StoryObj<AttachmentCellStoryArgs>;

export const Overview: Story = {
  args: {
    attachments: [attachmentItems[0]],
    placeholder: "Add attachments",
    readonly: false,
  },
  play: async ({ canvasElement }) => {
    const element = canvasElement.querySelector(
      "violet-data-grid-attachment-cell",
    ) as VioletDataGridAttachmentCell | null;

    if (!element) {
      throw new Error("Expected violet-data-grid-attachment-cell to render.");
    }

    element.handleTriggerClick();

    await waitFor(() => {
      expect(element.open).toBe(true);
    });

    element.appendAttachments([attachmentItems[1]]);

    await waitFor(() => {
      expect(element.attachments).toHaveLength(2);
    });

    element.handleTriggerClick();

    await waitFor(() => {
      expect(element.open).toBe(false);
      expect(element.value).toContain("Yield sheet.pdf");
    });
  },
};

export const EmptyState: Story = {
  args: {
    attachments: [],
    placeholder: "Add attachments",
    readonly: false,
  },
};

export const Readonly: Story = {
  args: {
    attachments: attachmentItems,
    placeholder: "Add attachments",
    readonly: true,
  },
};

export const Disabled: Story = {
  args: { ...Overview.args, disabled: true },
  play: async ({ canvasElement }) => {
    const element = canvasElement.querySelector(
      "violet-data-grid-attachment-cell",
    ) as VioletDataGridAttachmentCell;
    expect(element.shadowRoot?.querySelector<HTMLButtonElement>(".trigger")?.disabled).toBe(true);
    element.handleTriggerClick();
    expect(element.open).toBe(false);
  },
};

export const ImageUploadIntent: Story = {
  args: { attachments: [], placeholder: "Add attachments", readonly: false },
  play: async ({ canvasElement }) => {
    const element = canvasElement.querySelector(
      "violet-data-grid-attachment-cell",
    ) as VioletDataGridAttachmentCell;
    let request: VioletDataGridAttachmentCellUploadRequestDetail | undefined;
    const onUpload = (event: Event) => {
      request = (event as CustomEvent<VioletDataGridAttachmentCellUploadRequestDetail>).detail;
    };
    element.addEventListener("upload-request", onUpload);
    try {
      element.handleTriggerClick();
      await waitFor(() =>
        expect(element.shadowRoot?.querySelector("violet-file-upload")).not.toBeNull(),
      );
      const upload = element.shadowRoot!.querySelector("violet-file-upload")!;
      const input = upload.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]')!;
      const file = new File(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>',
        ],
        "Harvest.svg",
        { type: "image/svg+xml" },
      );
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      await waitFor(() => expect(request?.files[0]).toBe(file));
      expect(request?.attachments[0].previewSrc).toBeUndefined();
      expect(element.attachments[0].previewSrc).toMatch(/^blob:/);
      element.handleTriggerClick();
      await waitFor(() => expect(element.open).toBe(false));
      expect(parseAttachmentCellValue(element.value)[0].previewSrc).toBeUndefined();
    } finally {
      element.removeEventListener("upload-request", onUpload);
    }
  },
};
