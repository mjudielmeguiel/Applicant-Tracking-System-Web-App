# Applicant Tracking System

Next.js App Router and TypeScript entry points for the recruitment workspace.
The original HTML, CSS, and JavaScript filenames are preserved.

## Run locally

Use Node.js 20.9 or newer.

    npm ci
    npm run dev

Open http://localhost:3000. For production:

    npm run build
    npm start

## Project structure

    src/
      app/
        layout.tsx               Shared document and metadata
        page.tsx                 Login
        (workspace)/
          dashboard/page.tsx
          applicants/page.tsx
          job-openings/page.tsx
          users/page.tsx
          calendar/page.tsx
        invite/page.tsx
        api/health/route.ts
        loading.tsx
        error.tsx
        not-found.tsx
      components/
        Screen.tsx               Server-rendered screen markup
        ScreenRuntime.tsx        Existing controller lifecycle
        StatusPage.tsx           Shared system messages
      lib/
        screens.ts               Typed server-only screen access
        generated/               Build-generated screen data
      styles/globals.css
      types/index.ts
    public/
      assets/                    Prepared sound/media assets
      scripts/                   Prepared inline page controllers
      robots.txt
    scripts/prepare-next.cjs
    next.config.ts
    tsconfig.json
    vercel.json

## Migration boundary

Every screen is served by a Next.js App Router route. The shared React screen
component renders existing markup, and its client runtime loads each page's
controllers in order after the document is ready. This preserves the current
Supabase RPCs, forms, uploads, notifications, branding, and AdminID checks.
The existing controllers have not been rewritten into React hooks/components.

Original root HTML/CSS/JS files remain the source for existing screens.
Before development or production builds, prepare-next.cjs extracts screen markup,
separates inline JavaScript, and copies approved browser assets to public.
Generated files are ignored by Git and recreated on Vercel.
After editing original files during development, restart npm run dev or run
npm run prepare:next and refresh the browser.

Navigation uses full document loads because the existing controllers create
document listeners and timers. This gives each screen a fresh lifecycle.
Use ordinary anchors until a feature is migrated to React with explicit cleanup.

Old .html URLs redirect to the corresponding routes. Query strings and invitation
URL fragments are preserved:

| Existing URL | Next route |
| --- | --- |
| /index.html | / |
| /dashboard.html | /dashboard |
| /applicant-masterlist.html | /applicants |
| /mrf-monitoring.html | /job-openings |
| /users.html | /users |
| /calendar.html | /calendar |
| /invite.html | /invite |

## Supabase

The folder migration does not change the database, its records, or its access
rules. Custom sessions continue to be verified by the existing Supabase RPCs.
No service-role credentials are required by the frontend.
See INVITATIONS.md for user invitations and admin handover.
SQL and Markdown files are not copied into public.

## Vercel

Push the project, including package-lock.json, src, scripts, public/robots.txt,
and the Next/Vercel configuration files. vercel.json selects Next.js,
npm ci, npm run build, and the .next output directory.
Keep the Vercel Root Directory at the repository root.
Generated public assets do not need to be committed.

## Checks

    npm run build
    npm test
    npm run test:invitations

The build checks TypeScript and generates every route. The browser smoke test
starts a production Next server on port 3117, mocks remote services, and
checks page initialization, old URL redirects, invitation fragments, login query
parameters, the admin handover modal and the 404 page. It does not write to
live Supabase. Windows uses installed Microsoft Edge; elsewhere install
Chromium with npx playwright install chromium.

The original static server remains available as npm run start:legacy.
Its older smoke suite is retained as npm run test:legacy and is separate from
the Next.js checks.

Applicant invitation forms use the React route /apply. See APPLICANT-INVITATIONS.md
for required fields, autosaved application information and requirements uploads.

DOCUMENT-REVIEWS.md describes the current requirements-only workflow: per-file
reviews, replacement comments, private previews, automatic JPG/PNG quality
rejection and the applicant's separate 1×1 ID-picture upload.

