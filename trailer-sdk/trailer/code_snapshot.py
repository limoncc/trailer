"""Code snapshot: captures git commit info and training script.

Generates a snapshot of the code environment at run start.
"""

import os
import subprocess
import sys
from typing import Dict, Optional


def capture_code_snapshot() -> Dict[str, str]:
    """Capture git metadata and the main training script.

    Returns a dict with keys like:
        git_commit, git_diff, git_branch, training_script, dependencies
    """
    snapshot: Dict[str, str] = {}

    # Git metadata
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            snapshot["git_commit"] = result.stdout.strip()
    except Exception:
        pass

    try:
        result = subprocess.run(
            ["git", "diff", "--stat"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            snapshot["git_diff"] = result.stdout.strip()
    except Exception:
        pass

    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            snapshot["git_branch"] = result.stdout.strip()
    except Exception:
        pass

    # Training script
    main_script = sys.argv[0] if sys.argv else ""
    if main_script and os.path.exists(main_script):
        try:
            with open(main_script, "r") as f:
                snapshot["training_script"] = f.read()
        except Exception:
            pass

    # pip freeze
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "freeze"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            snapshot["dependencies"] = result.stdout.strip()
    except Exception:
        pass

    return snapshot
