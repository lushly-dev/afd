import { css, type ElementStyles } from "@lushly-dev/fast-element";

export const violetActionTokenDefaults: ElementStyles = css`
    :host {
        color: var(--color-text-primary, #18181b);
        font-family: "Montserrat", "Segoe UI", sans-serif;

        --_action-primary-background: var(--color-action-primary-background, #c84f3b);
        --_action-primary-text: var(--color-action-primary-text, #ffffff);
        --_action-primary-hover: var(--color-action-primary-hover, #bd4a37);
        --_action-primary-pressed: var(--color-action-primary-pressed, #b54633);
        --_action-secondary-background: var(--color-action-secondary-background, #f0efe6);
        --_action-secondary-text: var(--color-action-secondary-text, #18181b);
        --_action-secondary-border: var(--color-action-secondary-border, rgba(28, 26, 13, 0.18));
        --_action-secondary-hover: var(--color-action-secondary-hover, #e7e4d8);
        --_action-secondary-pressed: var(--color-action-secondary-pressed, #ddd9cb);
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_border-subtle: var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        --_text-secondary: var(--color-text-secondary, #414651);
        --_radius-md: var(--radius-md, 4px);
        --_shadow-control: var(--shadow-control, 0 1px 1px rgba(28, 26, 13, 0.09), 0 2px 5px rgba(28, 26, 13, 0.04));
        --_layer-base: var(--z-index-base, 0);
        --_layer-raised: var(--z-index-raised, 1);
        --_layer-sticky: var(--z-index-sticky, 10);
        --_layer-overlay: var(--z-index-overlay, 100);
        --_layer-popover: var(--z-index-popover, 200);
        --_layer-modal: var(--z-index-modal, 300);
        --_layer-toast: var(--z-index-toast, 400);
        --_space-inline-sm: var(--space-inline-sm, 4px);
        --_type-body-size: var(--type-body-md-size, 14px);
        --_type-body-size-compact: calc(var(--_type-body-size) - 1px);
        --_target-size-compact: var(--size-target-compact, 24px);
        --_target-size-natural: var(--size-target-natural, 32px);
        --_target-size-comfortable: var(--size-target-comfortable, 44px);
        --_auto-target-size: var(--_target-size-natural);
        --_auto-control-type-size: var(--_type-body-size);
        --_target-size: var(--violet-target-size, var(--_auto-target-size));
        --_control-type-size: var(--violet-control-type-size, var(--_auto-control-type-size));
        --_duration-fast: var(--duration-fast, 120ms);
        --_duration-base: var(--duration-base, 180ms);
        --_easing-standard: var(--easing-standard, cubic-bezier(0.2, 0, 0, 1));
    }

    @media (pointer: fine) {
        :host {
            --_auto-target-size: var(--_target-size-compact);
            --_auto-control-type-size: var(--_type-body-size-compact);
        }
    }

    @media (any-pointer: coarse) {
        :host {
            --_auto-target-size: var(--_target-size-comfortable);
            --_auto-control-type-size: var(--_type-body-size);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        :host {
            --_duration-fast: 0.01ms;
            --_duration-base: 0.01ms;
        }
    }
`;

