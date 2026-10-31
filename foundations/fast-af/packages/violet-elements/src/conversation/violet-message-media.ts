import { FASTElement, attr, css, html, observable } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";
import { registerSystemAttachIcon } from "../icon/generated/icons/system-attach";
import "../icon/violet-icon";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        --_media-max-width: var(--violet-media-max-width, 100%);
        --_media-max-height: var(--violet-media-max-height, 300px);
        --_media-font-size: var(--violet-media-font-size, var(--_caption-size, 12px));
        --_media-line-height: var(--violet-media-line-height, var(--_caption-line, 16px));
    }

    .root {
        display: flex;
        flex-direction: column;
        gap: var(--_space-sm);
        max-inline-size: var(--_media-max-width);
    }

    .preview {
        border-radius: var(--_radius-md);
        overflow: hidden;
    }

    .preview img {
        display: block;
        max-inline-size: 100%;
        max-block-size: var(--_media-max-height);
        object-fit: contain;
        border-radius: var(--_radius-md);
    }

    .preview audio {
        display: block;
        inline-size: 100%;
    }

    .preview video {
        display: block;
        max-inline-size: 100%;
        max-block-size: var(--_media-max-height);
        border-radius: var(--_radius-md);
    }

    .file-row {
        display: flex;
        align-items: center;
        gap: var(--_space-sm);
        padding: var(--_space-sm) var(--_space-md);
        border: var(--_card-border-width, 1px) solid var(--_border-subtle);
        border-radius: var(--_radius-md);
        background: var(--_surface-card);
    }

    .file-icon {
        flex-shrink: 0;
        --violet-icon-size: var(--_media-line-height);
    }

    .file-info {
        display: flex;
        flex-direction: column;
        min-inline-size: 0;
    }

    .file-name {
        font-size: var(--_media-font-size);
        line-height: var(--_media-line-height);
        color: var(--_text-primary, #1c1a0d);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .file-type {
        font-size: calc(var(--_media-font-size) * 0.85);
        color: var(--_text-secondary, #414651);
    }

    @media (forced-colors: active) {
        .file-row {
            forced-color-adjust: none;
            border-color: ButtonText;
            background: Canvas;
        }
    }
`;

const template = html<VioletMessageMedia>`
    <div class="root" part="root">
        ${x => x.renderMedia()}
    </div>
`;

/**
 * Violet message media.
 *
 * @summary Renders file/image/audio/video attachments. Maps to AI SDK
 *          FileUIPart and TanStack AI ImagePart/AudioPart/VideoPart.
 * Remote images that fail to load are replaced by the generic file row (filename and type).
 * With `allowed-origins` set, a source that is not same-origin, `data:`, `blob:` or on the list
 * is never requested and the file row is rendered instead. Unset (default), every source loads.
 *
 * @attr {string} allowed-origins - Space-separated origins (for example
 *       `https://cdn.example.com`) remote sources may load from. Empty by default (no policy).
 * @csspart root - The outer container.
 * @csspart preview - The media preview wrapper.
 * @csspart filename - The filename display.
 * @csspart icon - The file type icon.
 */
export class VioletMessageMedia extends FASTElement {
    declare public src: string;
    declare public mediaType: string;
    declare public filename: string;
    declare public alt: string;
    declare public allowedOrigins: string;

    /** The src whose image failed to load; the file row shows while it equals `src`. */
    @observable
    private failedSrc = "";

    public constructor() {
        super();
        this.src = "";
        this.mediaType = "";
        this.filename = "";
        this.alt = "";
        this.allowedOrigins = "";
    }

    public connectedCallback(): void {
        super.connectedCallback();
        registerSystemAttachIcon();
    }

    /**
     * Whether `src` may be requested under the `allowed-origins` policy. Always true when no
     * policy is set. Relative, same-origin, `data:` and `blob:` sources are local and always
     * allowed; any other source needs its origin on the list (unparsable or non-http(s) fails).
     */
    public isSourceAllowed(): boolean {
        const policy = this.allowedOrigins.trim();
        if (!policy) {
            return true;
        }

        let url: URL;
        try {
            url = new URL(this.src, document.baseURI);
        } catch {
            return false;
        }

        if (url.protocol === "data:" || url.protocol === "blob:" || url.origin === location.origin) {
            return true;
        }

        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return false;
        }

        return policy.split(/\s+/).some(entry => {
            try {
                return new URL(entry).origin === url.origin;
            } catch {
                return false;
            }
        });
    }

    public handleImageError(): void {
        this.failedSrc = this.src;
    }

    public renderMedia(): ReturnType<typeof html> {
        if (!this.src) {
            return html``;
        }

        if (!this.isSourceAllowed() || this.failedSrc === this.src) {
            return this.renderFileRow();
        }

        const type = this.mediaType.split("/")[0].toLowerCase();

        if (type === "image") {
            return html<VioletMessageMedia>`
                <div class="preview" part="preview">
                    <img src="${x => x.src}" alt="${x => x.alt || x.filename || "Image"}" loading="lazy" referrerpolicy="no-referrer" @error="${x => x.handleImageError()}" />
                </div>
            `;
        }

        if (type === "audio") {
            return html<VioletMessageMedia>`
                <div class="preview" part="preview">
                    <audio controls preload="metadata">
                        <source src="${x => x.src}" type="${x => x.mediaType}" />
                    </audio>
                </div>
            `;
        }

        if (type === "video") {
            return html<VioletMessageMedia>`
                <div class="preview" part="preview">
                    <video controls preload="metadata">
                        <source src="${x => x.src}" type="${x => x.mediaType}" />
                    </video>
                </div>
            `;
        }

        return this.renderFileRow();
    }

    private renderFileRow(): ReturnType<typeof html> {
        return html<VioletMessageMedia>`
            <div class="file-row">
                <span class="file-icon" part="icon"><violet-icon icon="system/attach" decorative></violet-icon></span>
                <div class="file-info">
                    <span class="file-name" part="filename">${x => x.filename || "File"}</span>
                    <span class="file-type">${x => x.mediaType || "Unknown type"}</span>
                </div>
            </div>
        `;
    }
}

attr(VioletMessageMedia.prototype, "src");
attr({ attribute: "media-type" })(VioletMessageMedia.prototype, "mediaType");
attr(VioletMessageMedia.prototype, "filename");
attr(VioletMessageMedia.prototype, "alt");
attr({ attribute: "allowed-origins" })(VioletMessageMedia.prototype, "allowedOrigins");

if (!customElements.get("violet-message-media")) {
    await FASTElement.define(VioletMessageMedia, {
        name: "violet-message-media",
        template,
        styles,
    });
}
