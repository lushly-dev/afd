"""Botcore uses no afd name that afd has deprecated, so a newer afd does not break it (#2952)."""

import subprocess
import sys

# Fresh interpreter: the modules are imported only once per process.
_IMPORT = """
import warnings
warnings.filterwarnings("error", message=r"afd\..* is deprecated", category=DeprecationWarning)
import botcore.host, botcore.host_surfaces
"""


def test_importing_the_host_warns_of_no_deprecated_afd_name():
    done = subprocess.run(
        [sys.executable, "-c", _IMPORT], capture_output=True, text=True, timeout=120
    )
    assert done.returncode == 0, done.stderr
