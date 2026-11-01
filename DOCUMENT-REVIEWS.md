# Requirement reviews and applicant ID pictures

In Applicant Masterlist, open Details / documents and select the Requirements
part. Every stored file shows its review status, comment, and whether it is a
previous version.

Use Preview to view private PDF, JPG and PNG files. Word files can be downloaded.
Use Review / comment to select Submitted, Accepted or Rejected. A rejection
requires a comment, such as “The SSS image is unclear. Please upload a clearer
image.” Users and admins can review applicants under their own AdminID.
Review decisions are recorded in a private audit history.

Rejecting the latest file reopens that requirement on the applicant's existing
invitation, including when all requirements were previously submitted and the
link had closed. Personal information stays locked. Other submitted categories
stay locked. The applicant sees the rejection comment, previews their uploaded
PDF/images, and uploads a replacement. Previous files are retained for reference;
only the latest file in each category determines completion.

## Automatic image rejection

The upload service decodes JPG/PNG images and runs a resolution-normalized
Laplacian sharpness and contrast check. Blurred, unclear, blank or very small
images are stored privately as Rejected, with an automatic replacement comment.
They do not satisfy the requirement. This happens on the server for both
applicant and staff uploads; a browser-supplied quality score is not trusted.

This check is a heuristic and can misclassify unusual images. Recruiters can
review the original and change the decision when necessary. It does not verify
identity, document authenticity or text content. PDFs and Word documents use
manual review; images embedded inside them are not automatically checked.

Files remain limited to 10 MB. Decoded image dimensions are limited to 16
megapixels. These limits prevent oversized uploads and excessive image decoding.

## 1×1 ID picture

There is a separate 1×1 ID-picture section in staff forms and, when checked on the selected job, the applicant portal. It accepts square JPG/PNG images at least 300×300 pixels. Printed size depends on print settings; the upload checks square aspect ratio and sufficient dimensions.

ID PHOTO is one of eleven available requirement categories. Each job determines which documents its applicants must upload. The private table ats_private.applicant_id_photos stores the document reference, applicant, AdminID, width and height. Image bytes stay in the private applicant-documents bucket. Rejected versions remain visible for review. Requirements uploads must be completed within 1–7 days from first opening; see APPLICANT-INVITATIONS.md for overdue handling and renewal.

The other new tables are ats_private.document_reviews and
ats_private.document_review_history. All three have RLS enabled and direct
client access revoked. Reviews use verified sessions; applicant previews and
uploads use the invitation capability. Signed preview URLs expire after
60 seconds. Cross-AdminID access is denied.

## Deployment and verification

The SQL in supabase-document-reviews.sql and both upload Edge Functions have
already been applied to the connected Supabase project. Push the frontend to
GitHub for Vercel to publish it.

For a new project, apply the existing invitation and requirements migrations
first, then supabase-document-reviews.sql. Deploy both applicant-documents and
application-requirements with their shared modules under supabase/functions.
Secret storage credentials belong only in the Edge Function environment.

Live checks covered automatic blur rejection, visible comments, a regular user's
review and override, rejection without a comment being denied, replacement
uploads, private image/PDF previews, cross-AdminID denial, ID-picture validation,
completion, reopening and completion again. All 14 verification files, records,
temporary sessions and the temporary user were removed afterward.

    npm run build
    npm test
    npm run test:invitations
    npm run test:image-quality

The image-quality test uses Node's TypeScript stripping API (Node 22.13 or newer).
The application still supports the Node version listed in package.json.

Supabase's advisor flags the intentionally callable session-checked review RPC
and the private RLS tables with no client policies. These follow the existing
custom session architecture; the service upload RPC is not executable by anon
or authenticated clients. See the [advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).
