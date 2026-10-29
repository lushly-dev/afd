import { FASTElement, attr, css, html, repeat } from "@lushly-dev/fast-element";

import { violetSurfaceTokenDefaults } from "../theme/violet-token-defaults";

export type VioletSkeletonShape = "rect" | "circle" | "text";
export type VioletSkeletonSize = "sm" | "md" | "lg";

const styles = css`
    ${violetSurfaceTokenDefaults}

    :host {
        display: block;
        --_skeleton-surface: color-mix(in srgb, var(--_surface-subtle) 72%, var(--_surface-card));
        --_skeleton-highlight: color-mix(in srgb, white 68%, var(--_surface-card));
        --_skeleton-radius: var(--_radius-md);
        --_skeleton-block-size: 0.875rem;
        --_skeleton-circle-size: 2rem;
    }

    :host([size="sm"]) {
        --_skeleton-block-size: 0.75rem;
        --_skeleton-circle-size: 1.5rem;
    }

    :host([size="md"]) {
        --_skeleton-block-size: 0.875rem;
        --_skeleton-circle-size: 2rem;
    }

    :host([size="lg"]) {
        --_skeleton-block-size: 1rem;
        --_skeleton-circle-size: 2.75rem;
    }

    .root {
        display: grid;
        gap: var(--_space-stack-2xs);
    }

    .bar {
        position: relative;
        overflow: hidden;
        inline-size: 100%;
        block-size: var(--_skeleton-block-size);
        border-radius: var(--_skeleton-radius);
        background: var(--_skeleton-surface);
    }

    .bar.circle {
        inline-size: var(--_skeleton-circle-size);
        block-size: var(--_skeleton-circle-size);
        border-radius: var(--_radius-round);
    }

    .bar::after {
        content: "";
        position: absolute;
        inset: 0;
        transform: translateX(-100%);
        background: linear-gradient(
            90deg,
            transparent 0%,
            color-mix(in srgb, var(--_skeleton-highlight) 30%, transparent) 40%,
            color-mix(in srgb, var(--_skeleton-highlight) 75%, transparent) 50%,
            color-mix(in srgb, var(--_skeleton-highlight) 30%, transparent) 60%,
            transparent 100%
        );
        animation: shimmer 1.6s linear infinite;
    }

    :host(:not([animated])) .bar::after {
        display: none;
    }

    @keyframes shimmer {
        to {
            transform: translateX(100%);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .bar::after {
            animation-duration: 2.8s;
        }
    }

    @media (forced-colors: active) {
        .bar {
            forced-color-adjust: none;
            background: GrayText;
        }

        .bar::after {
            display: none;
        }
    }
`;

const lineWidths = (x: VioletSkeleton): string[] => {
    const count = Math.max(1, Number(x.lines) || 1);
    return Array.from({ length: count }, (_, index) => {
        if (count === 1) {
            return "100%";
        }

        if (index === count - 1) {
            return "68%";
        }

        if (index % 3 === 1) {
            return "84%";
        }

        return "100%";
    });
};

const template = html<VioletSkeleton>`
    <div class="root" part="root" aria-hidden="true">
        ${repeat(
            x => lineWidths(x),
            html<string, VioletSkeleton>`
                <div
                    class="${(_, c) => `bar${c.parent.shape === "circle" ? " circle" : ""}`}"
                    part="bar"
                    style="inline-size:${x => x};"
                ></div>
            `,
        )}
    </div>
`;

/**
 * Decorative loading placeholder primitive for content that has not resolved yet.
 *
 * @summary Quiet Violet skeleton with rectangle, circle, and multi-line text presets.
 * @csspart root - Wrapper around the placeholder bars.
 * @csspart bar - Individual placeholder bar.
 */
export class VioletSkeleton extends FASTElement {
    declare public shape: VioletSkeletonShape;
    declare public size: VioletSkeletonSize;
    declare public lines: string;
    declare public animated: boolean;

    public constructor() {
        super();
        this.shape = "rect";
        this.size = "md";
        this.lines = "1";
        this.animated = false;
    }

    public connectedCallback(): void {
        super.connectedCallback();
        this.setAttribute("aria-hidden", "true");
    }
}

attr(VioletSkeleton.prototype, "shape");
attr(VioletSkeleton.prototype, "size");
attr(VioletSkeleton.prototype, "lines");
attr({ mode: "boolean" })(VioletSkeleton.prototype, "animated");

if (!customElements.get("violet-skeleton")) {
    await FASTElement.define(VioletSkeleton, {
        name: "violet-skeleton",
        template,
        styles,
    });
}
