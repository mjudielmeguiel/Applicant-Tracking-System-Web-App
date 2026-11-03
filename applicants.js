(async function () {
  "use strict";
  if (!(await window.ATS.ready)) return;
  await window.ATS.catalogReady;
  await window.ATS.applicantsReady;

  const { read, save, escape: esc } = window.ATS;
  const key = "ats_applicants";
  const statuses = window.ATS.applicantStatuses;
  const statusTools = window.ApplicantStatusTools;
  const workflow = window.ApplicantWorkflow;
  const search = document.getElementById("applicantSearch");
  const filter = {value:""};
  const rows = document.getElementById("applicantRows");
  const dialog = document.getElementById("applicantDialog");
  const form = document.getElementById("applicantForm");
  const definitions = window.ApplicantFieldDefinitions,
    documentTypes = window.ApplicantDocumentTypes;
  const groups = [...new Set(definitions.map((f) => f.group))];
  const example=f=>({Name:'Juan Dela Cruz','Contact Number':'0917 123 4567','Email Address':'juan.delacruz@example.com','Current Address':'123 Mabini Street, Alabang, Muntinlupa',Remarks:'Example: Available for an interview on weekdays.','Ongoing Requirements Status':'Example: Awaiting NBI clearance.'}[f.column]||('Enter '+f.label.toLowerCase()));
  const controls = (definition) => {
    const f = definition,
      attrs = `id="${f.id}" data-applicant-field="${esc(f.column)}" class="field-input" ${f.column === "Submission Date" ? 'readonly aria-describedby="submissionDateHelp"' : ""} ${f.required ? "required" : ""} ${f.column === "Name" ? 'minlength="2"' : ""} ${f.type === "tel" ? 'pattern="[+()0-9 .-]{7,25}"' : ""}`;
    if(f.type==="gender")return `<select ${attrs}><option value="">Select gender</option><option>Male</option><option>Female</option></select>`;
    if (f.type === "response") return `<select ${attrs}><option value="Pending">Awaiting response / attendance</option><option value="Confirmed">Confirmed</option><option value="Attended">Attended</option><option value="Cancelled">Cancelled</option></select>`;
    if (["position", "site", "source", "status", "job"].includes(f.type))
      return `<select ${attrs}><option value="">Select ${esc(f.label)}</option></select>`;
    if (f.type === "textarea")
      return `<textarea ${attrs} rows="3" maxlength="${f.max}" placeholder="${esc(example(f))}"></textarea>`;
    return `<input ${attrs} type="${f.type}" placeholder="${esc(example(f))}" ${f.type === "number" ? 'min="1" step="1"' : `maxlength="${f.max}"`}>`;
  };
  form.querySelector(".dialog-body").innerHTML =
    '<p class="form-error" id="applicantFormError" role="alert" hidden></p><p class="applicant-company-note" id="applicantCompanyNote"></p>' +
    groups
      .map(
        (group) =>
          `<fieldset class="applicant-section"><legend>${esc(group)}</legend><div class="form-grid">` +
          definitions
            .filter((f) => f.group === group)
            .map(
              (f) =>
                `<div ${f.type === "hidden" ? "hidden" : ""} class="form-field ${f.type === "textarea" ? "span-2" : ""}"><label class="field-label" for="${f.id}">${esc(f.label)}${f.required ? " *" : ""}</label>${controls(f)}${f.column === "Submission Date" ? '<p id="submissionDateHelp" class="applicant-status-hint">Recorded automatically when submitted. This date cannot be changed.</p>' : ""}</div>`,
            )
            .join("") +
          "</div></fieldset>",
      )
      .join("") +
    '<fieldset class="applicant-section"><legend>Requirements & documents</legend><p class="section-subtitle">Choose a status for every requirement. Uploads are optional. Submitted, Verified, Accepted and Not required count as complete. PDF, JPG, PNG, DOC, DOCX · up to 10 MB per file.</p>' +
    documentTypes
      .map(
        (type, i) =>
          `<div class="applicant-document"><div><label class="field-label" for="requirement_${i}">${esc(type)} status / reference</label><select class="field-input" id="requirement_${i}" data-applicant-field="${esc(type)}" required><option>Pending</option><option>Submitted</option><option>Verified</option><option>Accepted</option><option>Rejected</option><option>Not required</option></select><div id="savedDocuments_${i}" class="saved-documents"></div></div><div><label class="field-label" for="upload_${i}">Upload ${esc(type)}</label><input id="upload_${i}" class="field-input" type="file" data-document-type="${esc(type)}" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"></div></div>`,
      )
      .join("") +
    '<div class="applicant-document applicant-id-photo"><div><h3>1×1 ID picture</h3><p class="section-subtitle">Square JPG/PNG · at least 300×300 pixels · up to 10 MB.</p><div id="idPhotoDocuments" class="saved-documents"></div></div><div><label class="field-label" for="idPhotoFile">Upload 1×1 ID picture</label><input class="field-input" id="idPhotoFile" type="file" accept=".jpg,.jpeg,.png"></div></div></fieldset>';
  const formError = document.getElementById("applicantFormError");
  const birthdate=form.querySelector('#applicantBirthdate');birthdate.max=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  birthdate.closest('.form-field').insertAdjacentHTML('afterend','<div class="form-field"><label class="field-label" for="applicantAge">Age</label><input id="applicantAge" class="field-input" readonly placeholder="Calculated from birthdate"></div>');
  function refreshAge(){const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),dob=birthdate.value;document.getElementById('applicantAge').value=dob&&dob<=today?Number(today.slice(0,4))-Number(dob.slice(0,4))-(today.slice(5)<dob.slice(5)?1:0):'';}
  birthdate.addEventListener('input',refreshAge);

  const requirementSummary=document.createElement('div');requirementSummary.className='requirement-summary';requirementSummary.setAttribute('aria-live','polite');
  form.querySelector('#requirement_0').closest('fieldset').querySelector('.section-subtitle').after(requirementSummary);
  let requirementPlan=null;
  function refreshRequirementProgress(){if(requirementPlan){const required=requirementPlan.requiredDocuments;const done=required.filter(type=>{const index=documentTypes.indexOf(type);const status=index>=0?document.getElementById('requirement_'+index).value:document.querySelector('[data-custom-status="'+CSS.escape(type)+'"]')?.value||requirementPlan.statuses[type];return /^(submitted|verified|accepted|not required)$/i.test(status||'');}).length;const percent=Math.round(done/required.length*100);requirementSummary.innerHTML='<strong>'+done+' of '+required.length+' requirements submitted</strong><span>'+percent+'%</span><div class="progress-track"><div class="progress-fill" style="width:'+percent+'%"></div></div><small>Uses this applicant’s required checklist, including HR confirmations and custom documents.</small>';return;}
const done=documentTypes.filter((type,i)=>{const value=document.getElementById('requirement_'+i).value;return value&&!/pending|missing|rejected|not submitted|not yet|follow.?up/i.test(value);}).length;const percent=Math.round(done/documentTypes.length*100);requirementSummary.innerHTML='<strong>'+(percent===100?'Requirements complete':done+' of '+documentTypes.length+' requirements complete')+'</strong><span>'+percent+'%</span><div class="progress-track" role="progressbar" aria-label="Requirements completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+percent+'"><div class="progress-fill" style="width:'+percent+'%"></div></div><small>'+(percent===100?'Completion date is recorded automatically when saved.':'Set a status for each requirement. Files can be attached later.')+'</small>';}
  form.addEventListener('change',refreshRequirementProgress);

  const fields = {
    name: document.getElementById("applicantName"),
    position: document.getElementById("applicantPosition"),
    job: document.getElementById("applicantJob"),
    source: document.getElementById("applicantSource"),
    site: document.getElementById("applicantSite"),
    email: document.getElementById("applicantEmail"),
    phone: document.getElementById("applicantPhone"),
    status: document.getElementById("applicantStatus"),
    dateApplied: document.getElementById("applicantDate"),
  };
  let editingId = null,
    currentRecord = null,
    draftId = null,
    saving = false,
    documents = [];
  const requirementSection=document.getElementById('idPhotoDocuments').closest('fieldset');
  const customize=document.createElement('button');customize.type='button';customize.id='customizeApplicantRequirements';customize.className='btn-sm ghost';customize.textContent='Customize applicant requirements';requirementSummary.after(customize);
  const customRows=document.createElement('div');customRows.id='customApplicantRequirements';requirementSection.append(customRows);
  const requirementEditor=document.createElement('dialog');requirementEditor.className='app-dialog';requirementEditor.id='applicantRequirementEditor';requirementEditor.innerHTML='<form id="applicantRequirementPlanForm"><div class="dialog-head"><div><h2>Customize applicant requirements</h2><p>Choose required documents, add document names, and record HR status for this applicant only.</p></div><button type="button" class="dialog-close" aria-label="Close requirements editor">×</button></div><div class="dialog-body"><div id="applicantRequirementPlanRows"></div><label class="field-label" for="newApplicantRequirement">New document name</label><div class="page-actions"><input class="field-input" id="newApplicantRequirement" maxlength="80" placeholder="e.g. Employment certificate"><button type="button" class="btn-sm ghost" id="addApplicantRequirement">Add requirement</button></div><p class="form-error" id="applicantRequirementPlanError" role="alert" hidden></p></div><div class="dialog-actions"><button type="submit" class="btn-sm primary">Save applicant requirements</button></div></form>';document.body.append(requirementEditor);
  let planBusy=false,planDraft=[];
  const requirementStatuses=['Pending','Submitted','Verified','Accepted','Rejected','Not required'];
  function renderPlanEditor(){document.getElementById('applicantRequirementPlanRows').innerHTML=planDraft.map((item,index)=>'<div class="applicant-plan-row"><label><input type="checkbox" data-plan-required="'+index+'" '+(item.required?'checked':'')+'> '+esc(item.name)+'</label><select class="field-input" aria-label="'+esc(item.name)+' HR status" data-plan-status="'+index+'">'+requirementStatuses.map(status=>'<option '+(item.status===status?'selected':'')+'>'+status+'</option>').join('')+'</select></div>').join('');}
  function readPlanEditor(){planDraft.forEach((item,index)=>{item.required=document.querySelector('[data-plan-required="'+index+'"]').checked;item.status=document.querySelector('[data-plan-status="'+index+'"]').value;});}
  function applyRequirementPlan(){if(!requirementPlan)return;documentTypes.forEach((type,index)=>{const row=document.getElementById('requirement_'+index).closest('.applicant-document');row.hidden=!requirementPlan.requiredDocuments.includes(type);const status=requirementPlan.statuses[type];if(status&&requirementStatuses.includes(status))document.getElementById('requirement_'+index).value=status;});document.querySelector('.applicant-id-photo').hidden=!requirementPlan.requiredDocuments.includes('ID PHOTO');customRows.innerHTML=requirementPlan.requiredDocuments.filter(type=>!documentTypes.includes(type)&&type!=='ID PHOTO').map((type,index)=>'<div class="applicant-document"><div><label class="field-label">'+esc(type)+' HR status</label><select class="field-input" data-custom-status="'+esc(type)+'">'+requirementStatuses.map(status=>'<option '+(requirementPlan.statuses[type]===status?'selected':'')+'>'+status+'</option>').join('')+'</select><div class="saved-documents">'+documents.filter(doc=>doc.document_type===type).map(documentRow).join('')+'</div></div><div><label class="field-label" for="customRequirementUpload_'+index+'">Upload '+esc(type)+'</label><input class="field-input" type="file" id="customRequirementUpload_'+index+'" data-custom-upload="'+esc(type)+'" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"></div></div>').join('');customRows.querySelectorAll('select').forEach(input=>input.onchange=refreshRequirementProgress);refreshRequirementProgress();}
  customize.onclick=async()=>{if(!currentRecord?.databaseId){A.notify('Save the applicant before customizing requirements.');return;}customize.disabled=true;try{const data=await A.rpc('ats_applicant_requirements',{p_session_token:session.sessionToken,p_applicant_id:currentRecord.databaseId});if(!Array.isArray(data.requiredDocuments))throw Error('The requirements checklist could not be loaded.');requirementPlan=data;const names=[...new Set([...documentTypes,'ID PHOTO',...data.requiredDocuments])];planDraft=names.map(name=>({name,required:data.requiredDocuments.includes(name),status:data.statuses[name]||'Pending'}));document.getElementById('applicantRequirementPlanError').hidden=true;renderPlanEditor();requirementEditor.showModal();}catch(error){A.notify(error.message);}finally{customize.disabled=false;}};
  requirementEditor.querySelector('.dialog-close').onclick=()=>{if(!planBusy)requirementEditor.close();};requirementEditor.oncancel=event=>{if(planBusy)event.preventDefault();};
  document.getElementById('addApplicantRequirement').onclick=()=>{readPlanEditor();const input=document.getElementById('newApplicantRequirement'),name=input.value.trim().toUpperCase();if(!name||planDraft.some(item=>item.name===name))return;planDraft.push({name,required:true,status:'Pending'});input.value='';renderPlanEditor();};
  document.getElementById('applicantRequirementPlanForm').onsubmit=async event=>{event.preventDefault();if(planBusy)return;readPlanEditor();const required=planDraft.filter(item=>item.required);const error=document.getElementById('applicantRequirementPlanError');if(!required.length){error.textContent='Choose at least one required document.';error.hidden=false;return;}planBusy=true;requirementEditor.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);try{requirementPlan=await A.rpc('ats_applicant_requirements',{p_session_token:session.sessionToken,p_applicant_id:currentRecord.databaseId,p_required:required.map(item=>item.name),p_statuses:Object.fromEntries(required.map(item=>[item.name,item.status]))});requirementEditor.close();await loadDocuments();await syncRequirementSummary();A.notify('Applicant requirements updated. Their application link uses the same checklist.');}catch(reason){error.textContent=reason.message;error.hidden=false;}finally{planBusy=false;requirementEditor.querySelectorAll('button,input,select').forEach(el=>el.disabled=false);}};

  const inviteExisting=document.createElement('button');inviteExisting.type='button';inviteExisting.id='inviteExistingApplicant';inviteExisting.className='btn-sm ghost';inviteExisting.textContent='Invite to complete details & requirements';inviteExisting.onclick=()=>{if(currentRecord?.databaseId){if(window.ATS.inviteExistingApplicant)window.ATS.inviteExistingApplicant(currentRecord);else A.notify('Invitation settings are still loading. Please try again.');}};document.getElementById('applicantCompanyNote').after(inviteExisting);
  const session = await window.ATS.ready;

  let jobChoices=[];
  const jobField=fields.job.closest('.form-field');jobField.classList.add('span-2','recruitment-job-field');
  const jobSearch=document.createElement('input');jobSearch.type='text';jobSearch.id='applicantJobSearch';jobSearch.className='field-input';jobSearch.placeholder='Search and select a job or site…';jobSearch.autocomplete='off';jobSearch.spellcheck=false;jobSearch.required=true;jobSearch.setAttribute('role','combobox');jobSearch.setAttribute('aria-autocomplete','list');jobSearch.setAttribute('aria-controls','applicantJobOptions');jobSearch.setAttribute('aria-expanded','false');
  jobField.querySelector('label').htmlFor=jobSearch.id;fields.job.hidden=true;fields.job.required=false;fields.job.tabIndex=-1;fields.job.setAttribute('aria-hidden','true');
  const picker=document.createElement('div');picker.className='applicant-job-picker';fields.job.before(picker);picker.append(jobSearch);
  const arrow=document.createElement('button');arrow.type='button';arrow.className='job-picker-toggle';arrow.setAttribute('aria-label','Show available jobs');arrow.setAttribute('aria-controls','applicantJobOptions');arrow.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';picker.append(arrow);
  const jobList=document.createElement('div');jobList.id='applicantJobOptions';jobList.className='job-picker-options';jobList.setAttribute('role','listbox');jobList.setAttribute('aria-label','Available jobs grouped by site');jobList.hidden=true;picker.append(jobList);
  const grid=jobField.parentElement;[jobField,fields.dateApplied.closest('.form-field'),form.querySelector('[data-applicant-field="Submission Date"]').closest('.form-field'),fields.source.closest('.form-field'),fields.status.closest('.form-field')].forEach(block=>grid.append(block));
  let pickerOpen=false,query='',committed='',matches=[],active=-1;
  const normalized=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function positionPicker(){if(!pickerOpen)return;const box=form.querySelector('.dialog-body').getBoundingClientRect(),input=jobSearch.getBoundingClientRect();const below=box.bottom-input.bottom-12,above=input.top-box.top-12,up=below<180&&above>below;picker.classList.toggle('opens-up',up);jobList.style.maxHeight=Math.max(96,Math.min(280,up?above:below))+'px';}
  function activate(index){active=Math.max(0,Math.min(matches.length-1,index));jobList.querySelectorAll('[role=option]').forEach((node,i)=>node.classList.toggle('is-active',i===active));if(matches[active]){const id='job-option-'+active;jobSearch.setAttribute('aria-activedescendant',id);jobList.querySelector('#'+id)?.scrollIntoView({block:'nearest'});}else jobSearch.removeAttribute('aria-activedescendant');}
  function renderJobOptions(){
    const words=normalized(query).trim().split(/\s+/).filter(Boolean);matches=[...fields.job.options].filter(option=>option.value&&words.every(word=>normalized(option.textContent).includes(word)));
    let site='';jobList.innerHTML=matches.map((option,index)=>{const job=jobChoices.find(item=>item.id===option.value),location=job?.site||currentRecord?.site||'Current assignment';let header='';if(location!==site){site=location;header='<div class="job-picker-site" role="presentation">'+esc(location)+'</div>';}return header+'<div class="job-picker-option" id="job-option-'+index+'" role="option" aria-selected="'+(option.value===committed)+'" data-job-choice="'+esc(option.value)+'"><span><strong>'+esc(job?.position_title||currentRecord?.position||option.textContent)+'</strong><small>'+esc(location)+'</small></span><span class="job-picker-slots">'+(job?job.remaining_slots+' available':'Saved assignment')+'</span></div>';}).join('')||'<p class="job-picker-empty">No available jobs match your search.</p>';active=-1;jobSearch.removeAttribute('aria-activedescendant');positionPicker();
  }
  function closeJobPicker(restore=true){pickerOpen=false;jobList.hidden=true;jobSearch.setAttribute('aria-expanded','false');jobSearch.removeAttribute('aria-activedescendant');if(restore){fields.job.value=committed;jobSearch.value=fields.job.selectedOptions[0]?.value?fields.job.selectedOptions[0].textContent:'';jobSearch.setCustomValidity(fields.job.value?'':'Choose an available job and site.');}query='';}
  function openJobPicker(){if(jobSearch.disabled)return;pickerOpen=true;query='';jobList.hidden=false;jobSearch.setAttribute('aria-expanded','true');renderJobOptions();}
  function refreshJobPicker(){committed=fields.job.value;if(!pickerOpen||!query){jobSearch.value=committed?fields.job.selectedOptions[0]?.textContent||'':'';jobSearch.setCustomValidity(committed?'':'Choose an available job and site.');}if(pickerOpen)renderJobOptions();}
  function chooseJob(value){fields.job.value=value;committed=value;fields.job.dispatchEvent(new Event('change',{bubbles:true}));query='';refreshJobPicker();closeJobPicker();jobSearch.focus();}
  jobSearch.addEventListener('focus',()=>{openJobPicker();jobSearch.select();});jobSearch.addEventListener('click',()=>{if(!pickerOpen)openJobPicker();});
  jobSearch.oninput=()=>{query=jobSearch.value;fields.job.value='';jobSearch.setCustomValidity('Choose a matching job and site from the list.');pickerOpen=true;jobList.hidden=false;jobSearch.setAttribute('aria-expanded','true');renderJobOptions();};
  arrow.onclick=()=>{if(pickerOpen)closeJobPicker();else{jobSearch.focus();openJobPicker();jobSearch.select();}};
  jobList.addEventListener('pointerdown',event=>event.preventDefault());jobList.onclick=event=>{const option=event.target.closest('[data-job-choice]');if(option)chooseJob(option.dataset.jobChoice);};
  jobSearch.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&& (pickerOpen||event.key.startsWith('Arrow'))){event.preventDefault();if(!pickerOpen)openJobPicker();activate(event.key==='Home'?0:event.key==='End'?matches.length-1:active+(event.key==='ArrowUp'?-1:1));}else if(event.key==='Enter'){event.preventDefault();if(!pickerOpen)openJobPicker();else if(matches.length)chooseJob(matches[active<0?0:active].value);}else if(event.key==='Escape'&&pickerOpen){event.preventDefault();event.stopPropagation();closeJobPicker();}else if(event.key==='Tab')closeJobPicker();});
  document.addEventListener('pointerdown',event=>{if(pickerOpen&&!picker.contains(event.target))closeJobPicker();});picker.addEventListener('focusout',()=>setTimeout(()=>{if(pickerOpen&&!picker.contains(document.activeElement))closeJobPicker();},0));dialog.addEventListener('close',()=>closeJobPicker(false));form.querySelector('.dialog-body').addEventListener('scroll',positionPicker);window.addEventListener('resize',positionPicker);
  function fillJobs(record=currentRecord){
    record=record?.id?record:currentRecord;
    const selected=fields.job.value||committed;
    const current=record?.db?.JobOpeningID||jobChoices.find(job=>job.position_title===record?.position&&job.site===record?.site)?.id;
    const choices=jobChoices.filter(job=>(job.remaining_slots>0||job.id===current));
    choices.sort((a,b)=>a.site.localeCompare(b.site)||a.position_title.localeCompare(b.position_title));
    fields.job.innerHTML='<option value="">Select an available job and site</option>'+choices.map(job=>'<option value="'+esc(job.id)+'">'+esc(job.site)+' — '+esc(job.position_title)+' · '+job.remaining_slots+' slots available'+(job.remaining_slots===0?' · Current assignment':'')+'</option>').join('');
    if(record&&!current)fields.job.add(new Option((record.site||'No site recorded')+' — '+record.position+' · Current saved assignment','legacy-current'));
    fields.job.value=choices.some(job=>job.id===selected)?selected:current&&choices.some(job=>job.id===current)?current:record&&!current?'legacy-current':'';
    const job=jobChoices.find(job=>job.id===fields.job.value);if(job){fields.position.value=job.position_title;fields.site.value=job.site;}refreshJobPicker();
  }
  async function reloadJobs(){const result=await window.ATS.rpc('ats_jobs_list',{p_session_token:session.sessionToken});if(String(result.AdminID)!==String(session.AdminID)||!Array.isArray(result.jobs))throw Error('Available jobs could not be verified.');jobChoices=result.jobs;fillJobs();}
  function fillChoices(record){
    const selected=record?.source||fields.source.value;fields.source.innerHTML='<option value="">Select source</option>'+(window.ATS.catalogs?.sources||[]).map(row=>'<option value="'+esc(row.name)+'">'+esc(row.name)+'</option>').join('');if(selected&&![...fields.source.options].some(option=>option.value===selected))fields.source.add(new Option(selected+' (saved value)',selected));fields.source.value=selected;fillJobs(record||currentRecord);
  }
  fields.job.addEventListener('change',()=>{const job=jobChoices.find(job=>job.id===fields.job.value);if(job){fields.position.value=job.position_title;fields.site.value=job.site;}fields.job.setCustomValidity('');});
  try{await reloadJobs();}catch(error){window.ATS.notify(error.message);}
  fillChoices();
  window.addEventListener("ats:catalogs-changed", () => fillChoices());
  window.addEventListener("ats:data-change", () => fillChoices());

  const options = statuses
    .map((status) => `<option value="${esc(status)}">${esc(status)}</option>`)
    .join("");
  fields.status.innerHTML = '<option value="">Select status</option>' + options;
  const pageUrl = new URL(window.location.href);
  if (statuses.includes(pageUrl.searchParams.get("status")))
    filter.value = pageUrl.searchParams.get("status");

  function applicants() {
    return read(key).filter(
      (record) => record && typeof record === "object" && record.id,
    );
  }

  function matchingApplicants() {
    const term = search.value.trim().toLowerCase();
    return applicants()
      .filter((record) => {
        const matchesSearch = [
          record.name,
          record.position,
          record.source,
          record.site,
          record.email,
          record.phone,
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(term),
        );
        return (
          matchesSearch &&
          (!filter.value ||
            statusTools.group(record.status) ===
              statusTools.group(filter.value))
        );
      })
      .sort(
        (a, b) =>
          String(b.dateApplied || "").localeCompare(
            String(a.dateApplied || ""),
          ) || String(a.name || "").localeCompare(String(b.name || "")),
      );
  }

  const statusTone = window.ATS.applicantStatusTone;

  function render() {
    const loadError = document.getElementById("applicantLoadError");
    loadError.hidden = !window.ATS.applicantsError;
    if (window.ATS.applicantsError)
      loadError.textContent =
        "Could not refresh Supabase applicants: " +
        window.ATS.applicantsError.message;
    const all = applicants();
    const visible = matchingApplicants();
    statusTools.renderCards(
      document.getElementById("applicantStatusCards"),
      all,
      filter,
      render,
    );
    const now = new Date();
    const monthParts = new Intl.DateTimeFormat('en',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit'}).formatToParts(now);
    const monthKey = monthParts.find(part=>part.type==='year').value+'-'+monthParts.find(part=>part.type==='month').value;
    document.getElementById('hiredMonth').textContent = new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'long',year:'numeric'}).format(now);
    document.getElementById("hiredApplicants").textContent = all.filter(
      (record) => String(record.db?.['DATE HIRED'] || record['DATE HIRED'] || record.hiredDate || '').slice(0,7) === monthKey,
    ).length;
    document.getElementById("applicantCount").textContent =
      `Showing ${visible.length} of ${all.length} applicant${all.length === 1 ? "" : "s"}`;
    document.getElementById("exportApplicants").disabled = visible.length === 0;
    if (!visible.length) {
      rows.innerHTML = `<tr><td class="empty-state" colspan="7">${all.length ? "No applicants match your filters. Try a different search or clear the filters." : "No applicants yet. Select “Add Applicant” to create your first record."}</td></tr>`;
      return;
    }
    rows.innerHTML = visible
      .map((record) => {
        const progress = Math.max(
          0,
          Math.min(100, Number(record.requirements) || 0),
        );
        const shortId =
          record.databaseId || String(record.id).slice(-6).toUpperCase();
        return `<tr>
        <td><div class="applicant-person"><span class="applicant-photo" data-applicant-photo="${esc(record.databaseId||'')}" data-name="${esc(record.name||'Applicant')}">${esc((record.name||'A').trim().slice(0,2).toUpperCase())}</span><div><span class="applicant-name">${esc(record.name || "Unnamed applicant")}</span><span class="applicant-ref">#${esc(shortId)}</span><span class="applicant-added-by">Added by ${esc(record.db?.AddedByName||"Recruitment team")}</span></div></div></td>
        <td>${esc(record.position || "—")}<span class="applicant-ref">${esc([record.source, record.site].filter(Boolean).join(" · "))}</span></td>
        <td>${esc(record.phone || "—")}${record.email ? `<span class="applicant-email">${esc(record.email)}</span>` : ""}</td>
        <td><span class="record-badge ${statusTone(record.status)}">${esc(record.status || "Not recorded")}</span><button type="button" class="applicant-requirements-status" data-requirement-activity="${esc(record.id)}"><span>Ongoing requirements status ↗</span>${esc(String(record.db?.["Ongoing Requirements Status"] || record["Ongoing Requirements Status"] || "").trim() || "View requirements updates")}</button></td>
        <td class="applicant-dates-cell">${statusTools.dates(record)}</td>
        <td class="requirements-cell"><span>${progress === 100 ? "Complete · 100%" : progress + "%"}</span><div class="progress-track" role="progressbar" aria-label="Requirements for ${esc(record.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><div class="progress-fill" style="width:${progress}%"></div></div></td>
        <td><div class="applicant-row-actions"><button type="button" class="btn-sm applicant-manage" data-edit="${esc(record.id)}" aria-label="Manage ${esc(record.name)}">Manage applicant <span aria-hidden="true">↗</span></button></div></td>
      </tr>`;
      })
      .join("");
    showApplicantPhotos();
  }

  const A = window.ATS;
  let applicantPhotos=new Map();const photoUrls=new Map();
  const photoObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;photoObserver.unobserve(entry.target);const node=entry.target,doc=applicantPhotos.get(node.dataset.applicantPhoto);if(!doc)continue;const cached=photoUrls.get(doc);const request=cached&&cached.until>Date.now()?Promise.resolve(cached.url):documentRequest({action:'preview',sessionToken:session.sessionToken,documentId:doc}).then(result=>{const url=new URL(result.url);if(url.origin!=='https://wqshrjlcjqbjqcophvfv.supabase.co')throw Error('Invalid photo URL');photoUrls.set(doc,{url:url.href,until:Date.now()+45000});return url.href;});request.then(url=>{if(!node.isConnected||applicantPhotos.get(node.dataset.applicantPhoto)!==doc)return;const img=document.createElement('img');img.src=url;img.alt=node.dataset.name+' 1×1 ID picture';img.onerror=()=>{node.textContent=node.dataset.name.slice(0,2).toUpperCase();};node.replaceChildren(img);}).catch(()=>{});}});
  function showApplicantPhotos(){photoObserver.disconnect();rows.querySelectorAll('[data-applicant-photo]').forEach(node=>{if(applicantPhotos.has(node.dataset.applicantPhoto))photoObserver.observe(node);else node.textContent=(node.dataset.name||'A').slice(0,2).toUpperCase();});}
  async function loadApplicantPhotos(){try{const result=await A.rpc('ats_applicant_photos',{p_session_token:session.sessionToken});if(String(result.AdminID)!==String(session.AdminID)||!Array.isArray(result.photos))return;applicantPhotos=new Map(result.photos.map(row=>[String(row.applicantId),row.documentId]));showApplicantPhotos();}catch{}}
  function localDatetime(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return (
      A.dateKey(d) +
      "T" +
      String(d.getHours()).padStart(2, "0") +
      ":" +
      String(d.getMinutes()).padStart(2, "0")
    );
  }
  function legacyRow(record) {
    return (
      record?.db || {
        Name: record?.name,
        Position: record?.position,
        Source: record?.source,
        Site: record?.site,
        "Email Address": record?.email,
        "Contact Number": record?.phone,
        Status: record?.status,
        Date: record?.dateApplied,
      }
    );
  }
  async function documentRequest(payload) {
    const body =
      payload instanceof FormData ? payload : JSON.stringify(payload);
    const response = await fetch(
      "https://wqshrjlcjqbjqcophvfv.supabase.co/functions/v1/applicant-documents",
      {
        method: "POST",
        headers: {
          apikey: "sb_publishable_2QWxapvC5t_KHq-0u35d1w_kK-ah1eN",
          ...(payload instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body,
      },
    );
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Document request failed.");
    return result;
  }
  async function loadDocuments() {
    const requestedApplicant=currentRecord?.databaseId;
    documents = currentRecord?.databaseId
      ? await A.rpc("ats_applicant_documents", {
          p_session_token: session.sessionToken,
          p_applicant_id: currentRecord.databaseId,
        })
      : [];
    if(currentRecord?.databaseId!==requestedApplicant)return;
    if(requestedApplicant){const plan=await A.rpc("ats_applicant_requirements",{p_session_token:session.sessionToken,p_applicant_id:requestedApplicant});if(currentRecord?.databaseId!==requestedApplicant)return;requirementPlan=Array.isArray(plan?.requiredDocuments)?plan:null;}
    documentTypes.forEach((type, i) => {
      document.getElementById("savedDocuments_" + i).innerHTML = documents
        .filter((doc) => doc.document_type === type)
        .map(documentRow)
        .join("");
      const latest = documents.find(doc => doc.document_type === type && doc.latest !== false);
      if (latest) document.getElementById('requirement_' + i).value = latest.review_status || 'Submitted';
    });
    refreshRequirementProgress();
    document.getElementById('idPhotoDocuments').innerHTML = documents.filter(doc => doc.document_type === 'ID PHOTO').map(documentRow).join('');applyRequirementPlan();
  }
  function documentRow(doc) {
    return '<div class="saved-document review-document"><span>'+esc(doc.filename)+' <small>'+Math.ceil(doc.byte_size/1024)+' KB · '+esc(doc.review_status||'Submitted')+(doc.latest===false?' · Previous upload':'')+(doc.automated?' · Automatic check':'')+'</small>'+(doc.review_comment?'<small class="document-review-comment">'+esc(doc.review_comment)+'</small>':'')+'</span><div class="document-actions"><button type="button" class="link-btn" data-preview-document="'+esc(doc.id)+'" '+(!['application/pdf','image/png','image/jpeg'].includes(doc.mime_type)?'disabled':'')+'>View document</button><button type="button" class="link-btn" data-download-document="'+esc(doc.id)+'">Download</button>'+(doc.latest!==false?'<button type="button" class="link-btn" data-review-document="'+esc(doc.id)+'">Review / comment</button>':'')+'<button type="button" class="link-btn" data-remove-document="'+esc(doc.id)+'">Remove</button></div></div>';
  }
  async function syncRequirementSummary() {
    await A.reloadApplicants();
    const updated=A.remoteApplicants.find(row=>row.databaseId===currentRecord?.databaseId);
    if(!updated)return;
    for(const key of ['Ongoing Requirements Status','REQUIREMENTS COMPLETION DATE']){
      const input=form.querySelector('[data-applicant-field="'+key+'"]');if(input)input.value=updated.db[key]||'';
    }
  }
  const previewDialog=document.createElement('dialog');previewDialog.className='app-dialog document-preview-dialog';
  previewDialog.innerHTML='<div class="dialog-head"><h2>Document preview</h2><button type="button" class="dialog-close" aria-label="Close preview">×</button></div><div class="dialog-body"></div>';
  document.body.append(previewDialog);let previewUrl='';
  previewDialog.querySelector('button').onclick=()=>previewDialog.close();
  previewDialog.addEventListener('close',()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';previewDialog.querySelector('.dialog-body').replaceChildren();});
  async function previewDocument(doc){
    const result=await documentRequest({action:'preview',sessionToken:session.sessionToken,documentId:doc.id});
    const url=new URL(result.url);if(url.origin!=='https://wqshrjlcjqbjqcophvfv.supabase.co')throw Error('Invalid private preview URL.');
    const response=await fetch(url);if(!response.ok)throw Error('Preview could not be loaded.');
    if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(await response.blob());
    const element=document.createElement(doc.mime_type==='application/pdf'?'iframe':'img');
    element.src=previewUrl;if(element instanceof HTMLImageElement)element.alt=doc.filename;else element.title=doc.filename;
    previewDialog.querySelector('h2').textContent=doc.filename;previewDialog.querySelector('.dialog-body').replaceChildren(element);previewDialog.showModal();
  }
  const reviewDialog=document.createElement('dialog');reviewDialog.className='app-dialog';reviewDialog.id='documentReviewDialog';
  reviewDialog.innerHTML='<form><div class="dialog-head"><h2>Review requirement</h2><button type="button" class="dialog-close" aria-label="Close review">×</button></div><div class="dialog-body"><p id="reviewFilename"></p><label class="field-label" for="documentReviewStatus">Review status</label><select id="documentReviewStatus" class="field-input"><option>Submitted</option><option>Accepted</option><option>Rejected</option></select><label class="field-label" for="documentReviewComment">Comment / replacement instructions</label><textarea id="documentReviewComment" class="field-input" maxlength="2000" placeholder="Example: The SSS image is blurry. Please upload a clearer image."></textarea><p class="section-subtitle">Rejected files require a comment. Rejection reopens this requirement on the applicant link.</p><p class="form-error" role="alert" hidden></p></div><div class="dialog-actions"><button type="submit" class="btn-sm primary">Save review</button></div></form>';
  document.body.append(reviewDialog);let reviewingDocument=null;
  reviewDialog.querySelector('.dialog-close').onclick=()=>reviewDialog.close();
  reviewDialog.querySelector('#documentReviewStatus').onchange=()=>{reviewDialog.querySelector('#documentReviewComment').required=reviewDialog.querySelector('#documentReviewStatus').value==='Rejected';};
  reviewDialog.querySelector('form').onsubmit=async event=>{
    event.preventDefault();if(!reviewingDocument)return;const button=event.submitter,error=reviewDialog.querySelector('.form-error');button.disabled=true;error.hidden=true;
    try{
      await A.rpc('ats_document_review',{p_session_token:session.sessionToken,p_document_id:reviewingDocument.id,p_status:reviewDialog.querySelector('#documentReviewStatus').value,p_comment:reviewDialog.querySelector('#documentReviewComment').value.trim()});
      await loadDocuments();await syncRequirementSummary();render();reviewDialog.close();A.notify('Requirement review saved.');
    }catch(reason){error.textContent=reason.message;error.hidden=false;}finally{button.disabled=false;}
  };
  function openForm(record) {
    if (saving) return;
    currentRecord = record || null;
    editingId = record?.id || null;
    draftId = record?.id || A.id();
    form.reset();closeJobPicker(false);committed='';
    fillChoices(record || {});
    formError.hidden = true;
    formError.textContent = "";
    const row = legacyRow(record);
    definitions.forEach((f) => {
      const input = document.getElementById(f.id);
      let value = row[f.column] ?? "";
      if (f.type === "datetime-local") value = f.column === "ScheduleDate" && value ? new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,16) : localDatetime(value);
      if(f.column==="Gender"){const gender=String(value).trim().toLowerCase();value=["male","m"].includes(gender)?"Male":["female","f"].includes(gender)?"Female":"";}
      input.value = value;
    });
    jobSearch.value="";fillChoices(record||{});
    fields.dateApplied.value = fields.dateApplied.value || A.today();
    const submission=form.querySelector('[data-applicant-field="Submission Date"]');
    if(!submission.value){const original=record?.db?.Date;const parts=new Intl.DateTimeFormat('en',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(original?new Date(original):new Date());const get=type=>parts.find(part=>part.type===type)?.value;submission.value=get('year')+'-'+get('month')+'-'+get('day');}
    fields.status.value = statuses.includes(row.Status) ? row.Status : (statuses.find(status => statusTools.group(status) === statusTools.group(row.Status)) || "");
    statusTools.formOpened();
    requirementPlan=null;customRows.replaceChildren();documentTypes.forEach((type,index)=>document.getElementById("requirement_"+index).closest(".applicant-document").hidden=false);document.querySelector(".applicant-id-photo").hidden=false;
    documentTypes.forEach((type, i) => {
      const input=document.getElementById("requirement_"+i),value=row[type]||'Pending';
      [...input.options].filter(option=>option.dataset.legacy).forEach(option=>option.remove());
      if(![...input.options].some(option=>option.value===value)){const option=new Option(value,value);option.dataset.legacy='true';input.add(option);}input.value=value;
      document.getElementById("savedDocuments_" + i).textContent = "";
    });
    document.getElementById("applicantDialogTitle").textContent = record
      ? "Applicant details & documents"
      : "Add applicant";
    document.getElementById("saveApplicant").textContent = record
      ? "Save changes & uploads"
      : "Save applicant & documents";
    document.getElementById('applicantCompanyNote').textContent='AdminID '+session.AdminID+' · Applicant details and documents are shared only within this workspace.';
    inviteExisting.hidden=!record?.databaseId;workflow.open(record);refreshRequirementProgress();refreshAge();
    A.openDialog(dialog);
    fields.name.focus();
    reloadJobs().catch(error=>{formError.textContent=error.message;formError.hidden=false;});
    loadDocuments().catch((error) => {
      formError.textContent =
        "Existing documents could not load: " + error.message;
      formError.hidden = false;
    });
  }
  function lockForm(value) {
    saving = value;
    form.querySelectorAll("input,select,textarea,button").forEach((c) => {
      c.disabled = value;
    });
    if (!value) workflow.refresh();
  }
  dialog.addEventListener("cancel", (event) => {
    if (saving) event.preventDefault();
  });
  dialog.addEventListener("click", (event) => {
    if (saving) event.stopPropagation();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving) return;
    formError.hidden = true;
    if (!workflow.validate()) return;
    const contactError = statusTools.validateContacts(
      currentRecord,
      applicants(),
    );
    if (contactError) {
      formError.textContent = contactError;
      formError.hidden = false;
      return;
    }
    const selected = documentTypes
      .map((type, i) => ({
        type,
        index: i,
        file: document.getElementById("upload_" + i).files[0],
      }))
      .filter((item) => item.file);
    form.querySelectorAll('[data-custom-upload]').forEach(input=>{if(input.files[0])selected.push({type:input.dataset.customUpload,index:-2,inputId:input.id,file:input.files[0]});});
    selected.forEach(item => item.inputId = item.inputId || 'upload_' + item.index);
    if (document.getElementById('idPhotoFile').files[0]) selected.push({type:'ID PHOTO',index:-1,inputId:'idPhotoFile',file:document.getElementById('idPhotoFile').files[0]});
    for (const { file } of selected) {
      if (
        file.size < 1 ||
        file.size > 10485760 ||
        !/\.(pdf|jpe?g|png|docx?)$/i.test(file.name)
      ) {
        formError.textContent =
          "Choose PDF, JPG, PNG, DOC, or DOCX files up to 10 MB each.";
        formError.hidden = false;
        return;
      }
    }
    const changes = {};
    definitions.forEach((f) => {
      const value = document.getElementById(f.id).value.trim();
      changes[f.column] = !value
        ? null
        : f.type === "number"
          ? Number(value)
          : f.type === "datetime-local"
            ? new Date(f.column === "ScheduleDate" ? value + (value.length === 16 ? ":00" : "") + "+08:00" : value).toISOString()
            : value;
    });
    documentTypes.forEach((type, i) => {
      changes[type] =
        document.getElementById("requirement_" + i).value.trim() || null;
    });
    if(changes.JobOpeningID==="legacy-current")delete changes.JobOpeningID;
    if (!workflow.prepareChanges(changes)) return;
    if (currentRecord?.databaseId) changes.ExpectedStageVersion = Number(currentRecord.db?.StageVersion || 0);
    lockForm(true);
    document.getElementById("saveApplicant").textContent =
      "Saving applicant to Supabase…";
    let detailsSaved = false;
    try {
      const row = await A.rpc("ats_applicant_save", {
        p_session_token: session.sessionToken,
        p_changes: changes,
        p_applicant_id: currentRecord?.databaseId || null,
        p_client_id: draftId,
      });
      if (!row?.ApplicantID || String(row.AdminID) !== String(session.AdminID))
        throw Error("Supabase did not confirm the saved applicant.");
      currentRecord = A.normalizeApplicant(row);
      editingId = currentRecord.id;
      detailsSaved = true;
      A.remoteApplicants = [
        ...(A.remoteApplicants || []).filter(
          (item) => String(item.id) !== String(currentRecord.id),
        ),
        currentRecord,
      ];
      render();
      window.dispatchEvent(
        new CustomEvent("ats:data-change", { detail: { key } }),
      );
      if(requirementPlan){const statuses=Object.fromEntries([...customRows.querySelectorAll('[data-custom-status]')].map(input=>[input.dataset.customStatus,input.value]));if(Object.keys(statuses).length)await A.rpc('ats_applicant_requirements',{p_session_token:session.sessionToken,p_applicant_id:row.ApplicantID,p_required:requirementPlan.requiredDocuments,p_statuses:statuses});}
      const automaticRejections = [];
      for (let n = 0; n < selected.length; n++) {
        const item = selected[n];
        document.getElementById("saveApplicant").textContent =
          "Uploading " +
          item.type +
          " (" +
          (n + 1) +
          "/" +
          selected.length +
          ")…";
        const upload = new FormData();
        upload.set("sessionToken", session.sessionToken);
        upload.set("applicantId", String(row.ApplicantID));
        upload.set("documentType", item.type);
        upload.set("file", item.file);
        const result = await documentRequest(upload);
        if (!result.saved)
          throw Error("Upload was not confirmed for " + item.type);
        document.getElementById(item.inputId).value = "";
        const status = document.getElementById("requirement_" + item.index);
        if (status) status.value = result.review_status || "Submitted";
        if (result.review_status === 'Rejected') automaticRejections.push(item.type + ': ' + result.review_comment);
      }
      if (automaticRejections.length) throw Error('Images automatically rejected: ' + automaticRejections.join('; '));
      await Promise.all([A.reloadApplicants(), A.reloadCatalogs()]);
      render();
      A.closeDialog(dialog);
      A.notify(
        selected.length
          ? "Applicant and " +
              selected.length +
              " document(s) saved to Supabase."
          : "Applicant saved to Supabase.",
      );
      window.dispatchEvent(new Event("ats:activity-refresh"));
    } catch (error) {
      formError.textContent =
        (detailsSaved
          ? "Applicant details were saved. Keep this form open and retry any remaining uploads. "
          : "") + statusTools.serverError(error);
      formError.hidden = false;
      if (detailsSaved) {await loadDocuments().catch(() => {});await syncRequirementSummary().catch(() => {});}
    } finally {
      lockForm(false);
      document.getElementById("saveApplicant").textContent =
        currentRecord?.databaseId
          ? "Save changes & uploads"
          : "Save applicant & documents";
    }
  });
  form.addEventListener("click", async (event) => {
    const preview=event.target.closest('[data-preview-document]'),review=event.target.closest('[data-review-document]');
    if(preview||review){
      if(saving)return;const doc=documents.find(item=>item.id===(preview?.dataset.previewDocument||review?.dataset.reviewDocument));if(!doc)return;
      try{
        if(preview)await previewDocument(doc);
        else{reviewingDocument=doc;reviewDialog.querySelector('#reviewFilename').textContent=doc.filename;reviewDialog.querySelector('#documentReviewStatus').value=doc.review_status||'Submitted';reviewDialog.querySelector('#documentReviewComment').value=doc.review_comment||'';reviewDialog.querySelector('#documentReviewComment').required=doc.review_status==='Rejected';reviewDialog.querySelector('.form-error').hidden=true;reviewDialog.showModal();}
      }catch(reason){formError.textContent=reason.message;formError.hidden=false;}
      return;
    }
    const download = event.target.closest("[data-download-document]"),
      remove = event.target.closest("[data-remove-document]");
    if ((!download && !remove) || saving) return;
    const doc = documents.find(
      (item) =>
        item.id ===
        (download?.dataset.downloadDocument || remove?.dataset.removeDocument),
    );
    if (!doc) return;
    if (
      remove &&
      !confirm("Permanently remove " + doc.filename + " from this applicant?")
    )
      return;
    try {
      const result = await documentRequest({
        action: remove ? "delete" : "download",
        sessionToken: session.sessionToken,
        documentId: doc.id,
      });
      if (remove) {
        if (!result.removed) throw Error("Removal was not confirmed.");
        await loadDocuments();
        A.notify("Document removed.");
        window.dispatchEvent(new Event("ats:activity-refresh"));
      } else {
        const url = new URL(result.url);
        if (url.origin !== "https://wqshrjlcjqbjqcophvfv.supabase.co")
          throw Error("Invalid document download URL.");
        const response = await fetch(url);
        if (!response.ok)
          throw Error("Document download failed. Please try again.");
        const blob = await response.blob(),
          objectUrl = URL.createObjectURL(blob),
          link = document.createElement("a");
        link.href = objectUrl;
        link.download = result.filename || doc.filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    } catch (error) {
      formError.textContent = error.message;
      formError.hidden = false;
    }
  });
  statusTools.initForm();
  workflow.init({form, dialog, session});
  document.getElementById("addApplicant").disabled = false;
  document
    .getElementById("refreshApplicants")
    .addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await Promise.all([A.reloadApplicants(), A.reloadCatalogs()]);
      } catch (error) {
        A.applicantsError = error;
      } finally {
        button.disabled = false;
        render();
      }
    });

  fields.name.addEventListener("input", () =>
    fields.name.setCustomValidity(""),
  );
  fields.position.addEventListener("input", () =>
    fields.position.setCustomValidity(""),
  );
  document
    .getElementById("addApplicant")
    .addEventListener("click", () => openForm());
  ["closeApplicantDialog", "cancelApplicantDialog"].forEach((id) => {
    document
      .getElementById(id)
      .addEventListener("click", () => window.ATS.closeDialog(dialog));
  });
  rows.addEventListener("click", (event) => {
    const activityButton=event.target.closest('[data-requirement-activity]');if(activityButton){const record=applicants().find(item=>String(item.id)===activityButton.dataset.requirementActivity);if(record)A.openRequirementActivity?.(record.databaseId,record.name);return;}
    const editButton = event.target.closest("[data-edit],[data-view-documents]");
    if (!editButton) return;
    const record = applicants().find(
      (item) => String(item.id) === (editButton.dataset.edit||editButton.dataset.viewDocuments),
    );
    if(record){openForm(record);if(editButton.dataset.viewDocuments)workflow.showDocuments();}
  });
  search.addEventListener("input", render);
  document
    .getElementById("clearApplicantFilters")
    .addEventListener("click", () => {
      search.value = "";
      filter.value = "";
      render();
      search.focus();
    });

  document.getElementById("exportApplicants").addEventListener("click", () => {
    const visible = matchingApplicants();
    if (!visible.length) return;
    const columns = [
      ["ID", "id"],
      ["Name", "name"],
      ["Position", "position"],
      ["Source", "source"],
      ["Location", "site"],
      ["Email", "email"],
      ["Contact number", "phone"],
      ["Status", "status"],
      ["Date applied", "dateApplied"],
      ["Requirements (%)", "requirements"],
    ];
    function csvCell(value) {
      let text = String(value ?? "");
      if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    }
    const csv = [
      columns.map(([title]) => csvCell(title)).join(","),
      ...visible.map((record) =>
        columns.map(([, name]) => csvCell(record[name])).join(","),
      ),
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `applicants-${window.ATS.today()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    window.ATS.notify("Applicant export downloaded.");
  });

  window.addEventListener("storage", render);
  window.addEventListener("ats:data-change", render);
  let refreshingStages = false;
  async function refreshStages() {
    if (refreshingStages || saving || dialog.open || document.hidden) return;
    refreshingStages = true;
    try { await Promise.all([A.reloadApplicants(), A.reloadCatalogs()]); }
    catch (error) { A.applicantsError = error; render(); }
    finally { refreshingStages = false; }
  }
  window.addEventListener('focus', refreshStages);
  setInterval(refreshStages, 60000);
  render();void loadApplicantPhotos();window.addEventListener('ats:activity-refresh',loadApplicantPhotos);
  const linkedApplicantId = pageUrl.searchParams.get("applicant");
  if (linkedApplicantId !== null || pageUrl.searchParams.get("add") === "1") {
    const linkedApplicant = applicants().find(
      (record) => String(record.id) === linkedApplicantId,
    );
    if (linkedApplicant) {openForm(linkedApplicant);if(pageUrl.searchParams.get("documents")==="1")workflow.showDocuments();}
    else if (pageUrl.searchParams.get("add") === "1") openForm();
    pageUrl.searchParams.delete("applicant");pageUrl.searchParams.delete("documents");
    pageUrl.searchParams.delete("add");
    history.replaceState(null, "", pageUrl);
  }
})();
