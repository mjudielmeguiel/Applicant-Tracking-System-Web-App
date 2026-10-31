# Account invitations

## Invite a regular user

1. Sign in as an admin and open **Users List**.
2. Choose **Invite User**, optionally prefill the new user's details and profile picture, then create the link.
3. Share the link privately. It expires at the time shown when it is created and works once.
4. The recipient completes registration on their own device. Supabase saves an active USER account linked to the same AdminID; no verification email is sent. After saving, the recipient is sent to the login page.

## Transfer admin access

1. On **Users List**, choose **Transfer Admin Access**.
2. Read the warning. Enter the current admin password, the replacement admin's name, username and email, then tick the acknowledgment.
3. Create the link and share it privately with the intended replacement admin. The link expires according to the limit in Settings, can be used once, and can be revoked from the invitation list before acceptance.
4. The replacement admin accepts on their own device, confirms the handover, chooses a password, and can optionally upload a profile picture.

When accepted, the existing admin login is replaced in place on the same AdminID. Existing sessions for that admin are revoked; open app pages check their session every 15 seconds and when they become visible again. The replacement admin is signed in on the device that accepted the invitation. Users, applicants, MRFs, settings, and other records linked to that AdminID remain there. Other AdminIDs are not affected.

This replaces the admin account; it does not create a second admin account or change a user's role in place. Only create a handover for a person you intend to grant admin access. If the link has not been accepted yet, revoke it in **Account invitations**.

Profile pictures are optional. PNG, JPEG, and WebP files up to 10 MB are resized in the browser and saved to the existing profile picture fields in Supabase. No public image bucket is required.

## Supabase and Vercel

The invitation and handover RPCs have already been applied to the connected Supabase project. The file supabase-admin-handover.sql contains the additive database changes for this handover feature; it requires the existing user-invitation setup.

For the current project, no additional Supabase setup is needed. Push the changed frontend files and supabase-admin-handover.sql to GitHub; the connected Vercel project will deploy the static pages. invite.html must be included in the deployment.
