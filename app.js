(function () {
  'use strict';

  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const dateKey = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  let verifiedAccount = null;
  const sharedRecordKeys = new Set(['ats_applicants', 'ats_events', 'ats_mrfs']);
  function recordStorageKey(key) {
    if (!sharedRecordKeys.has(key)) return key;
    const id = verifiedAccount?.AdminID;
    if (!/^\d+$/.test(String(id)) || getUser()?.sessionToken !== verifiedAccount.sessionToken) return null;
    return key + ':admin:' + id;
  }

  function notify(message) {
    let toast = document.getElementById('appNotice');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'appNotice';
      toast.className = 'app-notice';
      toast.setAttribute('role', 'status');
      document.body.append(toast);
    }
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => { toast.hidden = true; }, 5000);
  }

  function read(key) {
    try {
      const scopedKey = recordStorageKey(key);
      if (!scopedKey) return [];
      let raw = localStorage.getItem(scopedKey);
      if (raw === null && sharedRecordKeys.has(key)) {
        // Preserve old records; import only rows with an explicit matching owner.
        const legacy = JSON.parse(localStorage.getItem(key) || '[]');
        const owned = Array.isArray(legacy) ? legacy.filter(row => row && String(row.AdminID) === String(verifiedAccount.AdminID)) : [];
        localStorage.setItem(scopedKey, JSON.stringify(owned));
        raw = JSON.stringify(owned);
      }
      if (raw === null) return [];
      const records = JSON.parse(raw);
      if (!Array.isArray(records)) throw new Error('Invalid records');
      const owned = records.filter(record => record && typeof record === 'object' &&
        (!sharedRecordKeys.has(key) || String(record.AdminID) === String(verifiedAccount.AdminID)));
      if (key === 'ats_applicants') {
        const merged = new Map(owned.map(row => [String(row.id),row]));
        (window.ATS.remoteApplicants || []).forEach(row => merged.set(String(row.id),row));
        return [...merged.values()];
      }
      return owned;
    } catch (error) {
      notify('Saved records could not be read. Check that browser storage is available.');
      return [];
    }
  }

  function save(key, records) {
    if (key === 'ats_applicants') throw new Error('Use the applicant form to save this record to Supabase.');
    const previous = sharedRecordKeys.has(key) ? read(key) : [];
    let ownedRecords;
    try {
      const scopedKey = recordStorageKey(key);
      if (!scopedKey) throw new Error('Sign in before saving records.');
      ownedRecords = sharedRecordKeys.has(key) ? records.map(record => {
        if (record.AdminID != null && String(record.AdminID) !== String(verifiedAccount.AdminID)) throw new Error('This record belongs to another AdminID.');
        return { ...record, AdminID: verifiedAccount.AdminID };
      }) : records;
      localStorage.setItem(scopedKey, JSON.stringify(ownedRecords));
    } catch (error) {
      throw new Error('Changes could not be saved. Check browser storage space and permissions, then try again.');
    }
    window.dispatchEvent(new CustomEvent('ats:data-change', { detail: { key } }));
    const entity = key === 'ats_applicants' ? 'applicant' : key === 'ats_events' ? 'event' : null;
    if (entity && verifiedAccount) {
      const before = new Map(previous.map(row => [String(row.id), row]));
      const after = new Map(ownedRecords.map(row => [String(row.id), row]));
      const changes = [];
      after.forEach((row,id) => {
        const old = before.get(id);
        if (!old || JSON.stringify(old) !== JSON.stringify(row)) changes.push({ row, action: old ? 'updated' : 'created' });
      });
      before.forEach((row,id) => { if (!after.has(id)) changes.push({ row, action: 'deleted' }); });
      const token = verifiedAccount.sessionToken;
      Promise.all(changes.map(({row,action}) => ATS.rpc('ats_activity_log', {
        p_session_token: token, p_entity_type: entity, p_action: action,
        p_entity_id: String(row.id), p_entity_label: String(row.name || row.title || (entity === 'applicant' ? 'Applicant' : 'Event')).slice(0,200),
        p_event_key: ATS.id()
      }))).then(() => { if (changes.length) window.dispatchEvent(new Event('ats:activity-refresh')); })
        .catch(error => { console.error(error); notify('Record saved, but its activity notification could not be synced.'); });
    }
  }

  function getUser() {
    try { return JSON.parse(localStorage.getItem('ats_user')) || null; }
    catch (error) { return null; }
  }

  function openDialog(dialog) {
    if (!dialog.open) dialog.showModal();
  }

  function closeDialog(dialog) {
    dialog.close();
  }

  window.ATS = {
    read, save, escape, dateKey, getUser, notify, openDialog, closeDialog,
    id: () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    today: () => dateKey(new Date()),
    formatDate: (key, options) => {
      if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return '—';
      return new Date(`${key}T12:00:00`).toLocaleDateString('en-PH', options || { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  ATS.applicantStatuses = [
    'For Orientation', 'For Final Interview', 'Rejected', 'Backout', 'No Show',
    'No Answer', 'For F2F Interview', 'Deployed', 'For Pooling', 'For Exam',
    'For Job Offer', 'For Phone Interview', 'For Online Interview', 'Hired', 'RESIGNED'
  ];
  ATS.applicantInterviewStatuses = ['Phone Interview','Final Interview','For Phone Interview','For Final Interview','For F2F Interview','For Online Interview'];
  ATS.applicantStatusTone = status => ['Hired','Deployed','Job Offer','For Job Offer'].includes(status) ? 'success'
    : ['Rejected','Inactive','No Show','Backout','No Answer','RESIGNED'].includes(status) ? 'danger'
    : ['Pooling','For Pooling','For Exam'].includes(status) ? 'warning' : '';
  const userLinks = document.querySelectorAll('a[href="users.html"]');
  userLinks.forEach(link => { link.hidden = true; });
  ATS.isAdmin = account => account?.accountType === 'admin' && [1, 2].includes(Number(account.roleId)) && account.status === 'Active';
  ATS.rpc = async function (name, parameters) {
    const response = await fetch('https://wqshrjlcjqbjqcophvfv.supabase.co/rest/v1/rpc/' + name, {
      method: 'POST', headers: { apikey: 'sb_publishable_2QWxapvC5t_KHq-0u35d1w_kK-ah1eN', 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters)
    });
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok) throw Object.assign(new Error(result?.code === 'PGRST202' ? 'Supabase setup is required. Run supabase-users-setup.sql in SQL Editor.' : result?.message || 'Supabase request failed.'), { code: result?.code });
    return result;
  };
  ATS.ready = (async function () {
    const saved = getUser();
    try {
      if (!saved?.sessionToken) throw Error('Please sign in again.');
      const verified = await ATS.rpc('ats_me', { p_session_token: saved.sessionToken });
      if (!verified || !['admin','user'].includes(verified.accountType) || verified.status !== 'Active') throw Error('Invalid session.');
      if (getUser()?.sessionToken !== saved.sessionToken) return null;
      const session = { ...verified, sessionToken: saved.sessionToken };
      localStorage.setItem('ats_user', JSON.stringify(session));
      verifiedAccount = session;
      userLinks.forEach(link => { link.hidden = !ATS.isAdmin(session); });
      return session;
    } catch (error) {
      try { localStorage.removeItem('ats_user'); } catch (_) { /* Sign-in is required. */ }
      location.replace('index.html');
      return null;
    }
  })();
  ATS.reloadCatalogs = async function () {
    const session = await ATS.ready;
    if (!session || getUser()?.sessionToken !== session.sessionToken) throw new Error('Please sign in again.');
    const data = await ATS.rpc('ats_catalog_list', { p_session_token: session.sessionToken });
    if (!data || String(data.AdminID) !== String(session.AdminID) || !['sources','positions','locations'].every(key => Array.isArray(data[key]))) throw new Error('Invalid settings response.');
    if (getUser()?.sessionToken !== session.sessionToken) throw new Error('The signed-in account changed.');
    ATS.catalogs = data;
    window.dispatchEvent(new Event('ats:catalogs-changed'));
    return data;
  };
  ATS.catalogReady = ATS.reloadCatalogs().catch(error => { ATS.catalogError = error; return null; });
  ATS.normalizeApplicant = row => {
    const keys=['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME'];
    const done=keys.filter(key=>row[key]&&!/pending|missing|not submitted|not yet|follow.?up/i.test(row[key])).length;
    return { id: row.ClientRecordID || 'db-'+row.ApplicantID, databaseId:row.ApplicantID, AdminID:row.AdminID,
      name:row.FullName||row.Name||'',position:row.PositionApplied||row.Position||'',source:row.Source||'',site:row.Site||'',
      email:row.Email||row['Email Address']||'',phone:row.ContactNumber||row['Contact Number']||'',status:row.Status||(row.WorkbookImportID?'Not recorded':'Screened'),
      dateApplied:row.Date||String(row.DateApplied||'').slice(0,10),requirements:done*10,db:row };
  };
  ATS.reloadApplicants = async function () {
    const session=await ATS.ready;if(!session)return [];
    const records=[];
    for(let offset=0;;offset+=500){
      const batch=await ATS.rpc('ats_applicant_list',{p_session_token:session.sessionToken,p_offset:offset,p_limit:500});
      if(!Array.isArray(batch)||batch.some(row=>String(row.AdminID)!==String(session.AdminID)))throw new Error('Invalid applicant response for this AdminID.');
      records.push(...batch);if(batch.length<500)break;
    }
    if(getUser()?.sessionToken!==session.sessionToken)return [];
    ATS.remoteApplicants=records.map(ATS.normalizeApplicant);ATS.applicantsError=null;
    window.dispatchEvent(new CustomEvent('ats:data-change',{detail:{key:'ats_applicants'}}));return ATS.remoteApplicants;
  };
  ATS.applicantsReady=ATS.reloadApplicants().catch(error=>{ATS.applicantsError=error;return [];});
  window.addEventListener('storage', event => {
    if (event.key === 'ats_user' && verifiedAccount && getUser()?.sessionToken !== verifiedAccount.sessionToken) {
      verifiedAccount = null;
      userLinks.forEach(link => { link.hidden = true; });
      location.replace('index.html');
    }
  });

  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebarToggle');
  if (sidebar && toggle) {
    try { sidebar.classList.toggle('collapsed', localStorage.getItem('ats_sidebar_collapsed') === 'true'); } catch (error) { /* Browsing can continue without saved preferences. */ }
    function updateToggle() {
      const collapsed = sidebar.classList.contains('collapsed');
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-controls', 'sidebar');
      toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      toggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    }
    updateToggle();
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      updateToggle();
      try { localStorage.setItem('ats_sidebar_collapsed', String(sidebar.classList.contains('collapsed'))); } catch (error) { /* Optional preference. */ }
    });
    sidebar.setAttribute('aria-label', 'Main navigation');
    sidebar.querySelectorAll('.nav-link').forEach(link => {
      link.setAttribute('aria-label', link.title || link.textContent.trim());
      if (link.classList.contains('active')) link.setAttribute('aria-current', 'page');
    });
  }

  const user = getUser();
  const name = typeof user?.name === 'string' && user.name.trim() ? user.name.trim() : 'Administrator';
  const avatar = document.getElementById('userAvatar');
  if (avatar) {
    const parts = name.split(/\s+/);
    avatar.textContent = parts.length > 1 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
    avatar.title = name;
    avatar.setAttribute('aria-label', name);
  }
  function updateClock() {
    const now = new Date();
    const greeting = document.getElementById('userGreeting');
    const clock = document.getElementById('realtimeMeta');
    if (greeting) greeting.textContent = `Good ${now.getHours() < 12 ? 'morning' : now.getHours() < 18 ? 'afternoon' : 'evening'}, ${name}`;
    if (clock) clock.textContent = now.toLocaleString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  updateClock();
  if (document.getElementById('realtimeMeta')) setInterval(updateClock, 30000);
  document.getElementById('logoutBtn')?.addEventListener('click', async event => {
    event.preventDefault();
    const token = getUser()?.sessionToken;
    try { localStorage.removeItem('ats_user'); } catch (_) { /* Continue to sign-in. */ }
    userLinks.forEach(link => { link.hidden = true; });
    try { if (token) await ATS.rpc('ats_logout', { p_session_token: token }); }
    catch (error) { console.error(error); }
    finally { location.replace('index.html'); }
  });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  document.addEventListener('click', event => {
    const close = event.target.closest('[data-close-dialog]');
    if (close) closeDialog(close.closest('dialog'));
    if (event.target instanceof HTMLDialogElement) {
      const box = event.target.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDialog(event.target);
    }
  });
  const activityStyles = document.createElement('link');
  activityStyles.rel = 'stylesheet'; activityStyles.href = 'notifications.css'; document.head.append(activityStyles);
  const activityScript = document.createElement('script');
  activityScript.src = 'notifications.js'; document.head.append(activityScript);
  const companyStyles = document.createElement('link'); companyStyles.rel='stylesheet'; companyStyles.href='company.css'; document.head.append(companyStyles);
  const companyScript = document.createElement('script'); companyScript.src='company.js'; document.head.append(companyScript);
  const settingsStyles = document.createElement('link'); settingsStyles.rel = 'stylesheet'; settingsStyles.href = 'settings.css'; document.head.append(settingsStyles);
  const settingsScript = document.createElement('script'); settingsScript.src = 'settings.js'; document.head.append(settingsScript);
})();
