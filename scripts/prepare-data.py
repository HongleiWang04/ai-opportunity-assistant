"""Regenerate the reproducible enriched synthetic fixture and hosted seed."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name("enrich-data.py")),run_name="__main__")
