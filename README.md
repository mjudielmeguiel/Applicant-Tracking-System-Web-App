# Applicant Tracking System — Admin Account Creation (Supabase)

This package contains your ATS pages with the **Create Admin Account**
modal on `login.html` wired up to Supabase. Opening it, filling the
form, and submitting inserts a real row into the `admins` table of
your `ApplicantDB` project — no Google sign-in, no email-confirmation
step.

## Files

- `login.html` — Sign In page + **working** "Create an admin account" modal
- `dashboard.html` — Dashboard screen (unchanged)
- `mrf-monitoring.html` — MRF Monitoring screen (unchanged)
- `styles.css` — shared styles (unchanged)

## What the signup form does

1. Checks the username/email format, then checks Supabase to make sure
   that username/email isn't already in `admins`.
2. Hashes the password in the browser with bcrypt (`dcodeIO.bcrypt`,
   loaded from CDN) — the plaintext password is never sent to Supabase.
3. If a profile picture was uploaded, converts it to the hex format
   Postgres expects for a `bytea` column.
4. Inserts one row into `admins` with: `FullName`, `Username`, `Email`,
   `PasswordHash`, and `ProfilePicture` (if provided). `RoleID`,
   `Status`, `CreatedAt`, `UpdatedAt` are left out on purpose so the
   table's own defaults apply (`RoleID` 2, `Status` 'Active', `now()`).

The Supabase project URL and publishable (anon) key are already filled
in inside `login.html`.

## One-time setup in Supabase — required

The publishable key only works if your `admins` table allows inserts
from it. In the Supabase dashboard:

1. **Table Editor → `admins` → RLS** — if Row Level Security is
   enabled (it is by default), add a policy that allows `INSERT` for
   the `anon` role, e.g.:
   ```sql
   create policy "Allow anon signup inserts"
   on public.admins
   for insert
   to anon
   with check (true);
   ```
   If RLS is currently *off* for this table, inserts will already work
   without this step — but turning RLS on later will block the form
   until the policy above exists.

2. **`AdminID` auto-increment** — make sure `AdminID` is set as an
   **Identity** column (Table Editor → column → "is Identity") so
   Postgres assigns it automatically. The form doesn't send `AdminID`.

3. **Unique constraints (recommended)** — add unique constraints on
   `Username` and `Email` in the table so two people can't slip past
   the client-side check at the same moment:
   ```sql
   alter table public.admins add constraint admins_username_unique unique ("Username");
   alter table public.admins add constraint admins_email_unique unique ("Email");
   ```

## Security note

This keeps things simple for a school/portfolio project: the anon key
is public by nature (it's meant to be used from the browser), and the
RLS insert policy above is what limits what it can do — restrict it to
`insert` only, don't grant it `select`/`update`/`delete` on `admins`.
For a production system you'd move account creation to a Supabase Edge
Function (or Supabase Auth) so the password hash and any role logic
never run on the client at all.

## Testing it

1. Open `login.html` in a browser (serve it with a local server, e.g.
   `npx serve .`, rather than opening the file directly — Supabase's
   client library needs a real `http://` origin, not `file://`).
2. Click **Sign up**, fill the form, submit.
3. Check **Table Editor → admins** in Supabase — the new row should
   appear with `RoleID` 2 and `Status` "Active".

Note: the Sign In form itself is still a front-end demo and isn't
wired to Supabase yet — that's a separate step from account creation.
