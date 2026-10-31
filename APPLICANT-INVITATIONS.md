# Applicant invitation links

## Admin instructions

1. Open Settings and scroll to Invitation limits.
2. Choose default durations separately for applicant forms, user accounts, and admin handovers.
3. Choose required applicant fields and enter the applicant instructions. Name, position, and source are always required.
4. Save the settings.
5. Open Applicant Masterlist and choose Invite Applicant. Enter a team reference and choose the time limit for this link.
6. Copy the generated link and share it privately with one applicant.

Available limits: 30 minutes; 1 hour; 1 hour 30 minutes; 2 hours; 2 hours 30 minutes; 3 hours; 1 day; 2 days; 3 days; 1 week.
The database rejects unsupported limits and anything above one week.
The applicant default is one hour. Existing user/admin defaults remain 30 minutes until changed.

The applicant link is tied to the issuing AdminID. It creates one application.
Its countdown starts on the first successful opening of the form, not when it is generated.
Reopening the link resumes the same deadline and saved draft, including on another device.
An unopened link remains available until revoked.

Settings apply to new invitations. Each existing invitation keeps its original duration, required fields, choices and instructions.
User and admin account invitation expiry still starts when those links are created.

## Applicant instructions shown in the form

Read the instructions and complete the fields marked required. The deadline and remaining time are visible throughout the form.
Changes save automatically while online. Wait for the draft-saved message before leaving.
Submitting closes the form and removes its token from the browser URL.
The link cannot show or edit the application after submission.

At the deadline the last saved draft is submitted automatically, even if the browser is closed.
Missing required fields, invalid details, or duplicate contact information cause rejection.
A complete valid application goes to For Pooling for recruitment review.
Submitting early with missing information also causes rejection, with a warning before confirmation.

The applicant can enter personal information, contact details, position, source, site and notes.
Internal hiring statuses and stage dates remain controlled by the recruitment team.

## Reviewing results

The Applicant invitations panel shows whether each invitation is unopened, in progress, submitted or revoked.
It shows the deadline, resulting status and validation problems.
Use Saved form to review the actual draft. Use View applicant to open the resulting masterlist record.
Incomplete submissions become rejected masterlist records even when the applicant never entered a name.
Invalid or duplicate contacts are preserved in the private saved form rather than inserted into normalized contact fields or overwriting another applicant.

Only admins with the same AdminID can create links, change invitation settings, review drafts or revoke links.
Unfinished applications can be revoked. Revocation cancels access and automatic submission.

## Server enforcement

Supabase stores invitation tokens as hashes, draft revisions, the fixed deadline and a submission marker.
Public form RPCs accept only the form fields; they cannot change the owner, status or hiring stages.
Concurrent edits from separate tabs are rejected rather than silently overwriting one another.
Each invitation can create only one masterlist record.

The scheduled Supabase job ats-application-invitation-deadlines runs every minute.
An expired link blocks edits immediately. When the browser is closed, the scheduled job normally records the submission on its next run.
The server can submit only data it has received. Offline or otherwise unsaved changes cannot be recovered; this is explained on the applicant form.

Supabase's advisor flags the intentionally callable SECURITY DEFINER RPCs because
the app uses custom session tokens and private invitation capabilities. Each new
admin operation verifies its session and owner; public form operations verify the
invitation token. Private tables deny direct client access through revoked grants
and RLS. See the [Supabase advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

The database changes and scheduled job have already been applied to the connected project.
The migration is saved in supabase-applicant-invitations.sql.
Push the frontend changes to GitHub so Vercel publishes the /apply route and updated settings.

## Verification

The production build, TypeScript check and browser tests cover settings, link creation, draft autosave/resume, single submission, rejection, timeout, offline retry and mobile layout.
Rollback-only database checks cover server deadlines, closed links, duration limits, owner isolation, regular-user restrictions, revocation and protected database fields.
All database test records were rolled back.

    npm run build
    npm test
    npm run test:invitations
