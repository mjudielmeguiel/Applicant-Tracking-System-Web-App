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
