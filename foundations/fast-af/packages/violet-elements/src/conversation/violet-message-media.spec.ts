import { afterEach, describe, expect, it } from "vitest";

import "./violet-message-media";
import type { VioletMessageMedia } from "./violet-message-media";

// Remote hosts use the reserved .invalid TLD so nothing real is ever contacted.
const REMOTE_IMAGE = "https://media.example.invalid/photos/cat.png";
const REMOTE_ORIGIN = "https://media.example.invalid";
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function nextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

type MediaProps = Partial<Record<"src" | "mediaType" | "filename" | "alt" | "allowedOrigins", string>>;

/**
 * Specs that assert on the rendered remote <img> must not race the real network:
 * the .invalid hosts fail to load, and a failed load now swaps the img for the file row.
 * Only real (trusted) load errors are swallowed; events a spec dispatches itself still reach the img.
 */
function holdNetworkImageErrors(media: VioletMessageMedia): void {
    media.shadowRoot?.addEventListener("error", event => {
        if (event.isTrusted) {
            event.stopPropagation();
        }
    }, true);
}

/** Builds the element from attributes (the markup path) with network errors held. */
async function renderFromAttributes(attributes: Record<string, string>): Promise<VioletMessageMedia> {
    document.body.innerHTML = "";
    const media = document.createElement("violet-message-media") as VioletMessageMedia;
    holdNetworkImageErrors(media);
    for (const [name, value] of Object.entries(attributes)) {
        media.setAttribute(name, value);
    }
    document.body.append(media);
    await nextFrame();
    await nextFrame();
    return media;
}

