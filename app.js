(function () {
  'use strict';

  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const dateKey = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  const manilaDay = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Manila', year:'numeric', month:'2-digit', day:'2-digit'});
  function manilaDateKey(value) {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : manilaDay.format(date);
  }
  let verifiedAccount = null;
  const sharedRecordKeys = new Set(['ats_applicants', 'ats_events']);
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
    read, save, escape, dateKey, manilaDateKey, getUser, notify, openDialog, closeDialog,
    applicantAddedDay: record => {
      const row = record.db || record;
      return manilaDateKey(record.addedAt || row.CreatedAt || row.created_at);
    },
    id: () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    today: () => dateKey(new Date()),
    formatDate: (key, options) => {
      if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return '—';
      return new Date(`${key}T12:00:00`).toLocaleDateString('en-PH', options || { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  // Shared loading placeholders follow the existing workspace palette.
  ATS.startLoading=(target,label='Loading content')=>{
    if(!target)return ()=>{};
    const skeleton=document.createElement('div');skeleton.className='ats-skeleton';skeleton.setAttribute('role','status');skeleton.setAttribute('aria-label',label);
    skeleton.innerHTML='<div class="skeleton-heading"><span class="skeleton-circle"></span><div><span class="skeleton-line"></span><span class="skeleton-line short"></span></div></div><span class="skeleton-block"></span><span class="skeleton-line"></span><span class="skeleton-line medium"></span><span class="skeleton-line short"></span>';
    const previousBusy=target.getAttribute('aria-busy');target.setAttribute('aria-busy','true');target.classList.add('ats-loading');target.append(skeleton);
    return ()=>{skeleton.remove();if(!target.querySelector(':scope > .ats-skeleton')){target.classList.remove('ats-loading');if(previousBusy===null)target.removeAttribute('aria-busy');else target.setAttribute('aria-busy',previousBusy);}};
  };
  ATS.confirmDelete=(title,description)=>new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='app-dialog delete-confirm-dialog';dialog.setAttribute('aria-labelledby','deleteConfirmTitle');
    dialog.innerHTML='<div class="delete-confirm-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></div><h2 id="deleteConfirmTitle"></h2><p></p><div class="delete-confirm-actions"><button type="button" class="btn-sm danger" id="confirmDeletion">Delete</button><button type="button" class="btn-sm ghost" id="cancelDeletion">Cancel</button></div>';
    dialog.querySelector('h2').textContent=title;dialog.querySelector('p').textContent=description;document.body.append(dialog);
    const finish=value=>{dialog.close();dialog.remove();resolve(value);};dialog.querySelector('#confirmDeletion').onclick=()=>finish(true);dialog.querySelector('#cancelDeletion').onclick=()=>finish(false);dialog.oncancel=event=>{event.preventDefault();finish(false);};dialog.showModal();dialog.querySelector('#cancelDeletion').focus();
  });

  ATS.applicantStatuses = [
    'For Orientation', 'For Final Interview', 'Rejected', 'Backout', 'No Show',
    'No Answer', 'For F2F Interview', 'Deployed', 'For Pooling', 'For Exam',
    'For Job Offer', 'For Phone Interview', 'For Online Interview', 'Hired', 'RESIGNED'
  ];
  ATS.applicantInterviewStatuses = ['Phone Interview','Final Interview','For Phone Interview','For Final Interview','For F2F Interview','For Online Interview'];
  ATS.applicantStatusTone = status => {
    const key=String(status||'default').trim().toLowerCase().replace(/^for\s+/,'').replace(/[^a-z0-9]+/g,'-');
    return 'status-'+(['orientation','final-interview','phone-interview','f2f-interview','online-interview','pooling','exam','job-offer','hired','deployed','rejected','backout','no-show','no-answer','resigned','screened','inactive','hr-avatar','ongoing'].includes(key)?key:'default');
  };
  ATS.paintStatus=(node,status)=>{if(!node)return;[...node.classList].filter(name=>name.startsWith('status-')&&name!=='status-colored').forEach(name=>node.classList.remove(name));node.classList.add('status-colored',ATS.applicantStatusTone(status));};
  const userLinks = document.querySelectorAll('a[href="users.html"]');
  ATS.isAdmin = account => account?.accountType === 'admin' && [1, 2].includes(Number(account.roleId)) && account.status === 'Active';
  // Paint navigation immediately from the last session, then reconcile with ats_me.
  // This only controls presentation; privileged operations still require server verification.
  const navigationAccount=getUser();
  userLinks.forEach(link => { link.hidden = !navigationAccount?.sessionToken || !ATS.isAdmin(navigationAccount); });
  ATS.rpc = async function (name, parameters) {
    const response = await fetch('https://wqshrjlcjqbjqcophvfv.supabase.co/rest/v1/rpc/' + name, {
      method: 'POST', headers: { apikey: 'sb_publishable_2QWxapvC5t_KHq-0u35d1w_kK-ah1eN', 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters)
    });
    const result = response.status === 204 ? null : await response.json();
    if (!response.ok && result?.code==='28000' && parameters?.p_session_token && getUser()?.sessionToken===parameters.p_session_token) {
      try{localStorage.removeItem('ats_user');}catch{}
      userLinks.forEach(link=>{link.hidden=true;});
      location.replace('index.html?session=ended');
    }
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
  let sessionCheckInFlight = false;
  async function checkCurrentSession() {
    const account = verifiedAccount;
    if (!account || sessionCheckInFlight || document.visibilityState === 'hidden') return;
    const saved = getUser();
    if (saved?.sessionToken !== account.sessionToken) return;
    sessionCheckInFlight = true;
    try {
      const current = await ATS.rpc('ats_me', { p_session_token: account.sessionToken });
      if (!current || current.status !== 'Active' || current.accountType !== account.accountType) throw Object.assign(new Error('Session is no longer active.'), { code: '28000' });
    } catch (error) {
      // Network errors do not sign people out. A revoked/expired session does.
      if (error.code === '28000') {
        try { if (getUser()?.sessionToken === account.sessionToken) localStorage.removeItem('ats_user'); } catch (_) { /* Continue to login. */ }
        verifiedAccount = null;
        userLinks.forEach(link => { link.hidden = true; });
        location.replace('index.html?session=ended');
      }
    } finally { sessionCheckInFlight = false; }
  }
  setInterval(checkCurrentSession, 15000);
  document.addEventListener('visibilitychange', checkCurrentSession);
  ATS.presenceStates=['Active','Busy','Offline','Inactive'];
  ATS.presenceStatus=value=>ATS.presenceStates.includes(value)?value:'Offline';
  ATS.paintPresence=(target,value)=>{if(!target)return;target.querySelector(':scope>.presence-dot')?.remove();const dot=document.createElement('span');dot.className='presence-dot';dot.dataset.presence=ATS.presenceStatus(value);dot.setAttribute('role','img');dot.setAttribute('aria-label',dot.dataset.presence);dot.title=dot.dataset.presence;target.append(dot);};
  ATS.currentPresence='Offline';let presenceInFlight=false;
  async function heartbeat(){const session=await ATS.ready;if(!session||document.hidden||presenceInFlight||ATS.getUser()?.sessionToken!==session.sessionToken)return;presenceInFlight=true;try{const result=await ATS.rpc('ats_presence',{p_session_token:session.sessionToken});if(ATS.presenceStates.includes(result.presence)){ATS.currentPresence=result.presence;ATS.preferredPresence=result.status;window.dispatchEvent(new CustomEvent('ats:presence-change',{detail:result}));}}catch{}finally{presenceInFlight=false;}}
  void heartbeat();setInterval(heartbeat,30000);document.addEventListener('visibilitychange',heartbeat);window.addEventListener('online',heartbeat);window.addEventListener('offline',()=>{ATS.currentPresence='Offline';window.dispatchEvent(new CustomEvent('ats:presence-change',{detail:{presence:'Offline'}}));});
  ATS.reloadCatalogs = async function () {
    const session = await ATS.ready;
    if (!session || getUser()?.sessionToken !== session.sessionToken) throw new Error('Please sign in again.');
    const data = await ATS.rpc('ats_catalog_list', { p_session_token: session.sessionToken });
    if (!data || String(data.AdminID) !== String(session.AdminID) || !['sources','positions','locations'].every(key => Array.isArray(data[key]))) throw new Error('Invalid settings response.');
    if (getUser()?.sessionToken !== session.sessionToken) throw new Error('The signed-in account changed.');
    if (data.positions.some(row => ![row.slots_available,row.applicant_count,row.filled_count,row.remaining_slots].every(value => Number.isInteger(value) && value >= 0))) throw new Error('Invalid position counts from Supabase.');
    ATS.catalogs = data; ATS.catalogError = null;
    window.dispatchEvent(new Event('ats:catalogs-changed'));
    return data;
  };
  ATS.catalogReady = ATS.reloadCatalogs().catch(error => { ATS.catalogError = error; return null; });
  ATS.positionSummary = function () {
    return (ATS.catalogs?.positions || []).map(row => ({
      name: row.name, totalSlots: row.slots_available,
      applicants: row.applicant_count, filled: row.filled_count, remaining: row.remaining_slots
    })).sort((a,b) => b.applicants - a.applicants || a.name.localeCompare(b.name));
  };
  ATS.applicantAppointments = function () {
    const stages={'PHONE INTERVIEW DATE':'For Phone Interview','FINAL INTERVIEW DATE':'For Final Interview','F2F INTERVIEW DATE':'For F2F Interview','ONLINE INTERVIEW DATE':'For Online Interview','ORIENTATION DATE':'For Orientation','EXAM DATE':'For Exam','JOB OFFER DATE':'For Job Offer'};
    const result=[];
    read('ats_applicants').forEach(record=>{
      const row=record.db||{},stamp=row.ScheduleDate&&!Number.isNaN(Date.parse(row.ScheduleDate))?new Date(new Date(row.ScheduleDate).getTime()+8*3600000).toISOString():null;
      const scheduledStage=row.ScheduleType||record.status,tone=ATS.applicantStatusTone(scheduledStage);
      if(stamp&&row.ScheduleResponse!=='Cancelled')result.push({id:'appointment-'+record.id,type:'appointment',applicantId:record.id,date:stamp.slice(0,10),startTime:stamp.slice(11,16),title:scheduledStage+' · '+record.name,stageStatus:scheduledStage,response:row.ScheduleResponse||'Pending',location:record.site||row.Site||''});
      Object.entries(stages).forEach(([column,status])=>{
        const date=String(row[column]||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return;
        if(stamp&&stamp.slice(0,10)===date&&tone===ATS.applicantStatusTone(status))return;
        result.push({id:'stage-'+column+'-'+record.id,type:'appointment',applicantId:record.id,date,startTime:'',title:status+' · '+record.name,stageStatus:status,response:ATS.applicantStatusTone(record.status)===ATS.applicantStatusTone(status)?'Pending':'Recorded',location:record.site||row.Site||''});
      });
    });return result;
  };
  ATS.normalizeApplicant = row => {
    const keys=['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME'];
    const done=keys.filter(key=>row[key]&&!/pending|missing|rejected|not submitted|not yet|follow.?up/i.test(row[key])).length;
    return { id: row.ClientRecordID || 'db-'+row.ApplicantID, databaseId:row.ApplicantID, AdminID:row.AdminID,
      name:row.FullName||row.Name||(row.ApplicationInvitationID?'Incomplete application':''),position:row.PositionApplied||row.Position||'',source:row.Source||'',site:row.Site||'',
      email:row.Email||row['Email Address']||'',phone:row.ContactNumber||row['Contact Number']||'',status:row.Status||(row.WorkbookImportID?'Not recorded':'Screened'),
      dateApplied:row.Date||row['Submission Date']||'',requirements:done*10,db:row };
  };
  ATS.importLocalApplicants = function (rows) {
    const key = 'ats_applicants';
    const scopedKey = recordStorageKey(key);
    if (!scopedKey) throw new Error('Sign in before importing applicants.');
    // Read the scoped local list directly so remote applicants are never copied into it.
    if (localStorage.getItem(scopedKey) === null) read(key);
    const records = JSON.parse(localStorage.getItem(scopedKey) || '[]');
    const emails = new Set();
    const phones = new Set();
    const names = new Set();
    const namesWithoutContact = new Set();
    function identity(record) {
      const email = String(record.email || '').trim().toLowerCase();
      const rawPhone = String(record.phone || '').trim().replace(/^'(?=[+-])/, '');
      const digits = /^[+()\d .-]+$/.test(rawPhone) ? rawPhone.replace(/\D/g, '') : '';
      const phone = digits.replace(/^(?:0063|63|0)?(9\d{9})$/, '$1');
      const name = String(record.name || '').normalize('NFC').toLowerCase().trim()
        .replace(/^([^,]+),\s*([^,]+)$/, '$2 $1').replace(/\s+/g, ' ');
      return {
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '',
        phone: phone.length >= 7 ? phone : '',
        name,
      };
    }
    function remember({ email, phone, name }) {
      if (email) emails.add(email);
      if (phone) phones.add(phone);
      if (name) {
        names.add(name);
        if (!email && !phone) namesWithoutContact.add(name);
      }
    }
    for (const record of [...records, ...(ATS.remoteApplicants || [])]) {
      if (String(record?.AdminID) !== String(verifiedAccount.AdminID)) continue;
      remember(identity(record));
      if (record.csvOriginalIdentity) remember(identity(record.csvOriginalIdentity));
    }
    const added = [];
    for (const row of rows) {
      const record = ATS.normalizeApplicant(row);
      const keys = identity(record);
      if (emails.has(keys.email) || phones.has(keys.phone) ||
          (keys.email || keys.phone ? namesWithoutContact : names).has(keys.name)) continue;
      remember(keys);
      added.push({ ...record, id: ATS.id(), AdminID: verifiedAccount.AdminID, status: row.Status, localCsv: true, addedAt: new Date().toISOString() });
    }
    if (added.length) {
      localStorage.setItem(scopedKey, JSON.stringify([...records, ...added]));
      window.dispatchEvent(new CustomEvent('ats:data-change', { detail: { key } }));
    }
    return added.length;
  };
  ATS.updateLocalApplicant = function (original, changes) {
    const key = 'ats_applicants';
    const scopedKey = recordStorageKey(key);
    if (!scopedKey) throw new Error('Sign in before saving an applicant.');
    const records = JSON.parse(localStorage.getItem(scopedKey) || '[]');
    const index = records.findIndex(record => record?.localCsv && record.id === original.id &&
      String(record.AdminID) === String(verifiedAccount.AdminID));
    const record = records[index];
    if (!record || JSON.stringify(record.db) !== JSON.stringify(original.db)) {
      throw new Error('This applicant changed in another tab. Reopen the editor and try again.');
    }
    const row = { ...record.db, ...changes };
    if (!row.Name?.trim()) throw new Error('Enter the applicant’s name.');
    records[index] = {
      ...record, ...ATS.normalizeApplicant(row), id: record.id, AdminID: record.AdminID,
      status: row.Status,
      csvOriginalIdentity: record.csvOriginalIdentity || {
        name: record.name, email: record.email, phone: record.phone,
      },
    };
    localStorage.setItem(scopedKey, JSON.stringify(records));
    window.dispatchEvent(new CustomEvent('ats:data-change', { detail: { key } }));
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
    const compact=matchMedia('(max-width: 1024px)'),main=document.querySelector('.main');
    const backdrop=document.createElement('button');backdrop.type='button';backdrop.className='mobile-nav-backdrop';backdrop.setAttribute('aria-label','Close navigation');backdrop.tabIndex=-1;backdrop.hidden=true;document.body.append(backdrop);
    function updateToggle() {
      const expanded=compact.matches?sidebar.classList.contains('mobile-expanded'):!sidebar.classList.contains('collapsed');
      toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-controls','sidebar');toggle.setAttribute('aria-label',expanded?'Collapse sidebar':'Expand sidebar');toggle.title=expanded?'Collapse sidebar':'Expand sidebar';
      const overlay=compact.matches&&expanded;backdrop.hidden=!overlay;document.body.classList.toggle('mobile-nav-open',overlay);if(main)main.inert=overlay;
    }
    function closeMobile(restore=false){sidebar.classList.remove('mobile-expanded');updateToggle();if(restore)toggle.focus();}
    updateToggle();
    toggle.addEventListener('click',()=>{
      if(compact.matches)sidebar.classList.toggle('mobile-expanded');else{sidebar.classList.toggle('collapsed');try{localStorage.setItem('ats_sidebar_collapsed',String(sidebar.classList.contains('collapsed')));}catch{}}
      updateToggle();
    });
    backdrop.addEventListener('click',()=>closeMobile(true));
    sidebar.addEventListener('click',event=>{if(compact.matches&&event.target.closest('a'))closeMobile();});
    document.addEventListener('keydown',event=>{
      if(!compact.matches||!sidebar.classList.contains('mobile-expanded'))return;
      if(event.key==='Escape'){event.preventDefault();closeMobile(true);}
      if(event.key==='Tab'){const controls=[...sidebar.querySelectorAll('a[href],button:not(:disabled)')].filter(node=>node.getClientRects().length&&!node.hidden);const first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    });
    compact.addEventListener('change',()=>closeMobile());
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
    avatar.setAttribute('role','button');avatar.setAttribute('aria-disabled','true');
    const parts = name.split(/\s+/);
    avatar.innerHTML = "<svg class=\"account-person-icon\" viewBox=\"0 0 64 64\" aria-hidden=\"true\"><circle cx=\"32\" cy=\"18\" r=\"11\"/><ellipse cx=\"32\" cy=\"47\" rx=\"22\" ry=\"13\"/></svg>";
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
  let loggingOut=false;
  document.getElementById('logoutBtn')?.addEventListener('click', async event => {
    event.preventDefault();
    if(loggingOut)return;loggingOut=true;event.currentTarget.setAttribute('aria-disabled','true');
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
  const profileStyles=document.createElement('link');profileStyles.rel='stylesheet';profileStyles.href='profile.css';document.head.append(profileStyles);
  const profileImages=document.createElement('script');profileImages.src='profile-images.js';profileImages.onload=()=>{const profileScript=document.createElement('script');profileScript.src='profile.js';document.head.append(profileScript);};document.head.append(profileImages);
  const companyStyles = document.createElement('link'); companyStyles.rel='stylesheet'; companyStyles.href='company.css'; document.head.append(companyStyles);
  const companyScript = document.createElement('script'); companyScript.src='company.js'; document.head.append(companyScript);
  const settingsStyles = document.createElement('link'); settingsStyles.rel = 'stylesheet'; settingsStyles.href = 'settings.css'; document.head.append(settingsStyles);
  const settingsScript = document.createElement('script'); settingsScript.src = 'settings.js'; document.head.append(settingsScript);
  settingsScript.addEventListener('load', () => {
    const invitations = document.createElement('script'); invitations.src = 'invitation-admin.js'; document.head.append(invitations);
  });
})();
