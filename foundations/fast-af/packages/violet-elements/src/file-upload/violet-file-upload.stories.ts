import type { Meta, StoryObj } from "@storybook/web-components-vite";
import { expect, userEvent, waitFor } from "storybook/test";

import "./violet-file-upload";
import type { VioletFileUpload } from "./violet-file-upload";

type VioletFileUploadStoryArgs = {
    appearance: "button" | "dropzone";
    size: "compact" | "natural" | "comfortable";
    multiple: boolean;
    disabled: boolean;
    required: boolean;
};

function createFile(name: string, type: string, contents = "sample", repetitions = 1): File {
    return new File([contents.repeat(repetitions)], name, { type });
}

function renderUpload(args: VioletFileUploadStoryArgs, presetFiles: File[] = []): HTMLElement {
    const surface = document.createElement("div");
    surface.style.maxInlineSize = "38rem";

    const form = document.createElement("form");
    const upload = document.createElement("violet-file-upload") as VioletFileUpload;
    upload.label = "Upload field maps";
    upload.supportingText = "Accepted formats: PDF, JPG, or PNG.";
    upload.errorText = "Add a valid file before continuing.";
    upload.name = "field-maps";
    upload.accept = ".pdf,.jpg,.jpeg,.png";
    upload.appearance = args.appearance;
    upload.size = args.size;
    upload.multiple = args.multiple;
    upload.disabled = args.disabled;
    upload.required = args.required;

    form.append(upload);
    surface.append(form);

    if (presetFiles.length > 0) {
        upload.setFiles(presetFiles);
    }

    return surface;
}

const meta = {
    title: "Components/File Upload",
    tags: ["autodocs"],
    parameters: {
        docs: {
            description: {
                component:
                    "Native-first Violet file upload control with optional dropzone presentation, selected-file list, removal actions, and form association.",
            },
        },
    },
    argTypes: {
        appearance: {
            control: "radio",
            options: ["button", "dropzone"],
        },
        size: {
            control: "radio",
            options: ["compact", "natural", "comfortable"],
        },
        multiple: { control: "boolean" },
        disabled: { control: "boolean" },
        required: { control: "boolean" },
    },
    render: (args: VioletFileUploadStoryArgs) => renderUpload(args),
} satisfies Meta<VioletFileUploadStoryArgs>;

export default meta;

type Story = StoryObj<VioletFileUploadStoryArgs>;

export const Overview: Story = {
    args: {
        appearance: "button",
        size: "natural",
        multiple: false,
        disabled: false,
        required: false,
    },
    play: async ({ canvasElement }) => {
        const upload = canvasElement.querySelector("violet-file-upload") as VioletFileUpload | null;
        const form = canvasElement.querySelector("form");
        if (!upload || !form) {
            throw new Error("Expected violet-file-upload to render inside a form.");
        }

        const file = createFile("field-map.pdf", "application/pdf", "field-map", 32);
        upload.setFiles([file]);

        await waitFor(() => {
            expect(upload.checkValidity()).toBe(true);
        });

        const formData = new FormData(form);
        await expect(formData.get("field-maps")).toBe(file);

        upload.clearFiles();
        await waitFor(() => {
            expect(upload.files).toHaveLength(0);
            expect(upload.summaryText).toBe("No file selected yet.");
        });
    },
};

export const Dropzone: Story = {
    args: {
        appearance: "dropzone",
        size: "natural",
        multiple: true,
        disabled: false,
        required: false,
    },
};

export const WithFiles: Story = {
    args: {
        appearance: "button",
        size: "natural",
        multiple: true,
        disabled: false,
        required: false,
    },
    render: args =>
        renderUpload(args, [
            createFile("field-map.pdf", "application/pdf", "field-map", 800),
            createFile("north-bed.jpg", "image/jpeg", "north-bed", 1200),
        ]),
};

export const Validation: Story = {
    args: {
        appearance: "dropzone",
        size: "natural",
        multiple: true,
        disabled: false,
        required: false,
    },
    render: args => {
        const surface = renderUpload(args);
        const upload = surface.querySelector("violet-file-upload") as VioletFileUpload;
        upload.maxFiles = "2";
        upload.maxFileSize = "2048";
        return surface;
    },
    play: async ({ canvasElement }) => {
        const upload = canvasElement.querySelector("violet-file-upload") as VioletFileUpload | null;
        if (!upload) {
            throw new Error("Expected violet-file-upload to render.");
        }

        upload.setFiles([
            createFile("north-bed.jpg", "image/jpeg", "north-bed", 4),
            createFile("south-bed.jpg", "image/jpeg", "south-bed", 4),
            createFile("west-bed.jpg", "image/jpeg", "west-bed", 4),
        ]);

        await waitFor(() => {
            expect(upload.validationMessage).toContain("Select no more than 2 files.");
        });
    },
};

export const Invalid: Story = {
    args: {
        appearance: "dropzone",
        size: "natural",
        multiple: true,
        disabled: false,
        required: false,
    },
    render: args => {
        const surface = renderUpload(args);
        const upload = surface.querySelector("violet-file-upload") as VioletFileUpload;
        upload.maxFiles = "2";
        upload.setFiles([
            createFile("north-bed.jpg", "image/jpeg", "north-bed", 4),
            createFile("south-bed.jpg", "image/jpeg", "south-bed", 4),
            createFile("west-bed.jpg", "image/jpeg", "west-bed", 4),
        ]);
        return surface;
    },
};

export const Disabled: Story = {
    args: {
        appearance: "button",
        size: "natural",
        multiple: false,
        disabled: true,
        required: false,
    },
};

export const RemoveInteraction: Story = {
    args: {
        appearance: "button",
        size: "natural",
        multiple: true,
        disabled: false,
        required: false,
    },
    render: args =>
        renderUpload(args, [
            createFile("field-map.pdf", "application/pdf", "field-map", 800),
            createFile("north-bed.jpg", "image/jpeg", "north-bed", 1200),
        ]),
    play: async ({ canvasElement }) => {
        const upload = canvasElement.querySelector("violet-file-upload") as VioletFileUpload | null;
        if (!upload) {
            throw new Error("Expected violet-file-upload to render.");
        }

        const removeButton = upload.shadowRoot?.querySelectorAll("violet-icon-button")[0];
        const control = removeButton?.shadowRoot?.querySelector("button");
        if (!(control instanceof HTMLButtonElement)) {
            throw new Error("Expected selected-file remove button to render.");
        }

        await userEvent.click(control);

        await waitFor(() => {
            expect(upload.files).toHaveLength(1);
        });
    },
};
