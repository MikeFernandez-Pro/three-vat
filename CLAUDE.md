# three-vat

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Workflow (skill routing)

Take work from idea to shipped code along this flow (Matt Pocock's engineering skills). **Proactively route to the right step.** Skills marked ▶ are user-invoked only — recommend the command, don't try to auto-invoke it; the rest can be reached directly when the situation fits.

1. **Shape the idea** — ▶ `/grill-with-docs` (or `/grilling`): pressure-test the design, build the domain model, record ADRs + `CONTEXT.md`.
2. **Prototype** (optional) — `/prototype`: a throwaway to answer a design question before committing.
3. **Write the spec** — ▶ `/to-spec`: turn the conversation into a spec on the issue tracker.
4. **Slice into tickets** — ▶ `/to-tickets`: tracer-bullet tickets with blocking edges. For work too big for one session, ▶ `/wayfinder` first (a map of decision tickets).
5. **Build** — ▶ `/implement`, which drives `/tdd` (red-green-refactor) at each seam and closes with `/code-review` before committing.
6. **As needed** — `/diagnosing-bugs` (hard bugs/regressions), `/research` (primary-source questions), `/codebase-design` + `/domain-modeling` (shaping modules or terminology), `/resolving-merge-conflicts` (merges), `/wizard` (human-only setup steps).

Unsure which fits? ▶ `/ask-matt` routes to the right skill.

This project's config for these skills lives in `docs/agents/`; the domain model in `CONTEXT.md` + `docs/adr/`.
