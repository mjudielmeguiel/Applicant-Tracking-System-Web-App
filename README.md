# Applicant Tracking System

A static HTML, CSS, and JavaScript recruitment workspace. No build step is required.

## Run locally

With Node.js installed, run:

```sh
npm start
```

Open [the local app](http://127.0.0.1:3000). Sign in through `index.html`, or open [the dashboard](http://127.0.0.1:3000/dashboard.html) to review the workspace directly. The existing Supabase sign-in and administrator signup remain in `index.html`.

## Workspace pages

- **Dashboard** — actual applicant totals, monthly application chart with year selection, recruitment pipeline, recent applicants, and upcoming events/meetings.
- **Applicant Masterlist** — create/edit applicants, contact details, application dates, hiring stages, requirements completion, search/status filters, and CSV export.
- **MRF Monitoring** — create/edit manpower requisitions, position/department/headcount/status tracking, date/search/status filters, CSV export, and the shared applicant pipeline.
- **Users List** — read the existing Supabase `admins` directory, search/filter accounts, and refresh. If Supabase is unreachable or access is denied, the page explains the failure and shows only saved current-session details when available. Unknown account status is labeled explicitly.
- **Calendar** — previous/next month and Today controls, daily and monthly applicant/event/meeting counts, selected-day agenda, and a create/edit event modal. Events support an optional applicant, start/end time, location, and notes. Deleting an event requires confirmation. All seven calendar columns fit on phones; colored dots match the category legend.

Sidebar links work on every workspace page. Collapse preference is shared between pages. Calendar applicant links open the corresponding applicant details.

## Data storage

The project contains an existing Supabase `admins` connection, but no applicant, requisition, or event database schema. These new records are therefore saved with browser `localStorage`:

| Key | Records |
| --- | --- |
| `ats_applicants` | Applicants, status, application date, and requirements completion |
| `ats_mrfs` | Manpower requisitions |
| `ats_events` | Calendar events and meetings |
| `ats_user` | Existing signed-in administrator details |
| `ats_sidebar_collapsed` | Sidebar preference |

Applicant calendar counts use **Date applied**. Linked calendar events do not duplicate applicants in that count. Dates use local calendar days, avoiding UTC date shifts. End times must follow start times on the same day; leaving both blank creates an all-day item.

Browser records are shared across these pages and tabs on the same origin. They remain after refresh, but do not synchronize to other devices or separate browser profiles, and are not isolated by administrator account. Use a consistent local server origin and port. Clearing site data removes these records. Connecting them to a shared backend requires a database schema and access rules; the UI currently labels browser storage explicitly.

The Users List requests only `AdminID`, `FullName`, `Username`, `Email`, `RoleID`, `Status`, and `CreatedAt` from the existing `admins` table. It does not retrieve password hashes or modify accounts. Supabase must permit this directory read through the existing project configuration.

## Browser verification

```sh
npm install
npm test
```

Tests use Playwright with installed Microsoft Edge on Windows. On other systems, install Chromium once with `npx playwright install chromium`. The browser test starts its own temporary local server and uses an isolated browser profile and mocked administrator responses, so it does not change real records or submit to Supabase.

The checks cover sidebar navigation and saved collapse preference, applicant create/edit/filter, dashboard counts/chart, calendar counts and persistence, create/edit/delete events, invalid time ranges, selected-date defaults, applicant links, MRF create/edit/filter, users/offline fallback, and layouts at phone/tablet widths. Screenshots are saved in the ignored `test-results/` directory for visual review.
