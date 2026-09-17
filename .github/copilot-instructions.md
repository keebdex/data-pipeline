# Copilot instructions for keebdex/data-pipeline

## What this repo is

Node.js ETL scripts that pull artisan/keyset data from Google Docs and maker/vendor
websites, normalize it, and sync it into a Supabase (Postgres) database, plus
Cloudflare Images maintenance jobs. No web server, no build step — scripts are run
directly with `node` (see `package.json` scripts) or scheduled via
`.github/workflows/*.yml`.

## Key files

- `artisans/utils/database.js` — all Supabase read/write logic for artisan sculpts
  and colorways. This is the file to touch for sync-logic changes.
- `artisans/gdocs-importer.js` — entry point for the Google Docs import job.
- `artisans/maker-scraper.js` + `artisans/makers/*.js` — per-maker website scrapers
  that feed the same `updateMakerDatabase` sync logic.
- `artisans/utils/parser.js` — parses the raw Google Docs API response into
  sculpt/colorway objects.
- `utils/index.js` — shared table name constants (`ARTISAN_MAKERS_TABLE`, etc.) and
  the Cloudflare image delivery base URL. Always import table names from here
  instead of hardcoding strings.
- `supabase/migrations/*.sql` — hand-written SQL migrations (no supabase CLI config
  is checked in; migrations are applied directly against the linked project).

## Data ownership model (important — don't break this)

Artisan colorways have a `source` column (`'gdoc'` or `'dashboard'`) and an
`overridden_fields` string array:

- `source: 'gdoc'` rows are the ones this pipeline owns. Updates only ever patch the
  fields listed in `GDOC_SYNCABLE_FIELDS` (colorways) / `GDOC_SCULPT_SYNCABLE_FIELDS`
  (sculpts) in `database.js` — never write fields outside that allow-list.
- Within the allow-list, a field is skipped if it's present in that row's
  `overridden_fields` (the dashboard has manually locked it).
- Matching a Google Docs colorway to a DB row is done by `colorway_id` first, then by
  `name` as a fallback (rename detection). Array-valued fields (e.g. `stem`) must be
  compared by sorted content, not reference — use `isFieldChanged`, not `!==`.

## Dry-run convention

Every write helper in `database.js` (`insertRows`, `updateRow`, `deleteRows`,
`updateMetadata`) checks a module-level `dryRun` flag (set via `setDryRun(true)`) and
logs `[DRY RUN] Would ...` including the payload instead of calling Supabase. Entry
scripts detect `--dry-run` in `process.argv` and call `setDryRun(true)`; they should
also skip side effects they own directly (e.g. image uploads in
`gdocs-importer.js`) rather than relying on the DB layer alone.

## Conventions

- CommonJS (`require`/`module.exports`), not ESM.
- Prefer `lodash` helpers already used in a file (`keyBy`, `isEmpty`, `flatten`,
  `groupBy`, etc.) over hand-rolled loops when they read cleaner.
- Prefer a single Set/Map-based lookup (`keyBy`, `new Set(...)`) over
  `Array.prototype.includes` in loops — the latter is used a few times in older
  code and is O(n²), avoid repeating that pattern in new code.
- Comments should explain _why_, not restate the next line.
- Run `npx eslint <file>` after edits; this repo has no test suite.
- Formatting is enforced by Prettier + `lint-staged` on commit (see
  `.husky`/`package.json`); don't hand-format against the project's `.prettierrc`.
