(async function () {
  'use strict';
  const A = window.ATS;
  const session = await A.ready;
  if (!session || !A.isAdmin(session)) return;

  const actions = document.querySelector('.topbar .page-actions');
  if (!actions) return;
  let busy = false;
  const $ = (dialog, id) => (typeof dialog === 'string' ? document.getElementById(dialog) : dialog).querySelector('#' + id);

  const inviteUser = document.createElement('button');
  inviteUser.id = 'openInviteUser';
  inviteUser.type = 'button';
  inviteUser.className = 'btn-sm ghost';
  inviteUser.textContent = 'Invite User';
  actions.prepend(inviteUser);

  const inviteAdmin = document.createElement('button');
  inviteAdmin.id = 'openAdminHandover';
  inviteAdmin.type = 'button';
  inviteAdmin.className = 'btn-sm ghost';
  inviteAdmin.textContent = 'Transfer Admin Access';
  actions.prepend(inviteAdmin);

  const panel = document.createElement('section');
  panel.className = 'card panel invitation-panel';
  panel.innerHTML = '<div class="section-heading"><div><h2>Account invitations</h2><p class="section-subtitle">Single-use links expire according to the limit in Settings.</p></div><button class="btn-sm ghost" type="button" id="refreshInvitations">Refresh invitations</button></div><p id="invitationListError" class="form-error" role="alert" hidden></p><div id="invitationList"></div>';
  document.querySelector('main').append(panel);

  function makeDialog(id, title, description, formId, fields, submitLabel) {
    const dialog = document.createElement('dialog');
    dialog.id = id;
    dialog.className = 'app-dialog';
    dialog.setAttribute('aria-labelledby', id + 'Title');
    dialog.innerHTML = '<form id="' + formId + '"><div class="dialog-head"><div><h2 id="' + id + 'Title">' + title + '</h2><p>' + description + '</p></div><button type="button" class="dialog-close" data-invite-close aria-label="Close">×</button></div><div class="dialog-body">' + fields + '</div><div class="dialog-actions"><button type="button" class="btn-sm ghost" data-invite-close>Cancel</button><button class="btn-sm primary" type="submit">' + submitLabel + '</button></div></form>';
    document.body.append(dialog);
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.addEventListener('click', event => { if (busy) event.stopPropagation(); });
    dialog.querySelectorAll('[data-invite-close]').forEach(button => button.addEventListener('click', () => { if (!busy) dialog.close(); }));
    return dialog;
  }

  const userDialog = makeDialog('inviteUserDialog', 'Invite a user', 'One regular USER account · linked to AdminID ' + A.escape(session.AdminID) + ' · the link expiry is shown after creation.', 'createInvitationForm',
    '<p class="form-error" id="createInviteError" role="alert" hidden></p><label class="field-label" for="prefillInviteName">Full name (optional prefill)</label><input class="field-input" id="prefillInviteName" maxlength="200"><label class="field-label" for="prefillInviteUsername">Username (optional prefill)</label><input class="field-input" id="prefillInviteUsername" pattern="[A-Za-z0-9_]{3,20}" title="3–20 letters, numbers or underscores"><label class="field-label" for="prefillInviteEmail">Recipient email (optional)</label><input class="field-input" id="prefillInviteEmail" type="email" maxlength="254"><p class="section-subtitle">If specified, the recipient must use this email. No verification email is sent.</p><label class="field-label" for="prefillInvitePhoto">Profile picture (optional)</label><input class="field-input" id="prefillInvitePhoto" type="file" accept="image/png,image/jpeg,image/webp"><div class="invitation-result" id="invitationResult" hidden><label class="field-label" for="generatedInviteLink">Share this invitation link</label><input class="field-input invitation-link" id="generatedInviteLink" readonly><p class="invitation-expiry" id="generatedInviteExpiry"></p><button type="button" class="btn-sm ghost" id="copyInviteLink">Copy link</button></div>',
    'Create user invitation');
  const handoverDialog = makeDialog('adminHandoverDialog', 'Transfer admin access', 'Create a one-time link for a replacement admin on AdminID ' + A.escape(session.AdminID) + '.', 'createAdminHandoverForm',
    '<div class="handover-warning" role="alert"><strong>Admin handover warning</strong><p>When the invited person accepts, this admin account will be replaced, every existing admin session for this AdminID will be signed out, and the invited admin will take over its data and settings. The AdminID and its records stay in place. This action cannot be undone from this form.</p></div><p class="form-error" id="handoverError" role="alert" hidden></p><label class="field-label" for="confirmCurrentAdminPassword">Your current admin password</label><input class="field-input" id="confirmCurrentAdminPassword" type="password" autocomplete="current-password" required><label class="field-label" for="handoverName">New admin full name</label><input class="field-input" id="handoverName" minlength="2" maxlength="200" required><label class="field-label" for="handoverUsername">New admin username</label><input class="field-input" id="handoverUsername" pattern="[A-Za-z0-9_]{3,20}" title="3–20 letters, numbers or underscores" required><label class="field-label" for="handoverEmail">New admin email</label><input class="field-input" id="handoverEmail" type="email" maxlength="254" required><label class="field-label" for="handoverPhoto">Profile picture (optional)</label><input class="field-input" id="handoverPhoto" type="file" accept="image/png,image/jpeg,image/webp"><label class="handover-confirm"><input id="handoverAcknowledged" type="checkbox" required><span>I understand this will replace the admin account for AdminID ' + A.escape(session.AdminID) + ' when the recipient accepts.</span></label><div class="invitation-result" id="handoverResult" hidden><label class="field-label" for="generatedHandoverLink">Share this admin invitation privately</label><input class="field-input invitation-link" id="generatedHandoverLink" readonly><p class="invitation-expiry" id="handoverExpiry"></p><button type="button" class="btn-sm ghost" id="copyHandoverLink">Copy link</button></div>',
    'Create admin invitation link');

  function lock(value) {
    busy = value;
    document.querySelectorAll('#inviteUserDialog input,#inviteUserDialog button,#adminHandoverDialog input,#adminHandoverDialog button').forEach(control => { control.disabled = value; });
  }
  function makeInviteUrl(token) {
    const url = new URL('invite.html', location.href);
    url.hash = 'token=' + token;
    return url.href;
  }
  function describeExpiry(target, result, text) {
    target.textContent = 'AdminID ' + result.AdminID + ' · Expires ' + new Date(result.expiresAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) + '. ' + text;
  }
  async function createLink({ dialog, formId, submit, resultId, linkId, expiryId, rpcName, args, errorId, expiresText }) {
    const form = $(dialog, formId);
    if (busy || !form.reportValidity()) return;
    lock(true);
    const error = $(dialog, errorId);
    error.hidden = true;
    try {
      const result = await A.rpc(rpcName, args());
      if (!/^[a-f0-9]{64}$/.test(result?.token || '') || String(result.AdminID) !== String(session.AdminID)) throw Error('Supabase did not confirm this invitation.');
      $(dialog, linkId).value = makeInviteUrl(result.token);
      describeExpiry($(dialog, expiryId), result, expiresText);
      $(dialog, resultId).hidden = false;
      submit.disabled = true;
      await load();
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    } finally {
      lock(false);
      if (dialog === handoverDialog) $('adminHandoverDialog', 'confirmCurrentAdminPassword').value = '';
      if (!$(dialog, resultId).hidden) submit.disabled = true;
    }
  }

  inviteUser.onclick = () => { $('inviteUserDialog', 'createInvitationForm').reset(); $('inviteUserDialog', 'prefillInvitePhoto').dataset.photo = ''; $('inviteUserDialog', 'createInviteError').hidden = true; $('inviteUserDialog', 'invitationResult').hidden = true; $('inviteUserDialog', 'createInvitationForm').querySelector('[type="submit"]').disabled = false; userDialog.showModal(); };
  inviteAdmin.onclick = () => { $('adminHandoverDialog', 'createAdminHandoverForm').reset(); $('adminHandoverDialog', 'handoverPhoto').dataset.photo = ''; $('adminHandoverDialog', 'handoverError').hidden = true; $('adminHandoverDialog', 'handoverResult').hidden = true; $('adminHandoverDialog', 'createAdminHandoverForm').querySelector('[type="submit"]').disabled = false; handoverDialog.showModal(); };

  $('inviteUserDialog', 'prefillInvitePhoto').addEventListener('change', async event => {
    const input = event.currentTarget;
    if (!input.files[0]) { input.dataset.photo = ''; return; }
    lock(true);
    try { input.dataset.photo = ProfileImages.hex(await ProfileImages.read(input.files[0])) || ''; }
    catch (e) { input.value = ''; input.dataset.photo = ''; $('inviteUserDialog', 'createInviteError').textContent = e.message; $('inviteUserDialog', 'createInviteError').hidden = false; }
    finally { lock(false); }
  });
  // Bind user invitation data after optional photo compression.
  const userForm = $('inviteUserDialog', 'createInvitationForm');
  userForm.onsubmit = event => {
    event.preventDefault();
    const photo = $('inviteUserDialog', 'prefillInvitePhoto').dataset.photo || null;
    createLink({
      dialog: userDialog, formId: 'createInvitationForm', submit: userForm.querySelector('[type="submit"]'),
      resultId: 'invitationResult', linkId: 'generatedInviteLink', expiryId: 'generatedInviteExpiry', errorId: 'createInviteError',
      rpcName: 'ats_invite_create', expiresText: 'Share this link privately with the intended user.',
      args: () => ({ p_session_token: session.sessionToken, p_full_name: $('inviteUserDialog', 'prefillInviteName').value.trim() || null, p_username: $('inviteUserDialog', 'prefillInviteUsername').value.trim() || null, p_email: $('inviteUserDialog', 'prefillInviteEmail').value.trim() || null, p_profile_picture: photo })
    });
  };

  const adminForm = $('adminHandoverDialog', 'createAdminHandoverForm');
  adminForm.onsubmit = event => {
    event.preventDefault();
    const input = $('adminHandoverDialog', 'handoverPhoto');
    createLink({
      dialog: handoverDialog, formId: 'createAdminHandoverForm', submit: adminForm.querySelector('[type="submit"]'),
      resultId: 'handoverResult', linkId: 'generatedHandoverLink', expiryId: 'handoverExpiry', errorId: 'handoverError',
      rpcName: 'ats_admin_handover_create', expiresText: 'The link expiry is shown above. Only share it with the replacement admin.',
      args: () => ({ p_session_token: session.sessionToken, p_current_password: $('adminHandoverDialog', 'confirmCurrentAdminPassword').value, p_full_name: $('adminHandoverDialog', 'handoverName').value.trim(), p_username: $('adminHandoverDialog', 'handoverUsername').value.trim(), p_email: $('adminHandoverDialog', 'handoverEmail').value.trim(), p_profile_picture: input.dataset.photo || null })
    });
  };
  for (const id of ['prefillInvitePhoto', 'handoverPhoto']) {
    const input = $(id === 'prefillInvitePhoto' ? userDialog : handoverDialog, id);
    if (id === 'handoverPhoto') input.addEventListener('change', async () => {
      if (!input.files[0]) { input.dataset.photo = ''; return; }
      lock(true);
      try { input.dataset.photo = ProfileImages.hex(await ProfileImages.read(input.files[0])) || ''; }
      catch (e) { input.value = ''; input.dataset.photo = ''; $('adminHandoverDialog', 'handoverError').textContent = e.message; $('adminHandoverDialog', 'handoverError').hidden = false; }
      finally { lock(false); }
    });
  }

  async function copyLink(dialog, fieldId) {
    try { await navigator.clipboard.writeText($(dialog, fieldId).value); A.notify('Invitation link copied.'); }
    catch (_) { $(dialog, fieldId).focus(); $(dialog, fieldId).select(); A.notify('Link selected. Copy it to share.'); }
  }
  $('inviteUserDialog', 'copyInviteLink').onclick = () => copyLink(userDialog, 'generatedInviteLink');
  $('adminHandoverDialog', 'copyHandoverLink').onclick = () => copyLink(handoverDialog, 'generatedHandoverLink');

  async function load() {
    const error = panel.querySelector('#invitationListError');
    try {
      const entries = await A.rpc('ats_invite_list', { p_session_token: session.sessionToken });
      if (!Array.isArray(entries)) throw Error('Invalid invitation response.');
      panel.querySelector('#invitationList').innerHTML = entries.map(item => {
        const kind = item.invite_type === 'admin_handover' ? 'Admin handover' : 'User invitation';
        return '<div class="invitation-list-item"><div><strong>' + A.escape(item.full_name || item.email || kind) + '</strong><small>' + A.escape(kind) + ' · ' + A.escape(item.status) + ' · Expires ' + A.escape(new Date(item.expires_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })) + '</small></div>' + (item.status === 'Pending' ? '<button type="button" class="btn-sm ghost" data-revoke-invite="' + A.escape(item.id) + '">Revoke</button>' : '') + '</div>';
      }).join('') || '<p class="inline-empty">No invitations yet.</p>';
      error.hidden = true;
    } catch (e) { error.textContent = e.message; error.hidden = false; }
  }
  panel.querySelector('#refreshInvitations').onclick = load;
  panel.addEventListener('click', async event => {
    const target = event.target.closest('[data-revoke-invite]');
    if (!target) return;
    target.disabled = true;
    try { await A.rpc('ats_invite_revoke', { p_session_token: session.sessionToken, p_invitation_id: target.dataset.revokeInvite }); await load(); A.notify('Invitation revoked.'); }
    catch (e) { A.notify(e.message); target.disabled = false; }
  });
  await load();
})();
