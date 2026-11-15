"""Set up an eval project exactly the way the app sets up a real one.

    app/.venv/bin/python -I scripts/eval-arch-agent/prepare.py <runs-dir> <run-name>

Uses the app's own `copy_skills_to_project` (skills + in-app localization of the
architecture SKILL.md) and `get_system_prompt`, so the eval agent sees what an
in-app agent sees. Run with the venv python directly, never the `python3` shim
inside app/ (it rewrites uv.lock).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from demo_prompt_generator.backend.services import skills_manager  # noqa: E402
from demo_prompt_generator.backend.services.system_prompt import get_system_prompt  # noqa: E402

runs_dir, name = Path(sys.argv[1]).resolve(), sys.argv[2]
skills_manager.PROJECTS_BASE_DIR = str(runs_dir)
project = runs_dir / name
project.mkdir(parents=True, exist_ok=True)
skills_manager.copy_skills_to_project(name)
(project / "system-prompt.txt").write_text(
    get_system_prompt(project_dir=str(project), mode="architecture", project_id=name),
    encoding="utf-8",
)
print(project)
