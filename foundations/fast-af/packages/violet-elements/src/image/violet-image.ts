import { FASTElement, Observable, attr, css, html, observable, when } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

export type VioletImageFit = "cover" | "contain" | "fill";
export type VioletImageRatio = "auto" | "square" | "landscape" | "portrait" | "video";
export type VioletImageShape = "square" | "rounded" | "circle";
export type VioletImageLoading = "eager" | "lazy";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        --_image-background: var(--violet-image-background, var(--_surface-subtle));
        --_image-border: var(--violet-image-border, var(--_border-subtle));
        --_image-radius: var(--violet-image-radius, var(--_radius-lg));
        --_image-fit: var(--violet-image-fit, cover);
        --_image-ratio: auto;
    }

    :host([shape="square"]) {
        --_image-radius: var(--_radius-sm);
    }

    :host([shape="rounded"]) {
        --_image-radius: var(--_radius-lg);
    }

    :host([shape="circle"]) {
        --_image-radius: var(--_radius-round);
    }

    :host([ratio="square"]) {
        --_image-ratio: 1 / 1;
    }

    :host([ratio="landscape"]) {
        --_image-ratio: 4 / 3;
    }

    :host([ratio="portrait"]) {
        --_image-ratio: 3 / 4;
    }

    :host([ratio="video"]) {
        --_image-ratio: 16 / 9;
    }

    :host([fit="contain"]) {
        --_image-fit: contain;
    }

    :host([fit="fill"]) {
        --_image-fit: fill;
    }

    .root {
        position: relative;
        box-sizing: border-box;
        display: block;
        inline-size: 100%;
        overflow: hidden;
        border: 1px solid var(--_image-border);
        border-radius: var(--_image-radius);
        background: var(--_image-background);
        aspect-ratio: var(--_image-ratio);
    }

    .media,
    .fallback {
        inline-size: 100%;
        block-size: 100%;
    }

    .media {
        display: block;
        object-fit: var(--_image-fit);
        background: var(--_image-background);
    }

    .fallback {
        display: grid;
        place-items: center;
        min-block-size: 6rem;
        color: var(--_text-muted);
        font-size: var(--_caption-size);
        line-height: var(--_caption-line);
        text-align: center;
    }

    .fallback slot::slotted(*) {
        margin: 0;
    }

    @media (forced-colors: active) {
        .root {
            forced-color-adjust: none;
            background: Canvas;
            border-color: ButtonText;
        }

        .fallback {
            color: CanvasText;
        }
    }
`;

const template = html<VioletImage>`
    <div
        class="root"
        part="root"
        role="${x => x.accessibleRole}"
        aria-label="${x => x.accessibleLabel}"
        aria-hidden="${x => (x.decorative ? "true" : "false")}"
    >
        ${when(
            x => Boolean(x.src),
            html<VioletImage>`
                <img
                    class="media"
                    part="image"
                    src="${x => x.src}"
                    alt="${x => x.computedAlt}"
                    loading="${x => x.loading}"
                    decoding="async"
                    ?hidden="${x => x.imageFailed}"
                    @error="${x => x.handleImageError()}"
                />
            `,
        )}
        <div class="fallback" part="fallback" ?hidden="${x => x.showImage}">
            <slot name="fallback">Image unavailable</slot>
        </div>
    </div>
`;

/**
 * Native-first Violet image primitive with aspect ratio, fit, and fallback support.
 *
 * @summary Media wrapper around a real image element with decorative handling and a slotted fallback surface.
 * @slot fallback - Optional fallback content shown when there is no image source or the image fails to load.
 * @csspart root - The media frame wrapper.
 * @csspart image - The rendered image element.
 * @csspart fallback - The fallback container.
 */
export class VioletImage extends FASTElement {
    @observable
    declare public imageFailed: boolean;

    declare public src: string;
    declare public alt: string;
    declare public fit: VioletImageFit;
    declare public ratio: VioletImageRatio;
    declare public shape: VioletImageShape;
    declare public loading: VioletImageLoading;
    declare public decorative: boolean;

    public constructor() {
        super();
        this.src = "";
        this.alt = "";
        this.fit = "cover";
        this.ratio = "auto";
        this.shape = "rounded";
        this.loading = "lazy";
        this.decorative = false;
        this.imageFailed = false;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.syncVisualState();
    }

    public srcChanged(): void {
        this.imageFailed = false;
        this.syncVisualState();
    }

    public get showImage(): boolean {
        Observable.trackVolatile();
        return Boolean(this.src) && !this.imageFailed;
    }

    public get computedAlt(): string {
        Observable.trackVolatile();
        return this.decorative ? "" : this.alt;
    }

    public get accessibleRole(): string | null {
        Observable.trackVolatile();
        if (this.decorative || this.showImage) {
            return null;
        }
        return this.alt.trim() ? "img" : null;
    }

    public get accessibleLabel(): string | null {
        Observable.trackVolatile();
        if (this.decorative || this.showImage) {
            return null;
        }
        return this.alt.trim() || null;
    }

    public handleImageError(): void {
        this.imageFailed = true;
        this.syncVisualState();
    }

    private syncVisualState(): void {
        const image = this.shadowRoot?.querySelector<HTMLImageElement>(".media");
        const fallback = this.shadowRoot?.querySelector<HTMLElement>(".fallback");

        if (image) {
            image.hidden = this.imageFailed;
        }

        if (fallback) {
            fallback.hidden = this.showImage;
        }
    }
}

attr(VioletImage.prototype, "src");
attr(VioletImage.prototype, "alt");
attr(VioletImage.prototype, "fit");
attr(VioletImage.prototype, "ratio");
attr(VioletImage.prototype, "shape");
attr(VioletImage.prototype, "loading");
attr({ mode: "boolean" })(VioletImage.prototype, "decorative");

if (!customElements.get("violet-image")) {
    await FASTElement.define(VioletImage, {
        name: "violet-image",
        template,
        styles,
    });
}
