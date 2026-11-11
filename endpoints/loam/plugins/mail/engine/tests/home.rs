//! Where the data directory is, and its lock.

#![allow(clippy::expect_used)]

use std::path::Path;

use loam_mail::home::{Home, HomeError};

fn environment<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
    move |name| {
        pairs
            .iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| (*value).to_string())
    }
}

#[test]
fn the_variable_names_the_directory() {
    let home = Home::resolve(environment(&[
        ("LOAM_MAIL_HOME", "/tmp/mail"),
        ("HOME", "/home/p"),
    ]))
    .expect("a directory");
    assert_eq!(home.root(), Path::new("/tmp/mail"));
    assert_eq!(home.database(), Path::new("/tmp/mail/mail.sqlite3"));
    assert_eq!(home.blobs(), Path::new("/tmp/mail/blobs"));
    assert_eq!(home.index(), Path::new("/tmp/mail/index"));
}

#[test]
fn without_the_variable_the_platform_decides() {
    let home = Home::resolve(environment(&[("LOAM_MAIL_HOME", ""), ("HOME", "/home/p")]))
        .expect("a directory");
    let expected = if cfg!(target_os = "macos") {
        "/home/p/Library/Application Support/loam-mail"
    } else if cfg!(windows) {
        return;
    } else {
        "/home/p/.local/share/loam-mail"
    };
    assert_eq!(home.root(), Path::new(expected));
}

#[cfg(all(unix, not(target_os = "macos")))]
#[test]
fn the_data_home_variable_comes_before_the_home_directory() {
    let home = Home::resolve(environment(&[
        ("XDG_DATA_HOME", "/data"),
        ("HOME", "/home/p"),
    ]))
    .expect("a directory");
    assert_eq!(home.root(), Path::new("/data/loam-mail"));
}

#[test]
fn with_nothing_set_the_directory_is_unknown() {
    assert!(matches!(Home::resolve(|_| None), Err(HomeError::Unknown)));
}

#[test]
fn the_lock_is_held_by_one_holder_and_released_when_dropped() {
    let directory = tempfile::tempdir().expect("a temporary directory");
    let home = Home::at(directory.path().join("nested/data"));
    let held = home.lock().expect("the first lock");
    assert!(matches!(home.lock(), Err(HomeError::InUse)));
    drop(held);
    assert!(home.lock().is_ok());
}
