---
"@lushly-dev/violet-elements": patch
---

Fix nine component bugs. Some change behaviour:

- `violet-toast` closes itself after `timeout` whether or not it is `dismissible`; set `timeout="0"` to keep it open.
- `violet-color-picker` restores its starting value on form reset instead of emptying it.
- `violet-date-picker` and `violet-date-range-picker` no longer fire `open-change` when they connect.
- `violet-range-slider` thumbs are named by `label` followed by `label-start` or `label-end`.
- `violet-segmented-control` is invalid when `invalid` is set, even with a value.
- `violet-option` honours `hidden`, and disabling a `violet-option-group` after it renders now disables its options.
- `violet-tooltip` shows again on hover after Escape closes it.
- Progress, badge, alert, toast and snackbar tones have light-theme colours without `installVioletTheme()`.
