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
- `artisans/gdocs-importer.js` — entry point for the Google Docs import job. Downloads
  each of a maker's docs, tags parsed rows with their source doc, merges the docs, then
  calls `updateMakerDatabase`.
- `artisans/utils/docs.js` — Google Drive/Docs helpers (`downloadDoc`, `getFile`,
  `getRevisions`). `downloadDoc` returns a native Promise and rejects with `code: 404`
  when a doc has been deleted.
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

Artisan sculpts and colorways have a `source` column (`'gdoc'` for the Google Docs importer, `'scraper'` for `maker-scraper.js`, `'keebdex'`
for rows added through the dashboard) and an
`overridden_fields` string array:

- `updateMakerDatabase(tables, { source })` (default `'gdoc'`) scopes every read and
  write to that source: it only ever sees, matches against, updates, or deletes rows
  with that exact `source`. This is what lets a gdoc sync and a scraper sync for the
  same maker coexist without deleting each other's rows — each is blind to the other's
  data. `maker-scraper.js` passes `source: 'scraper'`; don't let it default to `'gdoc'`.
  Updates only ever patch the fields listed in `GDOC_SYNCABLE_FIELDS` (colorways) /
  `GDOC_SCULPT_SYNCABLE_FIELDS` (sculpts) in `database.js` — never write fields outside
  the allow-lists, regardless of source.
- Within `GDOC_*_SYNCABLE_FIELDS`, a field is skipped if it's present in that row's
  `overridden_fields` (the dashboard has manually locked it).
- `GDOC_ALWAYS_SYNCED_FIELDS` (colorways: `order`, `source_document_id`) and
  `GDOC_SCULPT_ALWAYS_SYNCED_FIELDS` (sculpts: `source_document_id`) are the exception:
  metadata derived from the doc structure, never editable in the dashboard, so they sync
  regardless of `overridden_fields`. Only add a field here if the dashboard can't edit it.
- Array-valued fields (e.g. `stem`) must be compared by sorted content, not reference —
  use `isFieldChanged`, not `!==`.

## Colorway matching rules

1. Match an incoming colorway to a stored row by `colorway_id` first.
2. Otherwise fall back to `name` (rename detection), but only against _orphaned_ stored
   rows — those whose `colorway_id` matches no incoming row. Without this, a brand-new
   colorway (e.g. a cell that just got an image) can steal an unrelated, unchanged row
   that merely shares its name, and get updated instead of inserted.
3. Name candidates are per-name queues (`groupBy`), and each stored row can be claimed
   once. Don't `keyBy` on name: duplicate or empty names collapse into a single row, and
   the others end up deleted.
4. Stored rows that nothing claimed are deleted (or soft-deleted if a user collection
   references them).

## Partial syncs (a maker's doc is missing)

A maker can have several docs (`document_ids`), and one sculpt's colorways can span
docs (`customMerge` in `gdocs-importer.js` offsets `order` when merging).

- Download docs independently. `Promise` in `gdocs-importer.js` is bluebird, so use
  `Promise.resolve(downloadDoc(id)).reflect()` — not `Promise.allSettled` (unreliable on
  bluebird), and not bare `.reflect()` (`downloadDoc` returns a native Promise).
- A 404 on one doc: warn, skip it, sync the rest with `preserve_missing: true`. All docs
  404: disable sync and mark the maker deleted. Any other error: throw, so the outer
  catch logs it and nothing is updated.
- Every parsed sculpt/colorway is tagged with `source_document_id`, and
  `updateMakerDatabase(tables, { preserve_missing, available_document_ids })` receives
  the docs that loaded. With `preserve_missing`, a stored row absent from `tables` is
  kept only if its `source_document_id` isn't in `available_document_ids` (its doc wasn't
  synced), or is null (pre-migration row; can't tell, so keep it). A row absent from a
  doc that _was_ synced is a real deletion.
- `order` is only trustworthy for new colorways in a partial sync (the doc-local value
  ignores the other docs' offset). Existing colorways keep their stored `order`; new ones
  get the sculpt's stored count plus their index. In a full sync the doc's `order` is
  synced normally.
- Use `availableDocumentIds`, not `document_ids`, for anything that touches Drive
  afterwards (e.g. `getFile`), since `document_ids` still contains the deleted docs.
- `maker-scraper.js` sets `preserve_missing` for makers in `PARTIAL_MAKERS` (source data
  is incomplete, not "a doc failed to load") but passes no `available_document_ids`, so
  every missing row is preserved. Scrapers may tag sculpts and colorways with
  `source_document_id` = the page/endpoint URL the row was read from; untagged rows stay
  null and are treated as unknown. Don't pass `available_document_ids` from the scraper
  flow unless that scraper tolerates a single page failing, or missing rows of a tagged
  page would be deleted and `PARTIAL_MAKERS` would stop protecting them.

## Writes are batched, not per-row

`insertRows` chunks at `INSERT_CHUNK_SIZE`, `deleteRows` chunks `.in()` at
`IN_CHUNK_SIZE` — both needed once a maker has more rows than fit in one PostgREST
request. `updateRows` groups the `[id, values]` pairs it's given by identical payload
(`payloadKey`) and issues one `.update(values).in('id', ids)` per distinct payload
(chunked the same way); rows with no real change (`omitBy(isUndefined)` leaves nothing)
are dropped before that, so a no-op sync costs zero requests. This does **not** send
different values per row in one request — Supabase has no bulk-upsert-with-partial-
columns primitive that respects `overridden_fields`, so a batch of colorways that each
changed differently still costs one request per row; only genuinely-identical payloads
(e.g. backfilling one field across everything) collapse. Always build the `[id, values]`
list and call `updateRows` once — don't reach for `Promise.map(..., updateRow, ...)`.

## Migrations

- Name files `YYYYMMDDHHMMSS_description.sql` and write them by hand.
- Add columns nullable. Skip the backfill when the pipeline fills the value on later
  syncs (as with `source_document_id`), and document what null means in a
  `comment on column`.
- If sync code starts writing a column, ship the migration in the same change. Insert
  and update errors are only `console.warn`ed, so a missing column drops data silently.

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
  code (including the `preserve_missing` filters in `updateMakerDatabase`) and is
  O(n²), avoid repeating that pattern in new code and convert it when touching it.
- Comments should explain _why_, not restate the next line. Keep them short and
  describe the general logic, not the history of how a bug was fixed.
- Run `npx eslint <file>` after edits; this repo has no test suite. For sync-logic
  changes, run the job with `--dry-run` and read the logged payloads, or reproduce the
  scenario in a throwaway script.
- Formatting is enforced by Prettier + `lint-staged` on commit (see
  `.husky`/`package.json`); don't hand-format against the project's `.prettierrc`.

## Known caveats

- Sync reads are scoped to `source: 'gdoc'`, so a colorway added via the dashboard and
  the same colorway later appearing in a doc are never reconciled; the doc copy is
  inserted as a new row. This is the likely cause of the rare duplicates seen when both
  are used.
- Deleting a gdoc sculpt deletes colorways by `maker_sculpt_id` with no `source` filter,
  so dashboard-added colorways under it go too.
- In the `preserve_missing` block, the index used to compute a new colorway's `order` is
  global across the flattened sculpts, not per sculpt. Gaps are harmless because only
  relative order matters.
