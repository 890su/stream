# Stream

@CONTEXT.md
@PLAN.md
@CONCEPT.md

## Claude Rules

- `CONTEXT.md` is the canonical AI entrypoint; `docs/CODEMAP.md` is the table of contents of the code — read it
  before exploring files and update it when files are added, moved or split.
- `PLAN.md` is the active task state.
- `CONCEPT.md` is the source of truth; change it first, then code.
- Update `PLAN.md` after completed work.
- New durable decisions go to `decisions.md`.
- Never edit `ROADMAP.md` unless explicitly asked.
- Respect `.aiignore` and `.rai.yaml`.
- Never read `.library/`, `data/` or secret files unless explicitly instructed and safe.
