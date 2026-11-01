# Public job-post links

Open Job Openings → Create public post link. Enter a title, maximum applicant count (for example 50 or 100), expiry date/time and your deployed HTTPS website URL. The generated /jobs/<token> URL can be copied into a Facebook or other social-media post. This feature does not publish to social media automatically.

The link lists all currently available job openings for the issuing AdminID, with position, location, address, description and available hiring slots. Fully occupied or manually closed jobs are excluded. Applicants select an opening and submit basic information only: name, email, contact number, current address and Male/Female gender. Personal fields remain optional; supplied contacts are validated and checked for duplicates within the workspace. There is no account creation, email verification or requirements upload on this public form.

The expiry starts at link creation and cannot exceed seven days. A custom date/time can be chosen within that window. The applicant count limit applies to the entire link and is separate from available hiring slots. Applications do not reserve slots. Server-side locking enforces the limit under simultaneous submissions, and an idempotent request reference prevents a network retry from creating a second record.

Once the deadline or application limit is reached, new submissions close. Previously submitted applicants remain in Applicant Masterlist and in the public-post panel's View applicants list. Expiry does not reject or delete applicants. The posting HR user and workspace admins can view that post's applicants or close the link early. Other AdminIDs cannot see the roster, and applicant names/contacts are never exposed on the public job listing.

The private job_posts and job_post_applications tables hold link settings and submission references. Positions and locations still live together in the single public.Job_Opening table. Applicants are saved directly into Applicant_Masterlist with the issuing AdminID, selected JobOpeningID, Social Media source and For Pooling status. RLS and revoked direct client grants protect link settings/submission records; staff operations verify custom sessions, and public operations validate the job-post token.

The SQL in supabase-public-job-posts.sql is already applied to the connected Supabase project. Push the frontend changes to GitHub so Vercel publishes /jobs/[token]. A file:// URL and localhost cannot serve as a social-media link for other people; enter the deployed HTTPS origin when generating a link from a local copy.

Validation: production build, browser tests in tests/job-posts.cjs, rollback-only database checks for expiry/cap/retention/ownership/HR access, and a live two-request concurrency check proving that exactly one submission was accepted at a one-applicant limit. Temporary applicants, link, session and activity from that live check were removed.

    npm run build
    npm test
    npm run test:invitations
    npm run test:job-posts

The generated link opens a separate public job-list page first, without login. The basic-information form appears only after the applicant selects Apply for this opening. Generated results and saved posts include an Open public job list button. The website address is detected automatically on a deployed HTTPS site; local copies default to the project’s existing Vercel domain, with an optional advanced address override. Deploy the /jobs/[token] route before sharing production links.

Applicants can click anywhere on a job card (or focus it and press Enter) to open an accessible application modal. The modal contains Full name, Email address, Contact number and a readonly Job applied field prefilled with the selected position and location. Address and gender fields have been removed from this public modal. Closing the modal returns to the job cards. The existing server deadline, cap, duplicate-contact checks and receipt recovery still apply.
