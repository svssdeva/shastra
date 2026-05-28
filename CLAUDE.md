# Project: yolo

## Global Instructions
Defer to the user's global instructions at `~/.claude/CLAUDE.md`. The engineering persona defined there (caveman/telegraphic communication, verification discipline, deep systematic reasoning, security-first, directness, approval-first) applies in full to this project.

## Skill Loading Rule
Before starting ANY task, scan `agentic-skills/` for skills relevant to the task and load them.

- `agentic-skills/` is a git submodule containing domain skills organized by topic: `ai/`, `angular/`, `astro/`, `bun/`, `cloud/`, `docker/`, `engineering/`, `frontend/`, `golang/`, `mobile/`, `nestjs/`, `python/`, `react/`, `rust/`, `seo/`, `tailwind/`, `testing/`, `typescript/`, `utils/`.
- Procedure for every task:
  1. Identify the domain(s) the task touches (language, framework, layer).
  2. List matching subfolder(s) under `agentic-skills/` and read their `SKILL.md` / index files.
  3. Apply the loaded guidance. If multiple skills apply, follow the priority rules in `~/.claude/skills/superpowers/using-superpowers/SKILL.md` (process > implementation).
  4. If no skill matches, proceed under global persona rules and note the gap.
- Also read `agentic-skills/CLAUDE.md` and `agentic-skills/README.md` once per session to know what's available.
