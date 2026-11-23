import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import "./violet-file-upload";
import "../theme/violet-theme";
import { loadVioletBuiltInTheme } from "../theme/violet-theme-runtime";
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
        // The ids are in the upload's shadow root, the button host's tree, so the inner button gets
        // the elements themselves.
        const references = trigger as unknown as Record<"ariaDescribedByElements" | "ariaErrorMessageElements", Element[] | null>;
        const root = upload.shadowRoot as ShadowRoot;
        expect(references.ariaDescribedByElements).toContain(root.getElementById(upload.summaryId));
        expect(references.ariaErrorMessageElements).toEqual([root.getElementById(upload.errorId)]);
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

    it.each(["light", "dark", "high-contrast"])(
        "keeps dropzone resting and drag-active borders at >= 3:1 in %s (#657)",
        async preset => {
            await loadVioletBuiltInTheme();
            document.body.innerHTML = "";
            const theme = document.createElement("violet-theme");
            theme.setAttribute("preset", preset);
            // violet-theme uses display: contents, so paint the page backdrop on a real box inside it.
            const backdrop = document.createElement("div");
            backdrop.style.background = "var(--color-surface-page)";
            const upload = document.createElement("violet-file-upload") as VioletFileUpload;
            upload.appearance = "dropzone";
            upload.label = "Upload files";
            backdrop.append(upload);
            theme.append(backdrop);
            document.body.append(theme);
            await customElements.whenDefined("violet-file-upload");
            await nextFrame();
            await nextFrame();

            const surface = upload.shadowRoot?.querySelector(".surface") as HTMLElement;
            surface.style.transition = "none";

            const parseRgba = (color: string): [number, number, number, number] => {
                const nums = (color.match(/[\d.]+/g) ?? []).map(Number);
                if (color.startsWith("color(srgb")) {
                    return [(nums[0] ?? 0) * 255, (nums[1] ?? 0) * 255, (nums[2] ?? 0) * 255, nums[3] ?? 1];
                }
                return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 1];
            };
            const composite = (fg: [number, number, number, number], bg: [number, number, number, number]): [number, number, number] => [
                fg[0] * fg[3] + bg[0] * (1 - fg[3]),
                fg[1] * fg[3] + bg[1] * (1 - fg[3]),
                fg[2] * fg[3] + bg[2] * (1 - fg[3]),
            ];
            const luminance = (rgb: [number, number, number]): number => {
                const [r = 0, g = 0, b = 0] = rgb.map(v => {
                    const c = v / 255;
                    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
                });
                return r * 0.2126 + g * 0.7152 + b * 0.0722;
            };
            const contrast = (fgColor: string, bgColor: string, backdropColor: string): number => {
                const backdropRgba = parseRgba(backdropColor);
                const bg = composite(parseRgba(bgColor), backdropRgba);
                const fg = composite(parseRgba(fgColor), [bg[0], bg[1], bg[2], 1]);
                const l1 = luminance(fg);
                const l2 = luminance(bg);
                return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            };

            const pageBg = getComputedStyle(backdrop).backgroundColor;
            const resting = getComputedStyle(surface);
            const restingBorder = resting.borderTopColor;
            expect(contrast(restingBorder, resting.backgroundColor, pageBg)).toBeGreaterThanOrEqual(3);

            await userEvent.hover(surface);
            await nextFrame();
            expect(surface.matches(":hover")).toBe(true);
            const hovered = getComputedStyle(surface);
            expect(contrast(hovered.borderTopColor, hovered.backgroundColor, pageBg)).toBeGreaterThanOrEqual(3);
            await userEvent.unhover(surface);
            await nextFrame();

            const browseButton = upload.shadowRoot?.querySelector("violet-button")?.shadowRoot?.querySelector("button") as HTMLButtonElement | null;
            expect(browseButton).toBeTruthy();
            browseButton?.focus();
            await nextFrame();
            expect(surface.matches(":focus-within")).toBe(true);
            const focused = getComputedStyle(surface);
            expect(focused.borderTopColor).not.toBe(restingBorder);
            expect(contrast(focused.borderTopColor, focused.backgroundColor, pageBg)).toBeGreaterThanOrEqual(3);
            browseButton?.blur();
            await nextFrame();

            upload.dragActive = true;
            await nextFrame();
            expect(upload.hasAttribute("data-drag-active")).toBe(true);
            const dragActive = getComputedStyle(surface);
            expect(dragActive.borderTopColor).not.toBe(restingBorder);
            expect(contrast(dragActive.borderTopColor, dragActive.backgroundColor, pageBg)).toBeGreaterThanOrEqual(3);
        },
    );
});
