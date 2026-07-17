from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from evaluation.live import LivePolicy
from evaluation.runner import _write_live_skillforge_config


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
