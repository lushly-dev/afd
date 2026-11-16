"""Independent Windows ACL observations for token-store tests."""

import json
import os
import subprocess


def powershell(path, script, *, target=None):
    env = {**os.environ, "BOTCORE_TEST_ACL_PATH": str(path)}
    if target is not None:
        env["BOTCORE_TEST_ACL_TARGET"] = str(target)
    result = subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$ErrorActionPreference='Stop'; " + script,
        ],
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout


def assert_private(path):
    report = json.loads(
        powershell(
            path,
            """
        $acl = Get-Acl -LiteralPath $env:BOTCORE_TEST_ACL_PATH
        $sid = [Security.Principal.SecurityIdentifier]
        $grants = @($acl.Access | Where-Object AccessControlType -eq Allow | ForEach-Object {
            @{sid=$_.IdentityReference.Translate($sid).Value; rights=[int]$_.FileSystemRights}
        })
        @{owner=$acl.GetOwner($sid).Value; protected=$acl.AreAccessRulesProtected;
          user=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
          grants=$grants} | ConvertTo-Json -Depth 4 -Compress
    """,
        )
    )
    trusted = {report["user"], "S-1-5-18", "S-1-5-32-544"}
    assert report["owner"] in trusted
    assert report["protected"]
    assert {grant["sid"] for grant in report["grants"]} == trusted
    assert all(grant["rights"] == 0x1F01FF for grant in report["grants"])


def change_acl(path, operation):
    powershell(
        path,
        """
        $path = $env:BOTCORE_TEST_ACL_PATH
        $directory = [IO.Directory]::Exists($path)
        $sections = [Security.AccessControl.AccessControlSections]::Access
        $acl = if ($directory) { [IO.Directory]::GetAccessControl($path, $sections) }
               else { [IO.File]::GetAccessControl($path, $sections) }
        """
        + operation
        + """
        if ($directory) { [IO.Directory]::SetAccessControl($path, $acl) }
        else { [IO.File]::SetAccessControl($path, $acl) }
        """,
    )


def grant_everyone(path, rights="Read"):
    assert rights in (
        "Read",
        "Delete",
        "Write",
        "WriteAttributes",
        "DeleteSubdirectoriesAndFiles",
        "ChangePermissions",
    )
    change_acl(
        path,
        """
        $sid = [Security.Principal.SecurityIdentifier]::new('S-1-1-0')
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'RIGHTS', 'Allow')
        $acl.AddAccessRule($rule)
    """.replace("RIGHTS", rights),
    )


def junction(path, target):
    powershell(
        path,
        """
        New-Item -ItemType Junction -Path $env:BOTCORE_TEST_ACL_PATH `
            -Target $env:BOTCORE_TEST_ACL_TARGET | Out-Null
    """,
        target=target,
    )


def mount_held_directory(directory, target):
    """Make an empty directory a mount point through a FILE_WRITE_ATTRIBUTES-only handle.

    Such a handle shares read and write, so it succeeds even while the token store holds the
    directory open against deletion and renaming.
    """
    import ctypes as c
    import struct
    from ctypes import wintypes as w

    kernel = c.WinDLL("kernel32", use_last_error=True)
    create = kernel.CreateFileW
    create.restype = w.HANDLE
    create.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, c.c_void_p, w.DWORD, w.DWORD, w.HANDLE]
    control = kernel.DeviceIoControl
    control.restype = w.BOOL
    control.argtypes = [
        w.HANDLE,
        w.DWORD,
        c.c_void_p,
        w.DWORD,
        c.c_void_p,
        w.DWORD,
        c.POINTER(w.DWORD),
        c.c_void_p,
    ]
    # FILE_WRITE_ATTRIBUTES; OPEN_EXISTING; BACKUP_SEMANTICS | OPEN_REPARSE_POINT
    handle = create(str(directory), 0x100, 3, None, 3, 0x02000000 | 0x00200000, None)
    if handle == c.c_void_p(-1).value:
        raise c.WinError(c.get_last_error())
    try:
        name = ("\\??\\" + str(target)).encode("utf-16-le")
        buffer = struct.pack("<HHHH", 0, len(name), len(name) + 2, 0) + name + b"\0\0\0\0"
        request = struct.pack("<IHH", 0xA0000003, len(buffer), 0) + buffer
        returned = w.DWORD()
        # FSCTL_SET_REPARSE_POINT with IO_REPARSE_TAG_MOUNT_POINT
        if not control(handle, 0x000900A4, request, len(request), None, 0, returned, None):
            raise c.WinError(c.get_last_error())
    finally:
        kernel.CloseHandle(handle)
