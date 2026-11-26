//! The person page's style sheet (#1490): served as it is in the binary, under the same headers
//! as every page, with AFD's theme in it and nothing that would need the CSP widened.

use http_body_util::BodyExt;

use super::{CSP, PersonPage, STYLE};

#[tokio::test]
async fn the_sheet_is_served_whole_under_the_page_headers() {
    let response = PersonPage::style();
    assert_eq!(response.status(), 200);
    let headers = response.headers();
    assert_eq!(headers["content-type"], "text/css; charset=utf-8");
    assert_eq!(headers["cache-control"], "no-store");
    assert_eq!(headers["x-content-type-options"], "nosniff");
    // The policy is the trust model's, unchanged by the restyle.
    assert_eq!(
        CSP,
        "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    );
    assert_eq!(headers["content-security-policy"], CSP);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(body, STYLE.as_bytes());
}

#[test]
fn the_sheet_carries_the_theme_and_every_state() {
    for needle in [
        // The generated presets, from the export.
        "/* GENERATED from violet-theme.export.json",
        "/* END GENERATED */",
        ":root {",
        "@media (prefers-color-scheme: dark) {",
        "@media (prefers-contrast: more) {",
        "--violet-color-surface-page:",
        "--violet-font-family-body: \"Inter\"",
        "--violet-font-family-heading: \"Space Grotesk\"",
        "--violet-font-family-mono: \"IBM Plex Mono\"",
        // The rules that use them.
        "font-family: var(--violet-font-family-body)",
        "dl,\npre,\ntable {",
        ".notice {",
        "var(--violet-color-state-warning-background)",
        ".actions {",
        "button[value=\"approve\"] {",
        "var(--violet-color-action-primary-background)",
        "var(--violet-color-action-secondary-background)",
        "button:focus-visible {",
        "ul.items input[type=\"checkbox\"]:checked {",
        "clip-path: polygon(",
        "@media (forced-colors: active) {",
        "@media (prefers-reduced-motion: reduce) {",
    ] {
        assert!(STYLE.contains(needle), "the sheet lacks {needle:?}");
    }
}

#[test]
fn the_sheet_needs_nothing_the_policy_forbids() {
    // `default-src 'none'`: no font, image or import may be fetched, and no data: URI drawn. CSS
    // keywords are case-insensitive, so the sheet is read in lowercase.
    let sheet = STYLE.to_ascii_lowercase();
    for forbidden in [
        "url(",
        "@import",
        "@font-face",
        "data:",
        "expression(",
        "behavior:",
    ] {
        assert!(!sheet.contains(forbidden), "the sheet holds {forbidden:?}");
    }
    // The old literal colours are gone: every colour comes from the theme's properties.
    for old in ["#1b1b1f", "#fbfbfd", "system-ui,sans-serif"] {
        assert!(!STYLE.contains(old), "the sheet still holds {old:?}");
    }
}
