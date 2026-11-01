# Applicant invitations

Users and admins can create applicant links from Applicant Masterlist → Invite Applicant. Choose a job opening (position + location) or let the applicant choose from currently available jobs. Occupied jobs are hidden. The form displays company logo, name, address and the inviter's name, optional picture, email and contact number.

Personal details are optional. A job opening is required to link the applicant to a position and location. Supplied email addresses and phone numbers are validated and checked for duplicates under the same AdminID. A blank name displays “Applicant (details not provided)” for HR to complete later. Initial submission creates a For Pooling record; personal fields then lock.

Choose a requirements limit of 1–7 days when creating the invitation. Admins can change the default in Settings → Invitation limits. The default is 3 days. The server starts the clock on the first successful opening, including before personal form submission. Reopening or switching devices does not reset it. Deadline and remaining time are displayed.

Only the selected job's checked documents are required. The requirements snapshot is fixed when the personal form is submitted, so later job edits do not change existing applications. Files are private. Rejected documents show comments and permit replacements; other submitted categories stay locked. See DOCUMENT-REVIEWS.md.

At expiry, uploads and form edits close. Existing applicant records show “Requirements overdue — HR review” below their status. Hiring status is unchanged. Unsubmitted drafts remain available for staff review and appear in requirements activity. The server enforces expiry even if the page is closed; the ats-requirements-overdue job runs every minute. There is no automatic rejection or automatic submission of unfinished drafts.

The original inviter or workspace admin can use Renew deadline in Applicant invitations to grant another 1–7 day window on the same link. It starts on the applicant's next opening and retains all saved information/documents. A manual document rejection after completion or expiry also grants a replacement window. Automatic blur rejection does not reset the countdown.

Once all checked requirements have actual files that are not rejected, the link closes. Submission is not a guarantee of document authenticity or acceptance. Staff can review files and request replacements.

Account invitations and admin handovers still expire from creation using their separate settings.

Supabase changes and upload functions are live. Push the frontend to GitHub to publish the changes through Vercel. See JOBS-AND-DEADLINES.md for SQL order and job management.
