"""Native ACL privacy and independent-process lock regressions on Windows."""

import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from botcore import _windows_security
from botcore.host_tokens import TokenStore
from tests.windows_acl import (
    assert_private,
    change_acl,
    grant_everyone,
    junction,
    mount_held_directory,
)

pytestmark = pytest.mark.skipif(os.name != "nt", reason="Native Windows ACL and file-lock behavior")


def test_file_directory_and_lock_are_created_with_private_acls(tmp_path):
    path = tmp_path / "private" / "tokens.json"
    TokenStore(path).issue("lane", "service", "operator")
    for item in (path.parent, path, path.with_name("tokens.json.lock")):
        assert_private(item)


@pytest.mark.parametrize("operation", ["verify", "list", "issue", "revoke"])
def test_unsafe_store_acl_is_refused_even_after_caching(tmp_path, operation):
    store = TokenStore(tmp_path / "tokens.json")
    record, secret = store.issue("lane", "service", "operator")
    assert store.verify(secret) == record
    grant_everyone(store.path)
    call = {
        "verify": lambda: store.verify(secret),
        "list": store.list,
        "issue": lambda: store.issue("lane", "service", "other"),
        "revoke": lambda: store.revoke(record.id),
    }[operation]
    with pytest.raises(PermissionError, match="another principal"):
        call()


@pytest.mark.parametrize(
    "target,rights",
    [("directory", "DeleteSubdirectoriesAndFiles"), ("lock", "Write"), ("file", "Delete")],
)
def test_write_and_delete_grants_are_private_store_violations(tmp_path, target, rights):
    path = tmp_path / "private" / "tokens.json"
    store = TokenStore(path)
    store.issue("lane", "service", "operator")
    unsafe = {"directory": path.parent, "lock": path.with_name("tokens.json.lock"), "file": path}[
        target
    ]
    grant_everyone(unsafe, rights)
    with pytest.raises(PermissionError, match="another principal"):
        store.issue("lane", "service", "other")


def test_unreadable_security_descriptor_refuses_an_operation(tmp_path, monkeypatch):
    from botcore import _windows_security as windows

    store = TokenStore(tmp_path / "tokens.json")
    store.issue("lane", "service", "operator")
    monkeypatch.setattr(windows, "_security", lambda *args: 5)  # ERROR_ACCESS_DENIED
    with pytest.raises(PermissionError):
        store.list()


def test_an_untrusted_owner_is_refused(tmp_path, monkeypatch):
    from botcore import _windows_security as windows

    path = tmp_path / "tokens.json"
    TokenStore(path).issue("lane", "service", "operator")
    # Exercise the owner decision on a real descriptor, without requiring a foreign
    # account or privileges to transfer ownership of the fixture to that account.
    monkeypatch.setattr(windows, "_trusted", lambda: frozenset(("S-1-0-0",)))
    with pytest.raises(PermissionError, match="owner"):
        windows.open_private(path)


def test_owner_rights_resolves_to_the_checked_owner(tmp_path):
    store = TokenStore(tmp_path / "tokens.json")
    record, secret = store.issue("lane", "service", "operator")
    change_acl(
        store.path,
        """
        $acl.SetSecurityDescriptorSddlForm('D:P(A;;FA;;;OW)(A;;FA;;;SY)(A;;FA;;;BA)',
            [Security.AccessControl.AccessControlSections]::Access)
    """,
    )
    assert store.verify(secret) == record


@pytest.mark.parametrize("target", ["directory", "file", "lock"])
def test_reparse_points_cannot_supply_a_token_store_path(tmp_path, target):
    real = tmp_path / "real"
    store = TokenStore(real / "tokens.json")
    store.issue("lane", "service", "operator")
    if target == "directory":
        link = tmp_path / "link"
        link.symlink_to(real, target_is_directory=True)
        other = TokenStore(link / "tokens.json")
    else:
        name = "tokens.json" if target == "file" else "tokens.json.lock"
        original = real / name
        moved = real / f"{name}.saved"
        original.rename(moved)
        original.symlink_to(moved)
        other = store
    with pytest.raises(PermissionError, match="reparse point"):
        other.list()


