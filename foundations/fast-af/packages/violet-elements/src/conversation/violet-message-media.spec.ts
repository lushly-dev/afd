import { afterEach, describe, expect, it } from "vitest";

import "./violet-message-media";
import type { VioletMessageMedia } from "./violet-message-media";

// Remote hosts use the reserved .invalid TLD so nothing real is ever contacted.
const REMOTE_IMAGE = "https://media.example.invalid/photos/cat.png";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function renderMedia(props: Partial<Record<"src" | "mediaType" | "filename" | "alt", string>>): Promise<VioletMessageMedia> {
    document.body.innerHTML = "";
    const media = document.createElement("violet-message-media") as VioletMessageMedia;
    Object.assign(media, props);
    document.body.append(media);
    await customElements.whenDefined("violet-message-media");
    await nextFrame();
    await nextFrame();
    return media;
}

function rootOf(media: VioletMessageMedia): Element {
    const root = media.shadowRoot?.querySelector('[part="root"]');
    if (!root) {
        throw new Error("Expected the media root to render.");
    }
    return root;
}

describe("violet-message-media", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    describe("attributes and properties", () => {
        it("has empty defaults", async () => {
            const media = await renderMedia({});

            expect(media.src).toBe("");
            expect(media.mediaType).toBe("");
            expect(media.filename).toBe("");
            expect(media.alt).toBe("");
        });

        it("maps the media-type attribute to the mediaType property", async () => {
            document.body.innerHTML = `<violet-message-media src="${REMOTE_IMAGE}" media-type="image/png" filename="cat.png" alt="A cat"></violet-message-media>`;
            await nextFrame();
            await nextFrame();
            const media = document.querySelector("violet-message-media") as VioletMessageMedia;

            expect(media.src).toBe(REMOTE_IMAGE);
            expect(media.mediaType).toBe("image/png");
            expect(media.filename).toBe("cat.png");
            expect(media.alt).toBe("A cat");
            expect(media.shadowRoot?.querySelector("img")).not.toBeNull();
        });

        it("reflects properties to attributes", async () => {
            const media = await renderMedia({});

            media.src = REMOTE_IMAGE;
            media.mediaType = "image/png";
            media.filename = "cat.png";
            media.alt = "A cat";
            await nextFrame();

            expect(media.getAttribute("src")).toBe(REMOTE_IMAGE);
            expect(media.getAttribute("media-type")).toBe("image/png");
            expect(media.getAttribute("filename")).toBe("cat.png");
            expect(media.getAttribute("alt")).toBe("A cat");
        });
    });

    describe("empty source", () => {
        it("renders nothing inside the root without a src", async () => {
            const media = await renderMedia({ mediaType: "image/png", filename: "cat.png" });

            expect(rootOf(media).querySelector("img, audio, video, .file-row")).toBeNull();
        });

        it("renders the media once a src is assigned", async () => {
            const media = await renderMedia({ mediaType: "image/png" });

            media.src = REMOTE_IMAGE;
            await nextFrame();
            await nextFrame();

            expect(media.shadowRoot?.querySelector("img")?.getAttribute("src")).toBe(REMOTE_IMAGE);
        });
    });

    describe("images (including remote src)", () => {
        it("renders an img inside the preview part", async () => {
            const media = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/png", alt: "A cat" });
            const img = media.shadowRoot?.querySelector<HTMLImageElement>('[part="preview"] img');

            expect(img).not.toBeNull();
            expect(img?.getAttribute("src")).toBe(REMOTE_IMAGE);
            expect(img?.getAttribute("alt")).toBe("A cat");
        });

        it("lazy loads images", async () => {
            const media = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/png" });

            expect(media.shadowRoot?.querySelector("img")?.getAttribute("loading")).toBe("lazy");
        });

        it("sends no referrer for remote images and sets no other fetch hints", async () => {
            const media = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/png" });
            const img = media.shadowRoot?.querySelector("img");

            expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
            expect(img?.hasAttribute("crossorigin")).toBe(false);
            expect(img?.hasAttribute("decoding")).toBe(false);
            expect(img?.hasAttribute("fetchpriority")).toBe(false);
        });

        it("passes the remote URL through unchanged without a proxy or rewrite", async () => {
            const media = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/png" });
            const img = media.shadowRoot?.querySelector<HTMLImageElement>("img");

            expect(img?.getAttribute("src")).toBe(REMOTE_IMAGE);
            expect(img?.src).toBe(REMOTE_IMAGE);
        });

        it("does not sanitise the src scheme (documented behaviour, unlike violet-source-citation)", async () => {
            const media = await renderMedia({ src: "javascript:alert(1)", mediaType: "image/png" });

            // The value is bound verbatim; browsers do not execute javascript: URLs for <img>.
            expect(media.shadowRoot?.querySelector("img")?.getAttribute("src")).toBe("javascript:alert(1)");
        });

        it("keeps rendering the img when the remote image fails to load (no error fallback)", async () => {
            const media = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/png", alt: "A cat" });
            const img = media.shadowRoot?.querySelector("img") as HTMLImageElement;

            img.dispatchEvent(new Event("error"));
            await nextFrame();

            expect(media.shadowRoot?.querySelector("img")).toBe(img);
            expect(media.shadowRoot?.querySelector(".file-row")).toBeNull();
        });

        it("falls back from alt to filename to a generic label", async () => {
            const withAlt = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/png", alt: "A cat", filename: "cat.png" });
            expect(withAlt.shadowRoot?.querySelector("img")?.getAttribute("alt")).toBe("A cat");

            const withFilename = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/png", filename: "cat.png" });
            expect(withFilename.shadowRoot?.querySelector("img")?.getAttribute("alt")).toBe("cat.png");

            const bare = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/jpeg" });
            expect(bare.shadowRoot?.querySelector("img")?.getAttribute("alt")).toBe("Image");
        });

        it("updates the img when src changes", async () => {
            const media = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/png" });

            media.src = "https://media.example.invalid/photos/dog.png";
            await nextFrame();
            await nextFrame();

            expect(media.shadowRoot?.querySelector("img")?.getAttribute("src")).toBe("https://media.example.invalid/photos/dog.png");
        });

        it("loads data URLs without touching the network", async () => {
            const pixel = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
            const media = await renderMedia({ src: pixel, mediaType: "image/gif" });

            expect(media.shadowRoot?.querySelector("img")?.getAttribute("src")).toBe(pixel);
        });
    });

    describe("audio and video", () => {
        it("renders audio with controls, metadata preload and a typed source", async () => {
            const media = await renderMedia({ src: "https://media.example.invalid/a.mp3", mediaType: "audio/mpeg" });
            const audio = media.shadowRoot?.querySelector<HTMLAudioElement>('[part="preview"] audio');
            const source = audio?.querySelector("source");

            expect(audio).not.toBeNull();
            expect(audio?.controls).toBe(true);
            expect(audio?.getAttribute("preload")).toBe("metadata");
            expect(source?.getAttribute("src")).toBe("https://media.example.invalid/a.mp3");
            expect(source?.getAttribute("type")).toBe("audio/mpeg");
        });

        it("renders video with controls, metadata preload and a typed source", async () => {
            const media = await renderMedia({ src: "https://media.example.invalid/v.mp4", mediaType: "video/mp4" });
            const video = media.shadowRoot?.querySelector<HTMLVideoElement>('[part="preview"] video');
            const source = video?.querySelector("source");

            expect(video).not.toBeNull();
            expect(video?.controls).toBe(true);
            expect(video?.getAttribute("preload")).toBe("metadata");
            expect(video?.hasAttribute("autoplay")).toBe(false);
            expect(source?.getAttribute("src")).toBe("https://media.example.invalid/v.mp4");
            expect(source?.getAttribute("type")).toBe("video/mp4");
        });

        it("does not set referrerpolicy or crossorigin on audio and video", async () => {
            const audio = await renderMedia({ src: "https://media.example.invalid/a.mp3", mediaType: "audio/mpeg" });
            expect(audio.shadowRoot?.querySelector("audio")?.hasAttribute("crossorigin")).toBe(false);
            expect(audio.shadowRoot?.querySelector("source")?.hasAttribute("referrerpolicy")).toBe(false);

            const video = await renderMedia({ src: "https://media.example.invalid/v.mp4", mediaType: "video/mp4" });
            expect(video.shadowRoot?.querySelector("video")?.hasAttribute("crossorigin")).toBe(false);
            expect(video.shadowRoot?.querySelector("source")?.hasAttribute("referrerpolicy")).toBe(false);
        });
    });

    describe("generic file fallback", () => {
        it("renders a file row with filename and media type for non-previewable types", async () => {
            const media = await renderMedia({ src: "https://media.example.invalid/report.pdf", mediaType: "application/pdf", filename: "report.pdf" });
            const row = media.shadowRoot?.querySelector(".file-row");

            expect(row).not.toBeNull();
            expect(media.shadowRoot?.querySelector('[part="filename"]')?.textContent?.trim()).toBe("report.pdf");
            expect(row?.querySelector(".file-type")?.textContent?.trim()).toBe("application/pdf");
            expect(media.shadowRoot?.querySelector("img, audio, video")).toBeNull();
        });

        it("renders no link, so a remote file URL is never fetched or navigated to", async () => {
            const media = await renderMedia({ src: "https://media.example.invalid/report.pdf", mediaType: "application/pdf", filename: "report.pdf" });

            expect(media.shadowRoot?.querySelector("a, [href], [src]")).toBeNull();
        });

        it("uses placeholder text when filename and media type are missing", async () => {
            const media = await renderMedia({ src: "https://media.example.invalid/blob" });

            expect(media.shadowRoot?.querySelector('[part="filename"]')?.textContent?.trim()).toBe("File");
            expect(media.shadowRoot?.querySelector(".file-type")?.textContent?.trim()).toBe("Unknown type");
        });

        it("renders the attach icon as decorative with an icon part", async () => {
            const media = await renderMedia({ src: "https://media.example.invalid/report.pdf", mediaType: "application/pdf" });
            const icon = media.shadowRoot?.querySelector('[part="icon"] violet-icon');

            expect(icon?.getAttribute("icon")).toBe("system/attach");
            expect(icon?.hasAttribute("decorative")).toBe(true);
        });

        it("swaps between media kinds when mediaType changes", async () => {
            const media = await renderMedia({ src: "https://media.example.invalid/x", mediaType: "image/png" });
            expect(media.shadowRoot?.querySelector("img")).not.toBeNull();

            media.mediaType = "application/zip";
            await nextFrame();
            await nextFrame();

            expect(media.shadowRoot?.querySelector("img")).toBeNull();
            expect(media.shadowRoot?.querySelector(".file-row")).not.toBeNull();
        });
    });

    it("treats MIME types case-insensitively", async () => {
        const media = await renderMedia({ src: REMOTE_IMAGE, mediaType: "IMAGE/PNG" });

        expect(media.shadowRoot?.querySelector("img")).not.toBeNull();
    });
});
