# SPDX-License-Identifier: Apache-2.0
import pytest

from asl.config import SkillsConfig
from asl.skills import admitted, discover_skills, library_markdown, stage_skills


def _skill(root, name, tools, *, declared=(), dynamic=False):
    d = root / "skills" / name
    d.mkdir(parents=True)
    front = f"---\nname: {name}\ndescription: Does {name}.\ngap:\n  allowed_tools: [{', '.join(declared)}]\n  exit_conditions:\n    ok: done\n---\n"
    (d / "SKILL.md").write_text(front + "body\n")
    calls = "\n".join(f'    ctx.tool("{t}")' for t in tools) or "    pass"
    if dynamic:
        calls += "\n    ctx.tool(name)"
    (d / "run.py").write_text(f"def run(ctx, name='x'):\n{calls}\n")


def test_only_skills_whose_every_tool_is_allowed_are_offered(tmp_path):
    lib = tmp_path / "lib"
    _skill(lib, "a-runs", ["robot.go_to_pose"], declared=["robot.go_to_pose"])
    _skill(lib, "b-needs-more", ["robot.go_to_pose", "perception.segment"])
    _skill(lib, "c-declares-more", ["robot.go_to_pose"], declared=["perception.segment"])
    _skill(lib, "d-dynamic", ["robot.go_to_pose"], dynamic=True)
    allowed = {"robot.go_to_pose"}
    skills = {s.name: s for s in discover_skills(lib)}
    assert sorted(skills) == ["a-runs", "b-needs-more", "c-declares-more", "d-dynamic"]
    assert [n for n, s in sorted(skills.items()) if admitted(s, allowed)] == ["a-runs"]
    text = library_markdown([skills["a-runs"]], "full")
    assert "| `a-runs` | `robot.go_to_pose` | `ok` | Does a-runs. |" in text and '"skill": "generated"' in text


def test_listed_documents_and_full_copies(tmp_path):
    lib = tmp_path / "lib"
    _skill(lib, "a-runs", ["robot.go_to_pose"])
    ws = tmp_path / "ws"
    ws.mkdir()
    assert [s.name for s in stage_skills(lib, "listed", {"robot.go_to_pose"}, ws)] == ["a-runs"]
    assert (ws / "SKILLS.md").is_file() and not (ws / "skills").exists()
    assert "source is not available" in (ws / "SKILLS.md").read_text()
    stage_skills(lib, "full", {"robot.go_to_pose"}, ws)
    assert (ws / "skills" / "a-runs" / "run.py").is_file()
    stage_skills(lib, "none", {"robot.go_to_pose"}, ws)
    assert not (ws / "SKILLS.md").exists() and not (ws / "skills").exists()


def test_a_mode_needs_a_library():
    with pytest.raises(ValueError, match="needs skills.path"):
        SkillsConfig(mode="full")