## Current recruitment workflow

Job Openings replaces MRF Monitoring. The MRF database table/data have been removed as requested. Job cards combine position, location, live slots, description and configurable requirements. Applicant invitation details are optional; deadlines are 1–7 days from first opening, with overdue requirements held for HR review. See JOBS-AND-DEADLINES.md and APPLICANT-INVITATIONS.md.

Public social-media job-post links: Job Openings → Create public post link. Set an applicant limit and expiry up to seven days. Applicants browse current vacancies and submit basic information. HR can view the linked applicants after expiry. See PUBLIC-JOB-POSTS.md.

## Phone and tablet layout

At widths up to 1024px, workspace pages keep a 72px navigation rail visible. Use the sidebar toggle to open full company/navigation labels over the page; tap outside or press Escape to close it. Tablet landscape and desktop retain the wider sidebar when space permits. Phone/tablet controls use touch-friendly targets and 16px form text. Action groups wrap within the content area, wide tables scroll independently, and native dialogs fit the viewport. Android keyboard behavior uses the resizes-content viewport setting. Responsive checks cover 360px phone, 800px tablet portrait and 1280px landscape widths, navigation with a stored collapsed preference, backdrop/Escape behavior, action bounds and modal sizing.

Applicant status dates are now shown in Recruitment & schedule for the selected status only. The separate Stage dates tab has been removed. For Orientation shows Orientation date, Hired shows Date hired, and other supported dated stages follow the same rule. Hidden earlier dates remain saved and visible in Applicant flow/history. Appointment time, attendance and optional admin follow-up settings remain available in an expandable section. Requirements completion date is in Requirements & documents.

Submission Date is automatic and read-only. Supabase stamps new user-created applicants with the Asia/Manila submission day and preserves it on later edits. Imported dates remain historical, and existing blank submission dates are filled from the original application date when updated. Apply supabase-automatic-submission-date.sql after the current migrations for another database; it is already active on the connected project. Interview/orientation/exam/job-offer dates remain manually scheduled. Date-only and timed appointments appear on Calendar, with duplicate entries suppressed, and View this date in Calendar opens the selected day after saving. Shared status colors cover the masterlist, status cards, selectors, dashboard pipeline and calendar agenda.

Applicant form cleanup: Additional notes (Notes), Original worksheet (ExcelSheet), Original worksheet row (ExcelRow), Workbook/reference number (No.), Location and accounts (LOCATION AND ACCOUNTS), and Application timestamp (DateApplied) were removed from the active applicant schema and form. Date remains the canonical application day. Gender is a Male/Female dropdown. One Job/site dropdown displays available slots and supports searching by site or position; the server derives position/site from the selected Job_Opening and validates ownership and availability. Existing saved assignments remain editable, including occupied historical assignments. View documents opens Requirements & documents directly, with private PDF/image previews and file downloads. The retired MRF context request and its misleading setup notice have been removed. Apply supabase-simplify-applicant-fields.sql then supabase-applicant-cleanup-compatibility.sql after earlier migrations on another project. These changes are already applied to the connected project; retired fields from older browser tabs are discarded during rollout rather than stored.

Applicant status filtering uses the clickable count cards only; the list filter dropdown has been removed. Cards use neutral styling with a selected outline. Status colors remain on the applicant-list badges, while the edit-form Status selector is neutral. Card filtering combines with search; All applicants clears the status selection, and Clear filters clears both search and status.

Applicant requirement statuses use dropdowns; document uploads are optional for staff entry. Pending and Rejected are incomplete; Submitted, Verified, Accepted and Not required count toward the ten-item requirements progress. The database automatically records REQUIREMENTS COMPLETION DATE when all ten are complete and clears it if one becomes incomplete. Apply supabase-automatic-requirement-completion.sql after existing setup migrations (already applied to the connected project). Existing requirement reference text is retained as a selectable legacy value.
