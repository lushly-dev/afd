import { afterEach, describe, expect, it } from "vitest";
import { cdp, server, userEvent } from "vitest/browser";

const isChromium = server.browser === "chromium";

import "./violet-file-upload.define";
import "../theme/violet-theme.define";
import { loadVioletBuiltInTheme } from "../theme/violet-theme-runtime";
import type { VioletFileUpload } from "./violet-file-upload";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
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

/**
 * Emulates a dark forced-colours theme (Windows "Night sky"), or restores the media Playwright
 * emulates by default, so later spec files on the page do not follow the host.
 */
async function emulateForcedColors(active: boolean): Promise<void> {
  const session = cdp() as unknown as { send(method: string, params?: object): Promise<unknown> };
  await session.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "forced-colors", value: active ? "active" : "none" },
      { name: "prefers-color-scheme", value: active ? "dark" : "light" },
    ],
  });
}

/** What a system colour resolves to in the current colour scheme. */
function systemColor(name: string): string {
  const probe = document.createElement("span");
  probe.style.color = name;
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
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
    const button = upload.shadowRoot
      ?.querySelector("violet-button")
      ?.shadowRoot?.querySelector("button");
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

    const trigger = upload.shadowRoot
      ?.querySelector("violet-button")
      ?.shadowRoot?.querySelector("button");
    expect(trigger).toBeTruthy();
    expect(trigger?.getAttribute("aria-label")).toBe("Upload field map: Browse file");
    // The ids are in the upload's shadow root, the button host's tree, so the inner button gets
    // the elements themselves.
    const references = trigger as unknown as Record<
      "ariaDescribedByElements" | "ariaErrorMessageElements",
      Element[] | null
    >;
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
    upload.addEventListener("input", () => (inputCount += 1));
    upload.addEventListener("change", () => (changeCount += 1));

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
    async (preset) => {
      await loadVioletBuiltInTheme();
      document.body.innerHTML = "";
      const theme = document.createElement("violet-theme");
      theme.setAttribute("preset", preset);
      // violet-theme uses display: contents, so paint the page backdrop on a real box inside it.
      const backdrop = document.createElement("div");
      backdrop.style.background = "var(--violet-color-surface-page)";
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
      const composite = (
        fg: [number, number, number, number],
        bg: [number, number, number, number],
      ): [number, number, number] => [
        fg[0] * fg[3] + bg[0] * (1 - fg[3]),
        fg[1] * fg[3] + bg[1] * (1 - fg[3]),
        fg[2] * fg[3] + bg[2] * (1 - fg[3]),
      ];
      const luminance = (rgb: [number, number, number]): number => {
        const [r = 0, g = 0, b = 0] = rgb.map((v) => {
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
      expect(
        contrast(hovered.borderTopColor, hovered.backgroundColor, pageBg),
      ).toBeGreaterThanOrEqual(3);
      await userEvent.unhover(surface);
      await nextFrame();

      const browseButton = upload.shadowRoot
        ?.querySelector("violet-button")
        ?.shadowRoot?.querySelector("button") as HTMLButtonElement | null;
      expect(browseButton).toBeTruthy();
      browseButton?.focus();
      await nextFrame();
      expect(surface.matches(":focus-within")).toBe(true);
      const focused = getComputedStyle(surface);
      expect(focused.borderTopColor).not.toBe(restingBorder);
      expect(
        contrast(focused.borderTopColor, focused.backgroundColor, pageBg),
      ).toBeGreaterThanOrEqual(3);
      browseButton?.blur();
      await nextFrame();

      upload.dragActive = true;
      await nextFrame();
      expect(upload.hasAttribute("data-drag-active")).toBe(true);
      const dragActive = getComputedStyle(surface);
      expect(dragActive.borderTopColor).not.toBe(restingBorder);
      expect(
        contrast(dragActive.borderTopColor, dragActive.backgroundColor, pageBg),
      ).toBeGreaterThanOrEqual(3);
    },
  );

  if (isChromium)
    describe("under forced colours", () => {
      afterEach(async () => {
        await emulateForcedColors(false);
      });

      // #2183: the surface opts out of colour adjustment, so the drag-active rule's author border
      // and focus shadow outranked the forced-colours rule for the surface.
      it("paints the drag-active, focused, invalid and disabled dropzone in system colours", async () => {
        await loadVioletBuiltInTheme();
        await emulateForcedColors(true);
        document.body.innerHTML = "";
        const theme = document.createElement("violet-theme");
        const upload = document.createElement("violet-file-upload") as VioletFileUpload;
        upload.appearance = "dropzone";
        upload.label = "Upload files";
        theme.append(upload);
        document.body.append(theme);
        await customElements.whenDefined("violet-file-upload");
        await nextFrame();
        await nextFrame();

        expect(matchMedia("(forced-colors: active)").matches).toBe(true);
        const surface = upload.shadowRoot?.querySelector(".surface") as HTMLElement;
        surface.style.transition = "none";
        const resting = getComputedStyle(surface);
        expect(resting.forcedColorAdjust).toBe("none");
        expect(resting.borderTopColor).toBe(systemColor("ButtonText"));
        expect(resting.boxShadow).toBe("none");
        const title = upload.shadowRoot?.querySelector(".dropzone-title") as HTMLElement;
        const message = upload.shadowRoot?.querySelector(".dropzone-message") as HTMLElement;
        expect(getComputedStyle(title).color).toBe(systemColor("CanvasText"));
        expect(getComputedStyle(message).color).toBe(systemColor("CanvasText"));
        const browse = upload.shadowRoot
          ?.querySelector("violet-button")
          ?.shadowRoot?.querySelector("button") as HTMLElement;
        expect(getComputedStyle(browse).forcedColorAdjust).toBe("auto");
        expect(getComputedStyle(browse).color).toBe(systemColor("ButtonText"));

        await userEvent.hover(surface);
        await nextFrame();
        expect(surface.matches(":hover")).toBe(true);
        const hovered = getComputedStyle(surface);
        expect(hovered.borderTopColor).toBe(systemColor("ButtonText"));
        expect(hovered.backgroundColor).toBe(systemColor("Canvas"));
        await userEvent.unhover(surface);
        await nextFrame();

        upload.dragActive = true;
        await nextFrame();
        expect(upload.hasAttribute("data-drag-active")).toBe(true);
        const dragActive = getComputedStyle(surface);
        expect(dragActive.backgroundColor).toBe(systemColor("Canvas"));
        expect(dragActive.borderTopColor).toBe(systemColor("Highlight"));
        expect(dragActive.boxShadow).toBe("none");
        expect(dragActive.outlineColor).toBe(systemColor("Highlight"));
        upload.dragActive = false;
        await nextFrame();

        const browseButton = upload.shadowRoot
          ?.querySelector("violet-button")
          ?.shadowRoot?.querySelector("button") as HTMLButtonElement;
        browseButton.focus();
        await nextFrame();
        expect(surface.matches(":focus-within")).toBe(true);
        const focused = getComputedStyle(surface);
        expect(focused.borderTopColor).toBe(systemColor("Highlight"));
        expect(focused.boxShadow).toBe("none");
        browseButton.blur();
        await nextFrame();

        upload.setAttribute("invalid", "");
        await nextFrame();
        expect(getComputedStyle(surface).borderTopColor).toBe(systemColor("LinkText"));
        upload.removeAttribute("invalid");

        upload.setAttribute("disabled", "");
        await nextFrame();
        expect(getComputedStyle(surface).borderTopColor).toBe(systemColor("GrayText"));
      });
    });
});
