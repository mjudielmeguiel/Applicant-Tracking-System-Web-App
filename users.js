(async function () {
  "use strict";
  const A = window.ATS,
    $ = (id) => document.getElementById(id),
    esc = A.escape;
  let photos = {},presence = {};
  let users = [],
    loading = false,
    saving = false;
  const session = await A.ready;
  if (!session) return;
  if (!A.isAdmin(session)) {
    location.replace("dashboard.html");
    return;
  }
  $("openAddUserBtn").hidden = false;
  const quotaPanel=document.createElement('form');quotaPanel.className='user-quota-panel';quotaPanel.innerHTML='<div><strong>User account limit</strong><p id="accountQuotaSummary" role="status">Loading account capacity…</p><small>Includes USER and RECRUITER accounts, including inactive accounts. Admin accounts are excluded.</small></div><div class="page-actions"><label for="workspaceUserLimit">Maximum accounts</label><select id="workspaceUserLimit" class="field-input"><option value="5">5 users</option><option value="10" selected>10 users</option></select><button class="btn-sm ghost" type="submit">Save limit</button></div><p class="form-error" id="accountQuotaError" role="alert" hidden></p>';$('usersError').after(quotaPanel);
  function showQuota(value){if(![5,10].includes(value?.limit))return;A.userQuota=value;$('workspaceUserLimit').value=value.limit;$('accountQuotaSummary').textContent=value.count+' of '+value.limit+' accounts used · '+value.remaining+' remaining';$('openAddUserBtn').disabled=value.remaining===0;window.dispatchEvent(new CustomEvent('ats:account-quota',{detail:value}));}
  async function loadQuota(){try{showQuota(await A.rpc('ats_user_limit',{p_session_token:session.sessionToken}));}catch(error){$('accountQuotaSummary').textContent='Account capacity unavailable.';}}
  quotaPanel.onsubmit=async event=>{event.preventDefault();event.submitter.disabled=true;$('accountQuotaError').hidden=true;try{showQuota(await A.rpc('ats_user_limit',{p_session_token:session.sessionToken,p_limit:Number($('workspaceUserLimit').value)}));A.notify('User account limit saved.');}catch(error){$('accountQuotaError').textContent=error.message;$('accountQuotaError').hidden=false;if(A.userQuota)$('workspaceUserLimit').value=A.userQuota.limit;}finally{event.submitter.disabled=false;}};
  void loadQuota();
  function acceptPresence(records) {
    const receivedAt = Date.now();
    presence = Object.fromEntries(Object.entries(records || {}).map(([id, entry]) => [id, { ...entry, receivedAt }]));
  }
  function connection(user) {
    const entry = presence[user.UserID] || {};
    const lastSeen = Date.parse(entry.last_seen || '');
    const serverNow = Date.parse(entry.server_now || '');
    const now = Number.isFinite(serverNow) ? serverNow + Math.max(0, Date.now() - (entry.receivedAt || Date.now())) : Date.now();
    const stale = Number.isFinite(lastSeen) && now - lastSeen > 120000;
    const online = user.Status === 'Active' && ['Active', 'Busy'].includes(entry.presence) && !stale;
    return { online, lastSeen, now };
  }
  function lastActivity({ lastSeen, now }) {
    if (!Number.isFinite(lastSeen)) return '<span class="user-last-seen">No activity recorded</span>';
    const seconds = Math.max(0, Math.floor((now - lastSeen) / 1000));
    let ago = 'just now';
    if (seconds >= 86400) {
      const days = Math.floor(seconds / 86400);
      ago = `${days} day${days === 1 ? '' : 's'} ago`;
    } else if (seconds >= 3600) {
      const hours = Math.floor(seconds / 3600);
      ago = `${hours} hour${hours === 1 ? '' : 's'} ago`;
    } else if (seconds >= 60) {
      const minutes = Math.floor(seconds / 60);
      ago = `${minutes} min${minutes === 1 ? '' : 's'} ago`;
    }
    const date = new Date(lastSeen);
    return `<time class="user-last-seen" datetime="${date.toISOString()}" title="${esc(date.toLocaleString())}">Last active ${ago}</time>`;
  }
  function render() {
    const query = $("userSearch").value.trim().toLowerCase(),
      status = $("userStatus").value.toLowerCase();
    const filtered = users.filter(
      (u) =>
        [u.FullName, u.Username, u.Email, u.Role]
          .join(" ")
          .toLowerCase()
          .includes(query) &&
        (!status || (connection(u).online ? 'online' : 'offline') === status),
    );
    $("usersTotal").textContent = users.length;
    const onlineCount = users.filter((u) => connection(u).online).length;
    $("usersOnline").textContent = onlineCount;
    $("usersOffline").textContent = users.length - onlineCount;
    document.querySelectorAll('[data-user-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.userFilter === status)));
    $("usersSource").textContent = "Supabase";
    $("usersBody").innerHTML =
      filtered
        .map((u) => {
          const state = connection(u);
          const label = state.online ? 'Online' : 'Offline';
          return `<tr><td><div class="user-directory-person"><div class="user-directory-avatar">${ProfileImages.markup(photos[u.UserID],u.FullName)}<span class="presence-dot" data-presence="${state.online ? 'Active' : 'Offline'}" role="img" aria-label="${label}"></span></div><div><div class="user-info-name">${esc(u.FullName)}</div><div class="user-info-email">${esc(u.Email)}</div></div></div></td><td>${esc(u.Username)}</td><td><span class="badge-status role">${esc(u.Role)}</span></td><td class="user-connection"><span class="presence-label" data-presence="${state.online ? 'Active' : 'Offline'}">${label}</span>${state.online ? '' : lastActivity(state)}</td><td>${u.CreatedAt ? esc(A.formatDate(String(u.CreatedAt).slice(0, 10))) : "—"}</td><td><button class="btn-sm ghost" type="button" data-manage-user="${esc(u.UserID)}">Manage</button></td></tr>`;
        })
        .join("") ||
      `<tr><td colspan="6" class="empty-state">${loading ? "Loading users…" : "No users to display."}</td></tr>`;
    $("usersCount").textContent = loading
      ? "Connecting to Supabase…"
      : `${filtered.length} of ${users.length} users`;
  }
  async function loadUsers() {
    if (loading) return;
    loading = true;
    $("refreshUsers").disabled = true;
    $("usersError").hidden = true;
    render();
    try {
      const records = [];
      for (let offset = 0; ; offset += 500) {
        const batch = await A.rpc("ats_list_users", {
          p_session_token: session.sessionToken,
          p_offset: offset,
          p_limit: 500,
        });
        if (!Array.isArray(batch)) throw Error("Invalid users response.");
        records.push(
          ...batch.filter(
            (u) => ["USER","RECRUITER"].includes(String(u.Role).trim().toUpperCase()) && String(u.AdminID) === String(session.AdminID),
          ),
        );
        if (batch.length < 500) break;
      }
      if (A.getUser()?.sessionToken !== session.sessionToken) return;
      users = records;await loadQuota();try{acceptPresence(await A.rpc("ats_presence_list",{p_session_token:session.sessionToken}));}catch{presence={};}
      try { const result = await A.rpc("ats_user_photos", {p_session_token:session.sessionToken}); if (String(result.AdminID) !== String(session.AdminID)) throw Error("Invalid photo response."); photos = result.photos || {}; } catch (_) { photos = {}; }
    } catch (e) {
      users = [];
      $("usersError").textContent = e.message;
      $("usersError").hidden = false;
    } finally {
      loading = false;
      $("refreshUsers").disabled = false;
      render();
    }
  }
  const dialog = $("addUserDialog"),
    form = $("addUserForm");
  $("openAddUserBtn").addEventListener("click", () => {
    form.reset();

    $("addUserError").hidden = true;
    A.openDialog(dialog);
  });
  dialog.addEventListener("cancel", (e) => {
    if (saving) e.preventDefault();
  });
  dialog.addEventListener("click", (e) => {
    if (saving) e.stopPropagation();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving || !form.reportValidity()) return;
    $("addUserError").hidden = true;
    try {
      const password = $("newPassword").value;
      if (password !== $("newConfirm").value)
        throw Error("Passwords do not match.");
      if (
        !/[A-Za-z]/.test(password) ||
        !/\d/.test(password) ||
        new TextEncoder().encode(password).length > 72
      )
        throw Error(
          "Use letters and numbers, at least 8 characters, and at most 72 UTF-8 bytes.",
        );
      const photo = $("newPhoto").files[0];
      if (
        photo &&
        (!["image/png", "image/jpeg", "image/webp"].includes(photo.type) ||
          photo.size > 10 * 1024 * 1024)
      )
        throw Error("Choose a PNG, JPEG, or WebP image no larger than 10 MB.");
      const values = {
        p_full_name: $("newFullName").value.trim(),
        p_username: $("newUsername").value.trim(),
        p_email: $("newEmail").value.trim(),
        p_session_token: session.sessionToken,
      };
      saving = true;
      form.querySelectorAll("input,button").forEach((c) => (c.disabled = true));
      $("saveUserBtn").textContent = "Saving…";
      const current = await A.rpc("ats_me", {
        p_session_token: session.sessionToken,
      });
      if (!A.isAdmin(current)) {
        dialog.close();
        $("openAddUserBtn").hidden = true;
        location.replace("dashboard.html");
        return;
      }
      values.p_password_hash = dcodeIO.bcrypt.hashSync(password, 10);
      values.p_profile_picture = ProfileImages.hex(await ProfileImages.read(photo));
      const saved = await A.rpc("ats_add_user", values);
      if (
        !saved ||
        !/^\d+$/.test(String(saved.UserID)) ||
        String(saved.AdminID) !== String(current.AdminID) ||
        saved.Role !== "USER"
      )
        throw Error(
          "Supabase did not confirm saving. Check the Users list before retrying.",
        );
      dialog.close();
      form.reset();
      window.dispatchEvent(new Event('ats:activity-refresh'));
      A.notify(
        "User saved.",
      );
      await loadUsers();
    } catch (e) {
      if (e.code === "28000" || e.code === "42501") {
        try {
          localStorage.removeItem("ats_user");
        } catch (_) {}
        dialog.close();
        location.replace("index.html");
        return;
      }
      $("addUserError").textContent = e.message;
      $("addUserError").hidden = false;
    } finally {
      saving = false;
      form
        .querySelectorAll("input,button")
        .forEach((c) => (c.disabled = false));
      $("saveUserBtn").textContent = "Save User";
    }
  });
  const manage=document.createElement('dialog');manage.className='app-dialog';manage.id='manageUserDialog';manage.setAttribute('aria-labelledby','manageUserTitle');
  manage.innerHTML='<div class="dialog-head"><div><h2 id="manageUserTitle">Manage user</h2><p>Account information and access</p></div><button class="dialog-close" type="button" id="closeManageUser" aria-label="Close user details">×</button></div><form id="manageUserForm"><div class="dialog-body"><div class="managed-user-identity" id="managedUserInfo"></div><div class="form-grid"><div><label class="field-label" for="managedRole">Role</label><select class="field-input" id="managedRole"><option value="USER">User</option><option value="RECRUITER">Recruiter</option></select></div><div><label class="field-label" for="managedStatus">Status</label><select class="field-input" id="managedStatus"><option>Active</option><option>Inactive</option></select></div></div><p class="form-error" id="manageUserError" role="alert" hidden></p><p class="form-success" id="manageUserSuccess" role="status" hidden></p><label class="field-label" for="managedPresence">Availability</label><select class="field-input" id="managedPresence"><option>Active</option><option>Busy</option><option>Offline</option><option>Inactive</option></select><p class="section-subtitle">Updates presence only. Account status controls sign-in access.</p><section class="managed-user-security"><h3>Account security</h3><p>Reset a forgotten password to <strong>Password1*</strong>. Share it privately with the user. Existing sessions will be signed out.</p><button type="button" class="btn-sm ghost" id="resetManagedPassword">Reset password</button><button type="button" class="btn-sm danger" id="deleteManagedAccount">Delete account</button></section></div><div class="dialog-actions"><button type="button" class="btn-sm ghost" id="cancelManageUser">Close</button><button type="submit" class="btn-sm primary">Save changes</button></div></form>';document.body.append(manage);
  let selectedUser=null,managing=false;
  $('usersBody').addEventListener('click',event=>{const button=event.target.closest('[data-manage-user]');if(!button)return;selectedUser=users.find(user=>String(user.UserID)===button.dataset.manageUser);if(!selectedUser)return;$('managedUserInfo').innerHTML='<div class="managed-user-photo">'+ProfileImages.markup(photos[selectedUser.UserID],selectedUser.FullName)+'</div><div class="managed-user-copy"><strong>'+esc(selectedUser.FullName)+'</strong><p>'+esc(selectedUser.Username)+'</p><p>'+esc(selectedUser.Email||'No email provided')+'</p><p>Created '+esc(selectedUser.CreatedAt?A.formatDate(String(selectedUser.CreatedAt).slice(0,10)):'Unknown')+'</p></div>';A.paintPresence(document.querySelector('.managed-user-photo'),presence[selectedUser.UserID]?.presence);$('managedPresence').value=presence[selectedUser.UserID]?.status||'Active';$('managedRole').value=selectedUser.Role;$('managedStatus').value=selectedUser.Status;$('manageUserError').hidden=true;$('manageUserSuccess').hidden=true;manage.showModal();});
  function closeManage(){if(!managing)manage.close();}$('closeManageUser').onclick=closeManage;$('cancelManageUser').onclick=closeManage;manage.addEventListener('cancel',event=>{if(managing)event.preventDefault();});
  async function manageAction(action){if(managing||!selectedUser)return;managing=true;manage.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);$('manageUserError').hidden=true;$('manageUserSuccess').hidden=true;try{const result=await A.rpc('ats_user_manage',{p_session_token:session.sessionToken,p_user_id:selectedUser.UserID,p_action:action,p_role:$('managedRole').value,p_status:$('managedStatus').value});if(!result?.saved||String(result.AdminID)!==String(session.AdminID)||String(result.UserID)!==String(selectedUser.UserID)||result.action!==action)throw Error('The server did not confirm this change.');if(action==='delete'){manage.close();A.notify('User account deleted. Recruitment records are preserved.');}else{$('manageUserSuccess').textContent=action==='reset_password'?'Password reset to Password1*. Existing sessions have been signed out.':'Role and status saved. Existing sessions have been signed out.';$('manageUserSuccess').hidden=false;}await loadUsers();}catch(error){$('manageUserError').textContent=error.message;$('manageUserError').hidden=false;}finally{managing=false;manage.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);}}
  $('managedPresence').onchange=async()=>{const input=$('managedPresence');input.disabled=true;$('manageUserError').hidden=true;try{const result=await A.rpc('ats_presence',{p_session_token:session.sessionToken,p_user_id:selectedUser.UserID,p_status:input.value});presence[selectedUser.UserID]={...presence[selectedUser.UserID],...result,receivedAt:Date.now()};render();A.paintPresence(document.querySelector('.managed-user-photo'),result.presence);A.notify('User availability updated.');}catch(error){$('manageUserError').textContent=error.message;$('manageUserError').hidden=false;}finally{input.disabled=false;}};
  async function refreshPresence(){if(document.hidden)return;try{acceptPresence(await A.rpc('ats_presence_list',{p_session_token:session.sessionToken}));render();if(manage.open&&selectedUser){A.paintPresence(document.querySelector('.managed-user-photo'),presence[selectedUser.UserID]?.presence);if(document.activeElement!==$('managedPresence'))$('managedPresence').value=presence[selectedUser.UserID]?.status||'Active';}}catch{render();}}
  setInterval(refreshPresence,30000);window.addEventListener('focus',refreshPresence);
  $('manageUserForm').onsubmit=event=>{event.preventDefault();void manageAction('update');};
  $('resetManagedPassword').onclick=()=>{if(!managing&&confirm('Reset this user’s password to Password1* and sign out their existing sessions?'))void manageAction('reset_password');};
  $('deleteManagedAccount').onclick=async()=>{if(!managing&&await A.confirmDelete('Delete user account','Permanently delete '+selectedUser.FullName+'? Their recruitment records will be preserved.'))await manageAction('delete');};
  $("userSearch").addEventListener("input", render);
  $("userStatus").addEventListener("change", render);
  document.querySelectorAll('[data-user-filter]').forEach(button => button.addEventListener('click', () => {
    $('userStatus').value = $('userStatus').value === button.dataset.userFilter ? '' : button.dataset.userFilter;
    render();
  }));
  $("refreshUsers").addEventListener("click", loadUsers);
  window.addEventListener("ats:profile-change", loadUsers);
  await loadUsers();
})();
