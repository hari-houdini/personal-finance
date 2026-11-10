"""Single place for project paths."""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATEMENTS_DIR = PROJECT_ROOT / "statements"   # read-only source of truth
REPORTS_DIR = PROJECT_ROOT / "reports"         # derived, gitignored
CONFIG_DIR = PROJECT_ROOT / "config"
LOCAL_CONFIG_DIR = CONFIG_DIR / "local"        # personal, gitignored
WEB_DIR = PROJECT_ROOT / "web"
