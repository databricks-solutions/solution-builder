from pathlib import Path

from evaluation.hashing import hash_skill


def test_template_typescript_changes_complete_hash(tmp_path: Path) -> None:
    skill = tmp_path / "skill"
    template = skill / "app" / "template"
    template.mkdir(parents=True)
    (skill / "SKILL.md").write_text("# Skill\n")
    source = template / "main.ts"
    source.write_text("export const value = 1;\n")
    before = hash_skill(skill)
    source.write_text("export const value = 2;\n")
    assert hash_skill(skill) != before


def test_eval_changes_do_not_change_hash(tmp_path: Path) -> None:
    skill = tmp_path / "skill"
    (skill / "eval").mkdir(parents=True)
    (skill / "SKILL.md").write_text("# Skill\n")
    before = hash_skill(skill)
    (skill / "eval" / "ground_truth.yaml").write_text("version: '5'\n")
    assert hash_skill(skill) == before
