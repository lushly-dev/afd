"""Independent Windows ACL observations for token-store tests."""

import json
import os
import subprocess


def powershell(path, script):
    env = {**os.environ, "BOTCORE_TEST_ACL_PATH": str(path)}
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
    assert rights in ("Read", "Delete", "Write", "DeleteSubdirectoriesAndFiles")
    change_acl(
        path,
        """
        $sid = [Security.Principal.SecurityIdentifier]::new('S-1-1-0')
        $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'RIGHTS', 'Allow')
        $acl.AddAccessRule($rule)
    """.replace("RIGHTS", rights),
    )
