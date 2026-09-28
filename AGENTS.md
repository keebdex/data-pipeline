# AGENTS.md

Guidance for AI coding agents working in keebdex/data-pipeline.

Project context, the data ownership model, colorway matching rules, partial-sync
behaviour and code conventions live in `.github/copilot-instructions.md`. Read it
first; it is the source of truth, so don't copy its content here.

## Working agreements

- **Verify before finishing.** Run `npx eslint <changed files>`. There is no test suite,
  so for sync-logic changes either run the job with `--dry-run` and check the
  `[DRY RUN]` output, or reproduce the scenario in a throwaway script.
- **Never test against the real database.** Don't run an import or scraper without
  `--dry-run` against the linked Supabase project just to check a change.
- **Schema changes ship with a migration.** If code writes a new column, add a
  `supabase/migrations/YYYYMMDDHHMMSS_*.sql` file in the same change and call it out in
  your summary. Write errors are only logged, so a missing column fails silently.
- **Stay inside the allow-lists.** Don't widen `GDOC_SYNCABLE_FIELDS`,
  `GDOC_SCULPT_SYNCABLE_FIELDS` or the `*_ALWAYS_SYNCED_FIELDS` lists without saying why.
- **Keep comments short** and about the general logic, not the history of a fix.
- **Commit messages** use `type(scope): summary` with a body explaining why.
