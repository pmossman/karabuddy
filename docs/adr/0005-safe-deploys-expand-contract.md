# 0005 — Safe deploys: expand/contract, enforced

**Status:** Accepted (B85, 2026-05-31). Live.

## Context

Prod migrations run in the Vercel **build's prebuild** (`scripts/maybe-migrate.js`,
see [0002](./0002-gated-deploys.md)), and Vercel **migrate-then-promote**s: the
migration applies while the *previous* deployment is still serving, and the new
code only goes live when the build finishes. So for the build window (~1–2 min)
the **old code runs against the new schema**.

That's fine for *additive* changes (a new nullable/defaulted column, a new table)
— old code ignores them. It is **not** fine for destructive ones: B85 dropped
`replays.visibility` and `users.karabast_username` in the *same* deploy that
removed the code referencing them, so during the window the old deployment's
`SELECT`s named columns that no longer existed → 500s. Discipline ("remember to
split the drop") isn't a safeguard; the pipeline should make the unsafe path
hard.

## Decision

Adopt **expand/contract** and enforce it in CI + at deploy:

- **Expand (co-deployed with code):** migrations that ship alongside app changes
  must be **backward-compatible** with the currently-running code — additive only
  (add nullable/defaulted columns, add tables/indexes, add constraints that
  existing rows already satisfy).
- **Contract (separate, later deploy):** anything destructive — `DROP COLUMN`,
  `DROP TABLE`, `RENAME`, `ALTER COLUMN … TYPE`, `SET NOT NULL` on an existing
  column — ships in its **own** deploy, *after* the deploy that removed all code
  referencing the thing has gone live.
- **Guard:** `scripts/validate-migration-safety.js` flags non-additive DDL and
  **fails** unless the migration file carries an explicit
  `-- safe-migration: <reasoning>` annotation acknowledging it's a deliberate
  contract-phase change. It runs in two places (same pattern as the journal
  guard): the unit test `test/unit/migration-safety.test.ts` at PR time, and the
  `maybe-migrate.js` prebuild as the last line of defense before any prod
  migration applies.

The annotation is an escape hatch, not a bypass: it forces the author to write
down *why* it's safe (references already gone in a prior deploy), turning an
accidental same-deploy drop into a deliberate, reviewed one.

## Consequences

- Removing a column/table is now **two deploys**: (1) stop referencing it +
  generate the contract migration but don't drop yet — or simply land the code
  first; (2) the `DROP` migration, annotated `-- safe-migration: contract — …`.
- Additive migrations are unaffected — no annotation needed, the common case
  stays frictionless.
- `0014`/`0015` predate the guard (they're already in prod); they carry a
  `-- safe-migration:` note recording that they were the motivating incident.
- Doesn't cover every hazard (e.g. an additive column the *new* code requires but
  the *old* code's `INSERT` omits — handled by NOT NULL + DEFAULT, which the guard
  already nudges toward). The two-sided extension wire-compat rule is separate and
  still enforced by the contract tests.
- Sibling to [0002](./0002-gated-deploys.md)/[0003](./0003-local-db-isolation.md):
  same theme — make the DB-vs-deploy footguns structurally hard, not just
  documented.
