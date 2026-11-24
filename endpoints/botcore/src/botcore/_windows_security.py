"""Private token-store files on Windows, including Python 3.11/3.12.

Create protected DACLs with the file, then check owner and grants through the opened
handle. Only this process's user, SYSTEM and Administrators may have access. No
optional package or external command is needed. Callers own returned descriptors.
"""

from __future__ import annotations

import ctypes as c
import os
import sys
from contextlib import ExitStack, contextmanager
from functools import cache
from pathlib import Path

if sys.platform != "win32":
    raise ImportError("botcore._windows_security is Windows-only")

import msvcrt
from ctypes import wintypes as w

_kernel = c.WinDLL("kernel32", use_last_error=True)
_advapi = c.WinDLL("advapi32", use_last_error=True)
_P = c.c_void_p
_PP = c.POINTER(_P)


def _api(library, name, result, *arguments):
    function = getattr(library, name)
    function.restype = result
    function.argtypes = arguments
    return function


_close = _api(_kernel, "CloseHandle", w.BOOL, w.HANDLE)
_free = _api(_kernel, "LocalFree", _P, _P)
_process = _api(_kernel, "GetCurrentProcess", w.HANDLE)
_open_token = _api(_advapi, "OpenProcessToken", w.BOOL, w.HANDLE, w.DWORD, _PP)
_token_info = _api(
    _advapi, "GetTokenInformation", w.BOOL, w.HANDLE, c.c_int, _P, w.DWORD, c.POINTER(w.DWORD)
)
_sid_text = _api(_advapi, "ConvertSidToStringSidW", w.BOOL, _P, c.POINTER(w.LPWSTR))
_valid_sid = _api(_advapi, "IsValidSid", w.BOOL, _P)
_sid_length = _api(_advapi, "GetLengthSid", w.DWORD, _P)
_descriptor = _api(
    _advapi,
    "ConvertStringSecurityDescriptorToSecurityDescriptorW",
    w.BOOL,
    w.LPCWSTR,
    w.DWORD,
    _PP,
    c.POINTER(w.DWORD),
)
_security = _api(
    _advapi, "GetSecurityInfo", w.DWORD, w.HANDLE, c.c_int, w.DWORD, _PP, _PP, _PP, _PP, _PP
)
_get_ace = _api(_advapi, "GetAce", w.BOOL, _P, w.DWORD, _PP)
_file_info = _api(_kernel, "GetFileInformationByHandleEx", w.BOOL, w.HANDLE, c.c_int, _P, w.DWORD)


class _Attributes(c.Structure):
    _fields_ = [("length", w.DWORD), ("descriptor", _P), ("inherit", w.BOOL)]


class _Acl(c.Structure):
    _fields_ = [
        ("revision", w.BYTE),
        ("reserved", w.BYTE),
        ("size", w.WORD),
        ("count", w.WORD),
        ("reserved2", w.WORD),
    ]


class _Ace(c.Structure):
    _fields_ = [("kind", w.BYTE), ("flags", w.BYTE), ("size", w.WORD)]


class _FileAttributes(c.Structure):
    _fields_ = [("attributes", w.DWORD), ("tag", w.DWORD)]


_create_file = _api(
    _kernel,
    "CreateFileW",
    w.HANDLE,
    w.LPCWSTR,
    w.DWORD,
    w.DWORD,
    c.POINTER(_Attributes),
    w.DWORD,
    w.DWORD,
    w.HANDLE,
)
_create_directory = _api(_kernel, "CreateDirectoryW", w.BOOL, w.LPCWSTR, c.POINTER(_Attributes))


def _sid(pointer) -> str:
    if not pointer or not _valid_sid(pointer):
        raise PermissionError("A Windows token-store owner or ACL SID is unreadable")
    text = w.LPWSTR()
    if not _sid_text(pointer, c.byref(text)):
        raise c.WinError(c.get_last_error())
    try:
        if text.value is None:
            raise PermissionError("A Windows token-store owner or ACL SID is unreadable")
        return text.value
    finally:
        _free(c.cast(text, _P))


@cache
def _trusted() -> frozenset[str]:
    token = _P()
    if not _open_token(_process(), 0x0008, c.byref(token)):  # TOKEN_QUERY
        raise c.WinError(c.get_last_error())
    try:
        size = w.DWORD()
        _token_info(token, 1, None, 0, c.byref(size))  # TokenUser
        if not size.value:
            raise c.WinError(c.get_last_error())
        buffer = c.create_string_buffer(size.value)
        if not _token_info(token, 1, buffer, size, c.byref(size)):
            raise c.WinError(c.get_last_error())
        user = _sid(c.cast(buffer, _PP)[0])
        return frozenset((user, "S-1-5-18", "S-1-5-32-544"))
    finally:
        _close(token)


@contextmanager
def _attributes(directory: bool):
    inherit = "OICI" if directory else ""
    sddl = "D:P" + "".join(f"(A;{inherit};FA;;;{sid})" for sid in sorted(_trusted()))
    descriptor = _P()
    if not _descriptor(sddl, 1, c.byref(descriptor), None):
        raise c.WinError(c.get_last_error())
    try:
        yield _Attributes(c.sizeof(_Attributes), descriptor, False)
    finally:
        _free(descriptor)


