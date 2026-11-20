"""Disk hygiene commands: report and reclaim worktree build output, caches and aged folders.

Design and progress: docs/features/active/disk-hygiene/ in lushly-dev/afd.
"""

from botcore.commands.disk.report import disk_report

__all__ = ["disk_report"]
