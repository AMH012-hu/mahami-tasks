# مهامي

Arabic, right-to-left personal task planner. Free static PWA, local-first, no backend, no account required.

## Version 2

- Daily workspace, starred priorities and 7-day completion history.
- Weekly planner with task times, durations and overlap warnings.
- Task board, subtasks and daily/weekly/monthly recurrence.
- Focus timer, undo and saved appearance preference.
- Manual ICS import/export, plus a per-task Google Calendar draft handoff. These are one-time transfers, not account connection or sync.
- Backup JSON export and non-destructive merge import.

Tasks, projects and imported calendar events stay in the browser's IndexedDB (localStorage fallback). No cross-device sync. Export backups regularly. Browser-data removal can delete local work. Installed iOS apps may have storage separate from Safari tabs.

The focus timer is not a guaranteed background alarm. Recurrence creates the next instance when an occurrence is completed. Monthly recurrence clamps to the last valid day. ICS import shows the previous month through the next year; review recurrence and timezone details after importing. ICS export exports dated open tasks as single events, without repeating rules.

The app keeps the original `mahami` database version 1 and existing `kv` task/project keys. Additive fields require no destructive migration. Old service-worker caches are replaced without touching task storage. Existing installations may need close/reopen twice to load the new shell. Never clear site data as an update step.

## Libraries

Calendar file parsing uses ICAL.js, distributed under MPL-2.0. See `ICAL-LICENSE.txt` and the retained header in `ical.min.js`.
