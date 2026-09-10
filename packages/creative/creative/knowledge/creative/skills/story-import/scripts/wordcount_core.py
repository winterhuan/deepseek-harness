#!/usr/bin/env python3
"""Expose the shared novel script through its skill-local CLI and imports."""

import runpy
from pathlib import Path

globals().update(runpy.run_path(
    str(Path(__file__).resolve().parents[3] / "scripts" / "wordcount_core.py"),
    run_name=__name__,
))