def _check(handle, path: Path, *, directory: bool, ancestor=False) -> None:
    attributes = _FileAttributes()
    if not _file_info(handle, 9, c.byref(attributes), c.sizeof(attributes)):
        raise c.WinError(c.get_last_error())  # FileAttributeTagInfo
    if attributes.attributes & 0x400 or bool(attributes.attributes & 0x10) != directory:
        raise PermissionError(f"{path}: a private token path must not be a reparse point")
    owner, dacl, descriptor = _P(), _P(), _P()
    status = _security(
        handle, 1, 5, c.byref(owner), None, c.byref(dacl), None, c.byref(descriptor)
    )  # SE_FILE_OBJECT; OWNER | DACL
    if status:
        raise c.WinError(status)
    try:
        trusted = _trusted()
        owner_sid = _sid(owner)
        # The volume root anchors the path namespace (and Windows commonly gives
        # it to TrustedInstaller). Every other owner must be one of the three
        # trusted principals, including owners that could change an ancestor ACL.
        root = ancestor and path.parent == path
        if (owner_sid not in trusted and not root) or not dacl:
            raise PermissionError(f"{path}: unsafe Windows token-store owner or ACL")
        for index in range(c.cast(dacl, c.POINTER(_Acl)).contents.count):
            ace = _P()
            if not _get_ace(dacl, index, c.byref(ace)):
                raise c.WinError(c.get_last_error())
            header = c.cast(ace, c.POINTER(_Ace)).contents
            if header.kind == 1:  # A deny ACE grants nothing.
                continue
            if header.kind != 0 or header.size < 16:
                raise PermissionError(f"{path}: unsupported Windows token-store ACL entry")
            if (
                ancestor and header.flags & 0x08
            ):  # INHERIT_ONLY does not grant this ancestor access.
                continue
            if ace.value is None:
                raise PermissionError(f"{path}: unreadable Windows token-store ACL entry")
            sid = ace.value + 8  # ACCESS_ALLOWED_ACE: header, mask, SID
            if not _valid_sid(sid) or _sid_length(sid) > header.size - 8:
                raise PermissionError(f"{path}: unreadable Windows token-store ACL entry")
            # OWNER RIGHTS refers to the object's owner, which was checked above.
            principal = _sid(sid)
            allowed = principal in trusted or (principal == "S-1-3-4" and owner_sid in trusted)
            rights = w.DWORD.from_address(ace.value + 4).value
            # Ancestors may be readable or permit adding a new subdirectory (as
            # C:\ does). Refuse grants that could redirect an existing component:
            # write data/reparse metadata, write attributes (enough to make an empty
            # directory a mount point, even while it is held), delete children/the
            # object, change its ACL or owner, and generic write/all. New components
            # get private ACLs.
            mutation = 0x2 | 0x40 | 0x100 | 0x10000 | 0x40000 | 0x80000 | 0x10000000 | 0x40000000
            if not allowed and (not ancestor or rights & mutation):
                raise PermissionError(
                    f"{path}: Windows token store grants another principal access"
                )
    finally:
        _free(descriptor)


def _open(
    path: Path, access: int, disposition: int, *, directory=False, lock=False, ancestor=False
):
    # Directory-chain and lock handles deny deletion; data handles permit atomic replacement.
    flags = 0x00200000 | (0x02000000 if directory else 0x80)
    with _attributes(directory) as attributes:
        handle = _create_file(
            str(path), access, 3 if lock else 7, c.byref(attributes), disposition, flags, None
        )
        code = c.get_last_error()
    if handle == _P(-1).value:
        raise c.WinError(code)
    try:
        _check(handle, path, directory=directory, ancestor=ancestor)
        return handle
    except BaseException:
        _close(handle)
        raise


@contextmanager
def pinned_directory(path: Path):
    """Check every path component, holding each against redirection until the operation ends."""
    path = Path(os.path.abspath(path))  # Normalize lexical components without following reparses.
    with ExitStack() as held:
        handles = []
        for component in (*reversed(path.parents), path):
            options = {"directory": True, "lock": True, "ancestor": component != path}
            try:
                handle = _open(component, 0x00020000, 3, **options)  # READ_CONTROL, OPEN_EXISTING
            except FileNotFoundError:
                if component.parent == component:
                    raise
                with _attributes(True) as attributes:
                    if not _create_directory(str(component), c.byref(attributes)):
                        code = c.get_last_error()
                        if code != 183:  # A concurrent operator may have made it first.
                            raise c.WinError(code)
                handle = _open(component, 0x00020000, 3, **options)
            held.callback(_close, handle)
            handles.append((handle, component))
        # A held directory cannot be renamed or deleted, but one still empty when it was
        # checked could have been made a mount point before its child was created. Once
        # every component is held, each holds the next, so none can become one now.
        for handle, component in handles:
            attributes = _FileAttributes()
            if not _file_info(handle, 9, c.byref(attributes), c.sizeof(attributes)):
                raise c.WinError(c.get_last_error())  # FileAttributeTagInfo
            if attributes.attributes & 0x400:
                raise PermissionError(
                    f"{component}: a private token path must not be a reparse point"
                )
        yield path


def ensure_directory(path: Path) -> None:
    """Create private directories and check existing components without changing their ACLs."""
    with pinned_directory(path):
        pass


def open_private(path: Path, *, create=False, lock=False) -> int:
    """Open a checked file, optionally creating it with a private DACL atomically."""
    access = 0xC0000000 if create else 0x80000000  # GENERIC_READ | GENERIC_WRITE, or READ
    disposition = (4 if lock else 1) if create else 3  # OPEN_ALWAYS / CREATE_NEW / OPEN_EXISTING
    handle = _open(path, access, disposition, lock=lock)
    try:
        flags = os.O_BINARY | os.O_NOINHERIT | (os.O_RDWR if create else os.O_RDONLY)
        return msvcrt.open_osfhandle(handle, flags)
    except BaseException:
        _close(handle)
        raise
