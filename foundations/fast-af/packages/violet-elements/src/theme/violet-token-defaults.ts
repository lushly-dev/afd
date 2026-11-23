import { css, type ElementStyles } from "@lushly-dev/fast-element";

export const violetActionTokenDefaults: ElementStyles = css`
    :host {
        color: var(--color-text-primary, #181b1a);
        font-family: var(--violet-font-family, var(--font-family-body));

        --_action-primary-background: var(--color-action-primary-background, #181b1a);
        --_action-primary-text: var(--color-action-primary-text, #f4f0ea);
        --_action-primary-hover: var(--color-action-primary-hover, #2e3a33);
        --_action-primary-pressed: var(--color-action-primary-pressed, #252e29);
        --_action-secondary-background: var(--color-action-secondary-background, rgba(24, 27, 26, 0.07));
        --_action-secondary-text: var(--color-action-secondary-text, #181b1a);
        --_action-secondary-border: var(--color-action-secondary-border, transparent);
        --_action-secondary-hover: var(--color-action-secondary-hover, rgba(24, 27, 26, 0.11));
        --_action-secondary-pressed: var(--color-action-secondary-pressed, rgba(24, 27, 26, 0.15));
        --_action-danger-background: var(--color-action-danger-background, #c42a1a);
        --_action-danger-text: var(--color-action-danger-text, #ffffff);
        --_action-danger-hover: var(--color-action-danger-hover, #ad2416);
        --_action-danger-pressed: var(--color-action-danger-pressed, #96200f);
        --_focus-ring: var(--color-focus-ring, #146ba0);
        --_border-subtle: var(--color-border-subtle, rgba(24, 27, 26, 0.10));
        --_text-secondary: var(--color-text-secondary, #48534b);
        --_text-muted: var(--color-text-muted, #5e6460);
        --_radius-md: var(--radius-md, 8px);
        --_shadow-control: var(--shadow-control, 0 0 0 1px rgba(24, 27, 26, 0.05), 0 1px 2px rgba(24, 27, 26, 0.10));
        --_layer-base: var(--z-index-base, 0);
        --_layer-raised: var(--z-index-raised, 1);
        --_layer-sticky: var(--z-index-sticky, 10);
        --_layer-overlay: var(--z-index-overlay, 100);
        --_layer-popover: var(--z-index-popover, 200);
        --_layer-modal: var(--z-index-modal, 300);
        --_layer-toast: var(--z-index-toast, 400);
        --_space-inline-sm: var(--space-inline-sm, 4px);
        --_space-inline-md: var(--space-inline-md, 8px);
        --_type-body-size: var(--type-body-md-size, 14px);
        --_type-body-line: var(--type-body-md-line, 20px);
        --_target-size-compact: var(--size-target-compact, 24px);
        --_target-size-natural: var(--size-target-natural, 32px);
        --_target-size-comfortable: var(--size-target-comfortable, 44px);
        --_auto-target-size: var(--_target-size-natural);
        --_target-size: var(--violet-target-size, var(--_auto-target-size));
        --_control-type-size: var(--violet-control-type-size, var(--_type-body-size));
        /* Rows inside a field (an option, a segment, a page) follow the field's body size when a host sets it. */
        --_control-body-size: var(--violet-control-body-size, var(--_control-type-size));
        --_duration-fast: var(--duration-fast, 120ms);
        --_duration-base: var(--duration-base, 180ms);
        --_easing-standard: var(--easing-standard, cubic-bezier(0.2, 0, 0, 1));
    }

    @media (any-pointer: coarse) {
        :host {
            --_auto-target-size: var(--_target-size-comfortable);
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
        color: var(--color-text-primary, #181b1a);
        font-family: var(--violet-font-family, var(--font-family-body));

        --_surface-page: var(--color-surface-page, #f4f0ea);
        --_surface-subtle: var(--color-surface-subtle, #e9e5de);
        --_text-secondary: var(--color-text-secondary, #48534b);
        --_text-muted: var(--color-text-muted, #5e6460);
        --_border-subtle: var(--color-border-subtle, rgba(24, 27, 26, 0.10));
        --_field-border: var(--color-field-border, #869089);
        /* A read-only field's line: its fill is too light behind the resting border for 3:1. */
        --_field-border-readonly: var(--color-border-strong, #6b7d6e);
        --_field-border-hover: var(--color-field-border-hover, #48534b);
        --_field-border-focus: var(--color-field-border-focus, var(--_focus-ring));
        --_field-background: var(--color-field-background, #ffffff);
        --_field-background-readonly: var(--color-field-background-readonly, var(--_surface-subtle));
        --_field-text: var(--color-field-text, var(--color-text-primary, #181b1a));
        --_field-placeholder: var(--color-field-placeholder, var(--_text-muted));
        --_focus-ring: var(--color-focus-ring, #146ba0);
        --_danger-border: var(--color-field-border-invalid, #c42a1a);
        --_surface-card: var(--color-surface-card, #f8f9f3);
        --_surface-floating: var(--color-surface-floating, #ffffff);
        --_radius-md: var(--radius-md, 8px);
        --_radius-lg: var(--radius-lg, 12px);
        --_shadow-control: var(--shadow-control, 0 0 0 1px rgba(24, 27, 26, 0.05), 0 1px 2px rgba(24, 27, 26, 0.10));
        --_shadow-floating: var(--shadow-floating, 0 0 0 1px rgba(24, 27, 26, 0.08), 0 4px 12px -2px rgba(24, 27, 26, 0.12), 0 18px 40px -8px rgba(24, 27, 26, 0.20));
        /*
         * A field is a well let into the page. Its edge is an inner cut: a hairline border all
         * round and, inside it along the top, the 3:1 rule that finds the control, with a soft
         * shadow under it. The rule is an inset shadow, not a border colour, so it thins to
         * nothing round the corners. The full outline comes back for focus and an invalid value.
         */
        --_shadow-well: var(--shadow-well, inset 0 2px 3px -1px rgba(0, 0, 0, 0.1));
        --_field-shadow: inset 0 1px 0 var(--_field-border), var(--_shadow-well);
        --_field-shadow-hover: inset 0 1px 0 var(--_field-border-hover), var(--_shadow-well);
        --_field-shadow-focus:
            0 0 0 calc(var(--size-focus-ring-width, 2px) - 1px) var(--_field-border-focus),
            0 0 0 4px color-mix(in srgb, var(--_focus-ring) 20%, transparent);
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
        /* One gap above a control, under its label, and one below it, over its supporting text. */
        --_space-field-gap: calc(var(--_space-stack-xs) + var(--_space-stack-2xs));
        --_space-inline-sm: var(--space-inline-sm, 4px);
        --_space-inline-md: var(--space-inline-md, 8px);
        --_type-label-size: var(--type-label-sm-size, 13px);
        --_type-label-line: var(--type-label-sm-line, 16px);
        --_type-label-weight: var(--type-label-sm-weight, 500);
        --_type-body-size: var(--type-body-md-size, 14px);
        --_type-body-line: var(--type-body-md-line, 20px);
        --_type-caption-size: var(--type-caption-xs-size, 12px);
        --_type-caption-line: var(--type-caption-xs-line, 16px);
        --_type-label-size-compact: calc(var(--_type-label-size) - 1px);
        --_type-body-size-compact: calc(var(--_type-body-size) - 1px);
        --_type-caption-size-compact: calc(var(--_type-caption-size) - 1px);
        --_target-size-compact: var(--size-target-compact, 24px);
        --_target-size-natural: var(--size-target-natural, 32px);
        --_target-size-comfortable: var(--size-target-comfortable, 44px);
        --_auto-target-size: var(--_target-size-natural);
        --_target-size: var(--violet-target-size, var(--_auto-target-size));
        --_control-label-size: var(--violet-control-label-size, var(--_type-label-size));
        --_control-body-size: var(--violet-control-body-size, var(--_type-body-size));
        --_control-caption-size: var(--violet-control-caption-size, var(--_type-caption-size));
        --_duration-fast: var(--duration-fast, 120ms);
        --_duration-base: var(--duration-base, 180ms);
        --_easing-standard: var(--easing-standard, cubic-bezier(0.2, 0, 0, 1));
    }

    @media (any-pointer: coarse) {
        :host {
            --_auto-target-size: var(--_target-size-comfortable);
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
        color: var(--color-text-primary, #181b1a);
        font-family: var(--violet-font-family, var(--font-family-body));

        --_surface-card: var(--color-surface-card, #f8f9f3);
        --_surface-subtle: var(--color-surface-subtle, #e9e5de);
        --_surface-hover: var(--color-action-secondary-hover, rgba(24, 27, 26, 0.11));
        --_text-primary: var(--color-text-primary, #181b1a);
        --_text-secondary: var(--color-text-secondary, #48534b);
        --_text-muted: var(--color-text-muted, #5e6460);
        --_border-subtle: var(--color-border-subtle, rgba(24, 27, 26, 0.10));
        --_focus-ring: var(--color-focus-ring, #146ba0);
        --_danger-border: var(--color-state-danger-border, transparent);
        --_success-border: var(--color-state-success-border, transparent);
        --_shadow-control: var(--shadow-control, 0 0 0 1px rgba(24, 27, 26, 0.05), 0 1px 2px rgba(24, 27, 26, 0.10));
        --_shadow-card: var(--shadow-card, 0 0 0 1px rgba(24, 27, 26, 0.06), 0 1px 2px rgba(24, 27, 26, 0.06), 0 4px 10px -2px rgba(24, 27, 26, 0.06));
        --_shadow-floating: var(--shadow-floating, 0 0 0 1px rgba(24, 27, 26, 0.08), 0 4px 12px -2px rgba(24, 27, 26, 0.12), 0 18px 40px -8px rgba(24, 27, 26, 0.20));
        --_layer-base: var(--z-index-base, 0);
        --_layer-raised: var(--z-index-raised, 1);
        --_layer-sticky: var(--z-index-sticky, 10);
        --_layer-overlay: var(--z-index-overlay, 100);
        --_layer-popover: var(--z-index-popover, 200);
        --_layer-modal: var(--z-index-modal, 300);
        --_layer-toast: var(--z-index-toast, 400);
        --_surface-floating: var(--color-surface-floating, #ffffff);
        --_radius-sm: var(--radius-sm, 4px);
        --_radius-md: var(--radius-md, 8px);
        --_radius-lg: var(--radius-lg, 12px);
        --_radius-round: var(--radius-round, 9999px);
        --_space-stack-xs: var(--space-stack-xs, 4px);
        --_space-stack-sm: var(--space-stack-sm, 8px);
        --_space-stack-2xs: calc(var(--_space-stack-xs) / 2);
        --_space-sm: var(--space-inline-md, 8px);
        --_space-md: var(--space-layout-sm, 12px);
        --_space-lg: var(--space-layout-md, 24px);
        --_body-size: var(--type-body-md-size, 14px);
        --_body-line: var(--type-body-md-line, 20px);
        --_type-label-weight: var(--type-label-sm-weight, 500);
        --_caption-size: var(--type-caption-xs-size, 12px);
        --_caption-line: var(--type-caption-xs-line, 16px);
        --_meta-size: var(--type-caption-xs-size, 12px);
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
