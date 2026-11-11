# Stream

@CONTEXT.md
@PLAN.md
@CONCEPT.md

## Agent Rules (Codex)

- `CONTEXT.md` is the canonical AI entrypoint. Read it, then `PLAN.md`, then `CONCEPT.md`.
- `CONCEPT.md` is the source of truth. If a task changes the idea, edit `CONCEPT.md` first, then code.
- Take one `PLAN.md` item per session. If the item has a plan in `docs/plans/`, follow it.
- Before writing code, check the item is not blocked by an open decision in `PLAN.md` («Решить»).
- Data contracts live in `contracts/*.schema.json`. Validate inputs and outputs against them in tests.
- New intents, fields, thresholds, templates go to `registry/`, never as `if` branches in pipeline code.
- Events are append-only: no UPDATE/DELETE for events anywhere (code, SQL, API).
- Every behavior change comes with tests. Run tests and type checks before reporting done.
- After completed work: update `PLAN.md` (move item to Done with date and result files);
  durable decisions → `decisions.md` (What / Why / Boundary / Affected).
- Never edit `ROADMAP.md` unless explicitly asked.
- Respect `.aiignore` and `.rai.yaml`. Never read `.library/`, `data/`, or secret files.
- Do not store credentials in project files; use `.env` (gitignored) and `secrets_ref`.
- User-facing text: Russian. Code, identifiers, comments, commit messages: English.