def test_an_intermediate_junction_cannot_redirect_the_store_away_from_its_lock(tmp_path):
    store = TokenStore(tmp_path / "tree" / "private" / "tokens.json")
    store.issue("lane", "service", "operator")
    alias = tmp_path / "alias"
    junction(alias, tmp_path / "tree")
    with pytest.raises(PermissionError, match="reparse point"):
        TokenStore(alias / "private" / "tokens.json").list()


@pytest.mark.parametrize(
    "rights",
    ["Write", "WriteAttributes", "Delete", "DeleteSubdirectoriesAndFiles", "ChangePermissions"],
)
def test_an_ancestor_cannot_grant_another_principal_path_mutation(tmp_path, rights):
    ancestor = tmp_path / "tree"
    store = TokenStore(ancestor / "private" / "tokens.json")
    store.issue("lane", "service", "operator")
    grant_everyone(ancestor, rights)
    with pytest.raises(PermissionError, match="another principal"):
        store.list()


def test_an_empty_ancestor_mounted_while_held_cannot_redirect_creation(tmp_path, monkeypatch):
    # A held, already-checked ancestor that is still empty can be made a mount point before its
    # child is created; the creation then follows it. The operation must refuse, and leave
    # nothing in the mount's target.
    ancestor = tmp_path / "tree"
    ancestor.mkdir()
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    create = _windows_security._create_directory
    mounted = []

    def racing(name, attributes):
        if not mounted:
            mounted.append(name)
            mount_held_directory(ancestor, elsewhere)
        return create(name, attributes)

    monkeypatch.setattr(_windows_security, "_create_directory", racing)
    with pytest.raises(PermissionError, match="reparse point"):
        TokenStore(ancestor / "new" / "tokens.json").issue("lane", "service", "operator")
    assert mounted
    assert not any(elsewhere.rglob("tokens.json*"))


def test_readable_ancestors_are_allowed_and_remain_pinned_during_an_operation(tmp_path):
    ancestor = tmp_path / "tree"
    store = TokenStore(ancestor / "private" / "tokens.json")
    record, secret = store.issue("lane", "service", "operator")
    grant_everyone(ancestor, "Read")
    assert store.verify(secret) == record
    with store._exclusive(), pytest.raises(PermissionError):
        ancestor.rename(tmp_path / "moved")
    ancestor.rename(tmp_path / "moved")
    (tmp_path / "moved").rename(ancestor)
    assert store.verify(secret) == record


@pytest.mark.parametrize("operation", ["issue", "verify"])
def test_another_process_holding_the_lock_blocks_writers_and_readers(tmp_path, operation):
    path = tmp_path / "tokens.json"
    ready = tmp_path / "locked"
    store = TokenStore(path)
    record, secret = store.issue("lane", "service", "operator")
    script = """
import sys
from pathlib import Path
from botcore.host_tokens import TokenStore
with TokenStore(Path(sys.argv[1]))._exclusive():
    Path(sys.argv[2]).write_text('locked')
    sys.stdin.readline()
"""
    child = subprocess.Popen(
        [sys.executable, "-c", script, str(path), str(ready)],
        text=True,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        deadline = time.monotonic() + 15
        while not ready.exists():
            if child.poll() is not None:
                _, stderr = child.communicate(timeout=5)
                pytest.fail(f"Lock holder exited with {child.returncode}: {stderr}")
            assert time.monotonic() < deadline, "Lock holder did not become ready in 15 seconds"
            time.sleep(0.01)
        with ThreadPoolExecutor(max_workers=1) as pool:
            call = (
                (lambda: store.issue("lane", "service", "other"))
                if operation == "issue"
                else (lambda: store.verify(secret))
            )
            future = pool.submit(call)
            time.sleep(0.1)
            assert not future.done(), "A separate process's lock was bypassed"
            child.stdin.write("release\n")
            child.stdin.flush()
            answer = future.result(timeout=15)
            assert answer if operation == "issue" else answer == record
        _, stderr = child.communicate(timeout=5)
        assert child.returncode == 0, stderr
    finally:
        if child.poll() is None:
            child.kill()
            child.communicate(timeout=5)