async function renderMedia(props: MediaProps, options: { holdNetworkErrors?: boolean } = {}): Promise<VioletMessageMedia> {
    document.body.innerHTML = "";
    const media = document.createElement("violet-message-media") as VioletMessageMedia;
    if (options.holdNetworkErrors !== false) {
        holdNetworkImageErrors(media);
    }
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
            expect(media.allowedOrigins).toBe("");
        });

        it("maps the media-type attribute to the mediaType property", async () => {
            const media = await renderFromAttributes({ "src": REMOTE_IMAGE, "media-type": "image/png", "filename": "cat.png", "alt": "A cat" });

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

        it("replaces the img with the file row when the image fails to load", async () => {
            const media = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/png", alt: "A cat", filename: "cat.png" });
            const img = media.shadowRoot?.querySelector("img") as HTMLImageElement;

            img.dispatchEvent(new Event("error"));
            await nextFrame();
            await nextFrame();

            expect(media.shadowRoot?.querySelector("img")).toBeNull();
            expect(media.shadowRoot?.querySelector('[part="preview"]')).toBeNull();
            expect(media.shadowRoot?.querySelector('[part="filename"]')?.textContent?.trim()).toBe("cat.png");
            expect(media.shadowRoot?.querySelector(".file-type")?.textContent?.trim()).toBe("image/png");
            expect(media.shadowRoot?.querySelector("a, [href], [src]")).toBeNull();
        });

        it("tries again when src changes after a failed load", async () => {
            const media = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/png" });
            media.shadowRoot?.querySelector("img")?.dispatchEvent(new Event("error"));
            await nextFrame();
            await nextFrame();
            expect(media.shadowRoot?.querySelector("img")).toBeNull();

            media.src = PIXEL;
            await nextFrame();
            await nextFrame();

            expect(media.shadowRoot?.querySelector("img")?.getAttribute("src")).toBe(PIXEL);
            expect(media.shadowRoot?.querySelector(".file-row")).toBeNull();
        });

        it("falls back on a real load failure too (undecodable data URL, no network)", async () => {
            const media = await renderMedia({ src: "data:image/png;base64,AAAA", mediaType: "image/png", filename: "broken.png" }, { holdNetworkErrors: false });
            await new Promise(resolve => setTimeout(resolve, 200));
            await nextFrame();

            expect(media.shadowRoot?.querySelector("img")).toBeNull();
            expect(media.shadowRoot?.querySelector('[part="filename"]')?.textContent?.trim()).toBe("broken.png");
        });

        it("keeps the img when a data URL image loads (no error)", async () => {
            const media = await renderMedia({ src: PIXEL, mediaType: "image/gif" }, { holdNetworkErrors: false });
            await nextFrame();

            expect(media.shadowRoot?.querySelector("img")).not.toBeNull();
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

    describe("remote-source policy (allowed-origins)", () => {
        it("loads any source when allowed-origins is not set (default unchanged)", async () => {
            const image = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/png" });
            const audio = await renderMedia({ src: "https://other.example.invalid/a.mp3", mediaType: "audio/mpeg" });

            expect(image.shadowRoot?.querySelector("img")).not.toBeNull();
            expect(audio.shadowRoot?.querySelector("audio")).not.toBeNull();
        });

        it("maps the allowed-origins attribute to the allowedOrigins property", async () => {
            const media = await renderFromAttributes({ "src": REMOTE_IMAGE, "media-type": "image/png", "allowed-origins": REMOTE_ORIGIN });

            expect(media.allowedOrigins).toBe(REMOTE_ORIGIN);
            expect(media.shadowRoot?.querySelector("img")).not.toBeNull();
        });

        it("loads a remote source whose origin is listed", async () => {
            const media = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/png", allowedOrigins: `https://a.example.invalid ${REMOTE_ORIGIN}` });

            expect(media.shadowRoot?.querySelector("img")?.getAttribute("src")).toBe(REMOTE_IMAGE);
        });

        it("renders the file row, without loading anything, for an unlisted remote image", async () => {
            const media = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/png", filename: "cat.png", allowedOrigins: "https://cdn.example.invalid" });

            expect(media.shadowRoot?.querySelector("img, audio, video, source")).toBeNull();
            expect(media.shadowRoot?.querySelector('[part="filename"]')?.textContent?.trim()).toBe("cat.png");
            expect(media.shadowRoot?.querySelector(".file-type")?.textContent?.trim()).toBe("image/png");
            expect(media.shadowRoot?.querySelector("a, [href], [src]")).toBeNull();
        });

        it("applies to audio and video as well", async () => {
            const audio = await renderMedia({ src: "https://media.example.invalid/a.mp3", mediaType: "audio/mpeg", allowedOrigins: "https://cdn.example.invalid" });
            const video = await renderMedia({ src: "https://media.example.invalid/v.mp4", mediaType: "video/mp4", allowedOrigins: "https://cdn.example.invalid" });

            expect(audio.shadowRoot?.querySelector("audio, source")).toBeNull();
            expect(audio.shadowRoot?.querySelector(".file-row")).not.toBeNull();
            expect(video.shadowRoot?.querySelector("video, source")).toBeNull();
            expect(video.shadowRoot?.querySelector(".file-row")).not.toBeNull();
        });

        it("matches origins exactly: scheme, host and port all count", async () => {
            for (const allowed of ["http://media.example.invalid", "https://media.example.invalid:8443", "https://example.invalid", "https://evil.media.example.invalid"]) {
                const media = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/png", allowedOrigins: allowed });
                expect(media.shadowRoot?.querySelector("img"), allowed).toBeNull();
            }
        });

        it("accepts origins written with a path, a trailing slash or different case", async () => {
            const media = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/png", allowedOrigins: "HTTPS://Media.Example.Invalid/some/path/" });

            expect(media.shadowRoot?.querySelector("img")).not.toBeNull();
        });

        it("blocks protocol-relative and credentialed look-alike URLs that resolve elsewhere", async () => {
            const lookalike = await renderMedia({ src: `${REMOTE_ORIGIN}@evil.example.invalid/cat.png`, mediaType: "image/png", allowedOrigins: REMOTE_ORIGIN });
            const protocolRelative = await renderMedia({ src: "//evil.example.invalid/cat.png", mediaType: "image/png", allowedOrigins: REMOTE_ORIGIN });

            expect(lookalike.shadowRoot?.querySelector("img")).toBeNull();
            expect(protocolRelative.shadowRoot?.querySelector("img")).toBeNull();
        });

        it("always allows data: and blob: sources, which never touch the network", async () => {
            const data = await renderMedia({ src: PIXEL, mediaType: "image/gif", allowedOrigins: REMOTE_ORIGIN }, { holdNetworkErrors: false });
            const blobUrl = URL.createObjectURL(new Blob(["x"], { type: "image/png" }));
            const blob = await renderMedia({ src: blobUrl, mediaType: "image/png", allowedOrigins: REMOTE_ORIGIN });

            expect(data.shadowRoot?.querySelector("img")).not.toBeNull();
            expect(blob.shadowRoot?.querySelector("img")).not.toBeNull();
            URL.revokeObjectURL(blobUrl);
        });

        it("allows relative and same-origin sources", async () => {
            const relative = await renderMedia({ src: "/assets/cat.png", mediaType: "image/png", allowedOrigins: REMOTE_ORIGIN });
            const sameOrigin = await renderMedia({ src: `${location.origin}/assets/cat.png`, mediaType: "image/png", allowedOrigins: REMOTE_ORIGIN });

            expect(relative.shadowRoot?.querySelector("img")).not.toBeNull();
            expect(sameOrigin.shadowRoot?.querySelector("img")).not.toBeNull();
        });

        it("blocks other schemes and unparsable sources once a policy is set", async () => {
            const script = await renderMedia({ src: "javascript:alert(1)", mediaType: "image/png", allowedOrigins: REMOTE_ORIGIN });
            const ftp = await renderMedia({ src: "ftp://media.example.invalid/cat.png", mediaType: "image/png", allowedOrigins: REMOTE_ORIGIN });
            const garbage = await renderMedia({ src: "http://", mediaType: "image/png", allowedOrigins: REMOTE_ORIGIN });

            expect(script.shadowRoot?.querySelector("img")).toBeNull();
            expect(ftp.shadowRoot?.querySelector("img")).toBeNull();
            expect(garbage.shadowRoot?.querySelector("img")).toBeNull();
        });

        it("blocks every remote source when the list holds no valid origin (for example 'none')", async () => {
            const media = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/png", allowedOrigins: "none" });

            expect(media.shadowRoot?.querySelector("img")).toBeNull();
            expect(media.shadowRoot?.querySelector(".file-row")).not.toBeNull();
        });

        it("re-evaluates when allowed-origins or src change", async () => {
            const media = await renderMedia({ src: REMOTE_IMAGE, mediaType: "image/png", allowedOrigins: "https://cdn.example.invalid" });
            expect(media.shadowRoot?.querySelector("img")).toBeNull();

            media.allowedOrigins = REMOTE_ORIGIN;
            await nextFrame();
            await nextFrame();
            expect(media.shadowRoot?.querySelector("img")).not.toBeNull();

            media.src = "https://other.example.invalid/dog.png";
            await nextFrame();
            await nextFrame();
            expect(media.shadowRoot?.querySelector("img")).toBeNull();

            media.allowedOrigins = "";
            await nextFrame();
            await nextFrame();
            expect(media.shadowRoot?.querySelector("img")).not.toBeNull();
        });
    });

    it("treats MIME types case-insensitively", async () => {
        const media = await renderMedia({ src: REMOTE_IMAGE, mediaType: "IMAGE/PNG" });

        expect(media.shadowRoot?.querySelector("img")).not.toBeNull();
    });
});
