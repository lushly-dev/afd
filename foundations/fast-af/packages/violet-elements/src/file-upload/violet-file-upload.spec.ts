import { afterEach, describe, expect, it } from "vitest";

import "./violet-file-upload";
import type { VioletFileUpload } from "./violet-file-upload";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function createFile(name: string, type: string, contents = "sample", repetitions = 1): File {
    return new File([contents.repeat(repetitions)], name, { type });
}

async function renderUpload(): Promise<VioletFileUpload> {
    document.body.innerHTML = "";
    const form = document.createElement("form");
    const upload = document.createElement("violet-file-upload") as VioletFileUpload;
    upload.label = "Upload field map";
    upload.name = "field-map";
    form.append(upload);
    document.body.append(form);
    await customElements.whenDefined("violet-file-upload");
    await nextFrame();
    return upload;
}

describe("violet-file-upload", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("renders a browse action and empty summary", async () => {
        const upload = await renderUpload();
        expect(upload.shadowRoot?.textContent).toContain("Browse file");
        expect(upload.shadowRoot?.textContent).toContain("No file selected yet.");
    });

    it("keeps status text undimmed while disabling the browse action", async () => {
        const upload = await renderUpload();
        upload.disabled = true;
        await nextFrame();

        const surface = upload.shadowRoot?.querySelector(".surface") as HTMLElement;
        const summary = upload.shadowRoot?.querySelector(".summary") as HTMLElement;
        const button = upload.shadowRoot?.querySelector("violet-button")?.shadowRoot?.querySelector("button");
        expect(button?.disabled).toBe(true);
        expect(getComputedStyle(surface).opacity).toBe("1");
        expect(getComputedStyle(summary).opacity).toBe("1");
    });

    it("submits selected files through form-associated state", async () => {
        const upload = await renderUpload();
        const file = createFile("field-map.pdf", "application/pdf", "field-map", 32);

        expect(upload.setFiles([file])).toBe(true);
        await nextFrame();

        const form = upload.closest("form") as HTMLFormElement;
        const formData = new FormData(form);
        expect(formData.get("field-map")).toBe(file);
        expect(upload.files).toHaveLength(1);
    });

    it("forwards accessible name and descriptions to the browse trigger", async () => {
        const upload = await renderUpload();
        upload.supportingText = "Accepted formats: PDF or PNG.";
        upload.errorText = "Add a valid file.";
        upload.invalid = true;
        await nextFrame();

        const trigger = upload.shadowRoot?.querySelector("violet-button")?.shadowRoot?.querySelector("button");
        expect(trigger).toBeTruthy();
        expect(trigger?.getAttribute("aria-label")).toBe("Upload field map: Browse file");
        expect(trigger?.getAttribute("aria-describedby")).toContain(upload.summaryId);
        expect(trigger?.getAttribute("aria-errormessage")).toBe(upload.errorId);
    });

    it("rejects files that exceed the accepted file count", async () => {
        const upload = await renderUpload();
        upload.multiple = true;
        upload.maxFiles = "2";

        const result = upload.setFiles([
            createFile("north.pdf", "application/pdf"),
            createFile("south.pdf", "application/pdf"),
            createFile("west.pdf", "application/pdf"),
        ]);
        await nextFrame();

        expect(result).toBe(false);
        expect(upload.validationMessage).toContain("Select no more than 2 files.");
        expect(upload.files).toHaveLength(0);
    });

    it("rejects files that do not match the accepted types", async () => {
        const upload = await renderUpload();
        upload.accept = ".pdf,.png";

        const result = upload.setFiles([createFile("field-map.csv", "text/csv")]);
        await nextFrame();

        expect(result).toBe(false);
        expect(upload.validationMessage).toContain("does not match the accepted file types");
    });

    it("removes a selected file and clears the form value", async () => {
        const upload = await renderUpload();
        const file = createFile("field-map.pdf", "application/pdf", "field-map", 32);

        upload.setFiles([file]);
        await nextFrame();
        upload.removeFileAt(0);
        await nextFrame();

        const form = upload.closest("form") as HTMLFormElement;
        const formData = new FormData(form);
        expect(upload.files).toHaveLength(0);
        expect(formData.get("field-map")).toBeNull();
    });

    it("emits one input and one change event for a native selection", async () => {
        const upload = await renderUpload();
        const input = upload.shadowRoot?.querySelector("input") as HTMLInputElement | null;
        const file = createFile("field-map.pdf", "application/pdf", "field-map", 32);
        const transfer = new DataTransfer();
        transfer.items.add(file);

        let inputCount = 0;
        let changeCount = 0;
        upload.addEventListener("input", () => inputCount += 1);
        upload.addEventListener("change", () => changeCount += 1);

        expect(input).toBeTruthy();
        Object.defineProperty(input, "files", {
            configurable: true,
            value: transfer.files,
        });

        input?.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        input?.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        await nextFrame();

        expect(upload.files).toHaveLength(1);
        expect(inputCount).toBe(1);
        expect(changeCount).toBe(1);
    });
});
