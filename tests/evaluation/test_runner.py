from __future__ import annotations

import runpy
import sys
import types
from pathlib import Path

import pytest
import yaml

from evaluation.live import LivePolicy
from evaluation.runner import _load_project_resources, _write_live_skillforge_config


def _policy() -> LivePolicy:
    return LivePolicy(
        profile="solution-builder-test",
        host="https://dais-demo.cloud.databricks.com",
        allowed_hosts=("https://dais-demo.cloud.databricks.com",),
        evaluation_prefix="sb_eval_",
    )


def test_live_skillforge_config_pins_profile_and_mlflow(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(
        "SB_EVAL_MLFLOW_EXPERIMENT", "/Shared/sb_eval_skillforge_acceptance"
    )

    path = _write_live_skillforge_config(tmp_path / "skillforge-home", _policy())

    assert yaml.safe_load(path.read_text(encoding="utf-8")) == {
        "databricks": {"profile": "solution-builder-test"},
        "mlflow": {
            "enabled": True,
            "experiment": "/Shared/sb_eval_skillforge_acceptance",
        },
        "llm": {"backend": "fmapi"},
    }


@pytest.mark.parametrize(
    "experiment",
    ["/Shared/skillforge-evals", "sb_eval_relative", "/Shared/production"],
)
def test_live_skillforge_config_rejects_unsafe_experiment(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    experiment: str,
) -> None:
    monkeypatch.setenv("SB_EVAL_MLFLOW_EXPERIMENT", experiment)

    with pytest.raises(ValueError, match="absolute path whose name starts"):
        _write_live_skillforge_config(tmp_path, _policy())


def test_skillforge_runtime_shim_redirects_hard_coded_run_roots(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    skillforge = types.ModuleType("skillforge")
    skillforge_eval = types.ModuleType("skillforge.eval")
    run_isolation = types.ModuleType("skillforge.eval.run_isolation")
    unified_runner = types.ModuleType("skillforge.eval.unified_runner")
    skillforge_databricks = types.ModuleType("skillforge.databricks")
    auth = types.ModuleType("skillforge.databricks.auth")
    run_isolation._SKILLFORGE_RUNS = Path.home() / ".skillforge" / "runs"
    unified_runner._SKILLFORGE_RUNS = Path.home() / ".skillforge" / "runs"
    auth._SF_CONFIG_DIR = Path.home() / ".skillforge"
    auth._SF_CONFIG_PATH = auth._SF_CONFIG_DIR / "config.yaml"
    skillforge_eval.run_isolation = run_isolation
    skillforge_eval.unified_runner = unified_runner
    skillforge_databricks.auth = auth
    monkeypatch.setitem(sys.modules, "skillforge", skillforge)
    monkeypatch.setitem(sys.modules, "skillforge.eval", skillforge_eval)
    monkeypatch.setitem(
        sys.modules, "skillforge.eval.run_isolation", run_isolation
    )
    monkeypatch.setitem(
        sys.modules, "skillforge.eval.unified_runner", unified_runner
    )
    monkeypatch.setitem(sys.modules, "skillforge.databricks", skillforge_databricks)
    monkeypatch.setitem(sys.modules, "skillforge.databricks.auth", auth)
    monkeypatch.setenv("SKILLFORGE_HOME", str(tmp_path / "skillforge-home"))

    shim = (
        Path(__file__).resolve().parents[2]
        / "evaluation"
        / "skillforge_runtime"
        / "sitecustomize.py"
    )
    runpy.run_path(shim)

    expected = tmp_path / "skillforge-home" / "runs"
    assert run_isolation._SKILLFORGE_RUNS == expected
    assert unified_runner._SKILLFORGE_RUNS == expected
    assert auth._SF_CONFIG_DIR == tmp_path / "skillforge-home"
    assert auth._SF_CONFIG_PATH == tmp_path / "skillforge-home" / "config.yaml"


def test_project_resource_scan_excludes_copied_skills(tmp_path: Path) -> None:
    authored = tmp_path / "comparison" / "a" / "with" / "resources.json"
    authored.parent.mkdir(parents=True)
    authored.write_text(
        '{"catalog":"sb_eval_created"}\n', encoding="utf-8"
    )
    reference = (
        tmp_path
        / "comparison"
        / "a"
        / "with"
        / ".claude"
        / "skills"
        / "demo"
        / "references"
        / "resources.json"
    )
    reference.parent.mkdir(parents=True)
    reference.write_text('{"catalog":"production"}\n', encoding="utf-8")

    assert [resource.key for resource in _load_project_resources(tmp_path)] == [
        "catalog:sb_eval_created"
    ]