export const violetFieldTokenDefaults: ElementStyles = css`
    :host {
        color: var(--color-text-primary, #18181b);
        font-family: "Montserrat", "Segoe UI", sans-serif;

        --_surface-page: var(--color-surface-page, #fffefa);
        --_surface-subtle: var(--color-surface-subtle, #f0efe6);
        --_text-secondary: var(--color-text-secondary, #414651);
        --_text-muted: var(--color-text-muted, #6b7280);
        --_border-subtle: var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_danger-border: var(--color-field-border-invalid, rgba(220, 38, 38, 0.34));
        --_surface-card: var(--color-surface-card, #faf9f5);
        --_radius-md: var(--radius-md, 4px);
        --_shadow-control: var(--shadow-control, 0 1px 1px rgba(28, 26, 13, 0.09), 0 2px 5px rgba(28, 26, 13, 0.04));
        --_shadow-floating: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
        --_layer-base: var(--z-index-base, 0);
        --_layer-raised: var(--z-index-raised, 1);
        --_layer-sticky: var(--z-index-sticky, 10);
        --_layer-overlay: var(--z-index-overlay, 100);
        --_layer-popover: var(--z-index-popover, 200);
        --_layer-modal: var(--z-index-modal, 300);
        --_layer-toast: var(--z-index-toast, 400);
        --_space-stack-xs: var(--space-stack-xs, 4px);
        --_space-stack-sm: var(--space-stack-sm, 8px);
        --_space-stack-2xs: calc(var(--_space-stack-xs) / 2);
        --_space-inline-sm: var(--space-inline-sm, 4px);
        --_space-inline-md: var(--space-inline-md, 8px);
        --_type-label-size: var(--type-label-sm-size, 12px);
        --_type-label-line: var(--type-label-sm-line, 16px);
        --_type-label-weight: var(--type-label-sm-weight, 500);
        --_type-body-size: var(--type-body-md-size, 14px);
        --_type-body-line: var(--type-body-md-line, 20px);
        --_type-caption-size: var(--type-caption-xs-size, 11px);
        --_type-caption-line: var(--type-caption-xs-line, 14px);
        --_type-label-size-compact: calc(var(--_type-label-size) - 1px);
        --_type-body-size-compact: calc(var(--_type-body-size) - 1px);
        --_type-caption-size-compact: calc(var(--_type-caption-size) - 1px);
        --_target-size-compact: var(--size-target-compact, 24px);
        --_target-size-natural: var(--size-target-natural, 32px);
        --_target-size-comfortable: var(--size-target-comfortable, 44px);
        --_auto-target-size: var(--_target-size-natural);
        --_auto-control-label-size: var(--_type-label-size);
        --_auto-control-body-size: var(--_type-body-size);
        --_auto-control-caption-size: var(--_type-caption-size);
        --_target-size: var(--violet-target-size, var(--_auto-target-size));
        --_control-label-size: var(--violet-control-label-size, var(--_auto-control-label-size));
        --_control-body-size: var(--violet-control-body-size, var(--_auto-control-body-size));
        --_control-caption-size: var(--violet-control-caption-size, var(--_auto-control-caption-size));
        --_duration-fast: var(--duration-fast, 120ms);
        --_duration-base: var(--duration-base, 180ms);
        --_easing-standard: var(--easing-standard, cubic-bezier(0.2, 0, 0, 1));
    }

    @media (pointer: fine) {
        :host {
            --_auto-target-size: var(--_target-size-compact);
            --_auto-control-label-size: var(--_type-label-size-compact);
            --_auto-control-body-size: var(--_type-body-size-compact);
            --_auto-control-caption-size: var(--_type-caption-size-compact);
        }
    }

    @media (any-pointer: coarse) {
        :host {
            --_auto-target-size: var(--_target-size-comfortable);
            --_auto-control-label-size: var(--_type-label-size);
            --_auto-control-body-size: var(--_type-body-size);
            --_auto-control-caption-size: var(--_type-caption-size);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        :host {
            --_duration-fast: 0.01ms;
            --_duration-base: 0.01ms;
        }
    }
`;

export const violetSurfaceTokenDefaults: ElementStyles = css`
    :host {
        color: var(--color-text-primary, #18181b);
        font-family: "Montserrat", "Segoe UI", sans-serif;

        --_surface-card: var(--color-surface-card, #faf9f5);
        --_surface-subtle: var(--color-surface-subtle, #f0efe6);
        --_surface-hover: var(--color-action-secondary-hover, #e7e4d8);
        --_text-primary: var(--color-text-primary, #18181b);
        --_text-secondary: var(--color-text-secondary, #414651);
        --_text-muted: var(--color-text-muted, #6b7280);
        --_border-subtle: var(--color-border-subtle, rgba(28, 26, 13, 0.10));
        --_focus-ring: var(--color-focus-ring, rgba(24, 24, 27, 0.5));
        --_danger-border: var(--color-state-danger-border, rgba(220, 38, 38, 0.34));
        --_success-border: var(--color-state-success-border, rgba(22, 101, 52, 0.28));
        --_shadow-card: var(--shadow-card, 0 1px 2px rgba(28, 26, 13, 0.15), 0 5px 10px rgba(28, 26, 13, 0.06));
        --_shadow-floating: var(--shadow-floating, 0 2px 5px rgba(28, 26, 13, 0.22), 0 18px 34px rgba(28, 26, 13, 0.08));
        --_layer-base: var(--z-index-base, 0);
        --_layer-raised: var(--z-index-raised, 1);
        --_layer-sticky: var(--z-index-sticky, 10);
        --_layer-overlay: var(--z-index-overlay, 100);
        --_layer-popover: var(--z-index-popover, 200);
        --_layer-modal: var(--z-index-modal, 300);
        --_layer-toast: var(--z-index-toast, 400);
        --_surface-floating: var(--color-surface-floating, #f0efe6);
        --_radius-sm: var(--radius-sm, 2px);
        --_radius-md: var(--radius-md, 4px);
        --_radius-lg: var(--radius-lg, 6px);
        --_radius-round: var(--radius-round, 9999px);
        --_space-stack-xs: var(--space-stack-xs, 4px);
        --_space-stack-sm: var(--space-stack-sm, 8px);
        --_space-stack-2xs: calc(var(--_space-stack-xs) / 2);
        --_space-sm: var(--space-inline-md, 8px);
        --_space-md: var(--space-layout-sm, 12px);
        --_space-lg: var(--space-layout-md, 24px);
        --_body-size: var(--type-body-md-size, 14px);
        --_body-line: var(--type-body-md-line, 20px);
        --_caption-size: var(--type-caption-xs-size, 11px);
        --_caption-line: var(--type-caption-xs-line, 14px);
        --_meta-size: var(--type-caption-xs-size, 11px);
        --_duration-fast: var(--duration-fast, 120ms);
        --_duration-base: var(--duration-base, 180ms);
        --_easing-standard: var(--easing-standard, cubic-bezier(0.2, 0, 0, 1));
    }
    @media (prefers-reduced-motion: reduce) {
        :host {
            --_duration-fast: 0.01ms;
            --_duration-base: 0.01ms;
        }
    }
`;
