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
  const filter = document.getElementById("statusFilter");
  const rows = document.getElementById("applicantRows");
  const dialog = document.getElementById("applicantDialog");
  const form = document.getElementById("applicantForm");
  const definitions = window.ApplicantFieldDefinitions,
    documentTypes = window.ApplicantDocumentTypes;
  const groups = [...new Set(definitions.map((f) => f.group))];
  const controls = (definition) => {
    const f = definition,
      attrs = `id="${f.id}" data-applicant-field="${esc(f.column)}" class="field-input" ${f.required ? "required" : ""} ${f.column === "Name" ? 'minlength="2"' : ""} ${f.type === "tel" ? 'pattern="[+()0-9 .-]{7,25}"' : ""}`;
    if (f.type === "response") return `<select ${attrs}><option value="Pending">Awaiting response / attendance</option><option value="Confirmed">Confirmed</option><option value="Attended">Attended</option><option value="Cancelled">Cancelled</option></select>`;
    if (["position", "site", "source", "status"].includes(f.type))
      return `<select ${attrs}><option value="">Select ${esc(f.label)}</option></select>`;
    if (f.type === "textarea")
      return `<textarea ${attrs} rows="3" maxlength="${f.max}"></textarea>`;
    return `<input ${attrs} type="${f.type}" ${f.type === "number" ? 'min="1" step="1"' : `maxlength="${f.max}"`}>`;
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
                `<div class="form-field ${f.type === "textarea" ? "span-2" : ""}"><label class="field-label" for="${f.id}">${esc(f.label)}${f.required ? " *" : ""}</label>${controls(f)}</div>`,
            )
            .join("") +
          "</div></fieldset>",
      )
      .join("") +
    '<fieldset class="applicant-section"><legend>Requirements & documents</legend><p class="section-subtitle">Add a status or reference and attach supporting documents. PDF, JPG, PNG, DOC, DOCX · up to 10 MB per file.</p>' +
    documentTypes
      .map(
        (type, i) =>
          `<div class="applicant-document"><div><label class="field-label" for="requirement_${i}">${esc(type)} status / reference</label><input class="field-input" id="requirement_${i}" data-applicant-field="${esc(type)}" maxlength="1000" placeholder="Pending, Submitted, Verified, or reference"><div id="savedDocuments_${i}" class="saved-documents"></div></div><div><label class="field-label" for="upload_${i}">Upload ${esc(type)}</label><input id="upload_${i}" class="field-input" type="file" data-document-type="${esc(type)}" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"></div></div>`,
      )
      .join("") +
    '<div class="applicant-document applicant-id-photo"><div><h3>1×1 ID picture</h3><p class="section-subtitle">Square JPG/PNG · at least 300×300 pixels · up to 10 MB.</p><div id="idPhotoDocuments" class="saved-documents"></div></div><div><label class="field-label" for="idPhotoFile">Upload 1×1 ID picture</label><input class="field-input" id="idPhotoFile" type="file" accept=".jpg,.jpeg,.png"></div></div></fieldset><details class="applicant-integration"><summary>Integration & workbook source</summary><p id="applicantIdentity"></p><p>Name, email, contact, and position are also saved to FullName, Email, ContactNumber, and PositionApplied.</p><pre id="applicantExcelData"></pre></details>';
  const formError = document.getElementById("applicantFormError");
  const fields = {
    name: document.getElementById("applicantName"),
    position: document.getElementById("applicantPosition"),
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
  const session = await window.ATS.ready;

  function fillChoices(record) {
    const positionStats = new Map(window.ATS.positionSummary().map(row => [row.name.trim().toLowerCase(), row]));
    for (const [key, group] of [
      ["position", "positions"],
      ["source", "sources"],
      ["site", "locations"],
    ]) {
      const selected = record ? record[key] || "" : fields[key].value;
      const choices = window.ATS.catalogs?.[group] || [];
      fields[key].innerHTML =
        '<option value="">Select ' +
        key +
        "</option>" +
        choices
          .map(
            (row) =>
              '<option value="' +
              esc(row.name) +
              '">' +
              esc(row.name) +
              (key === "position"
                ? " · " + (positionStats.get(row.name.trim().toLowerCase())?.applicants || 0) + " applicants · " + (positionStats.get(row.name.trim().toLowerCase())?.remaining || 0) + " slots remaining"
                : "") +
              "</option>",
          )
          .join("");
      if (selected && !choices.some((row) => row.name === selected))
        fields[key].add(new Option(selected + " (saved value)", selected));
      fields[key].value = selected;
    }
  }
  fillChoices();
  window.addEventListener("ats:catalogs-changed", () => fillChoices());
  window.addEventListener("ats:data-change", () => fillChoices());

  const options = statuses
    .map((status) => `<option value="${esc(status)}">${esc(status)}</option>`)
    .join("");
  filter.insertAdjacentHTML("beforeend", options);
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
        <td><span class="applicant-name">${esc(record.name || "Unnamed applicant")}</span><span class="applicant-ref">#${esc(shortId)}</span></td>
        <td>${esc(record.position || "—")}<span class="applicant-ref">${esc([record.source, record.site].filter(Boolean).join(" · "))}</span></td>
        <td>${esc(record.phone || "—")}${record.email ? `<span class="applicant-email">${esc(record.email)}</span>` : ""}</td>
        <td><span class="record-badge ${statusTone(record.status)}">${esc(record.status || "Not recorded")}</span><div class="applicant-requirements-status"><span>Ongoing requirements status</span>${esc(String(record.db?.["Ongoing Requirements Status"] || record["Ongoing Requirements Status"] || "").trim() || "Not provided")}</div></td>
        <td class="applicant-dates-cell">${statusTools.dates(record)}</td>
        <td class="requirements-cell"><span>${progress}%</span><div class="progress-track" role="progressbar" aria-label="Requirements for ${esc(record.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><div class="progress-fill" style="width:${progress}%"></div></div></td>
        <td><button type="button" class="btn-sm ghost" data-edit="${esc(record.id)}" aria-label="Edit ${esc(record.name)}">Details / documents</button></td>
      </tr>`;
      })
      .join("");
  }

  const A = window.ATS;
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
    documents = currentRecord?.databaseId
      ? await A.rpc("ats_applicant_documents", {
          p_session_token: session.sessionToken,
          p_applicant_id: currentRecord.databaseId,
        })
      : [];
    documentTypes.forEach((type, i) => {
      document.getElementById("savedDocuments_" + i).innerHTML = documents
        .filter((doc) => doc.document_type === type)
        .map(documentRow)
        .join("");
      const latest = documents.find(doc => doc.document_type === type && doc.latest !== false);
      if (latest) document.getElementById('requirement_' + i).value = latest.review_status || 'Submitted';
    });
    document.getElementById('idPhotoDocuments').innerHTML = documents.filter(doc => doc.document_type === 'ID PHOTO').map(documentRow).join('');
  }
  function documentRow(doc) {
    return '<div class="saved-document review-document"><span>'+esc(doc.filename)+' <small>'+Math.ceil(doc.byte_size/1024)+' KB · '+esc(doc.review_status||'Submitted')+(doc.latest===false?' · Previous upload':'')+(doc.automated?' · Automatic check':'')+'</small>'+(doc.review_comment?'<small class="document-review-comment">'+esc(doc.review_comment)+'</small>':'')+'</span><div class="document-actions"><button type="button" class="link-btn" data-preview-document="'+esc(doc.id)+'" '+(!['application/pdf','image/png','image/jpeg'].includes(doc.mime_type)?'disabled':'')+'>Preview</button><button type="button" class="link-btn" data-download-document="'+esc(doc.id)+'">Download</button>'+(doc.latest!==false?'<button type="button" class="link-btn" data-review-document="'+esc(doc.id)+'">Review / comment</button>':'')+'<button type="button" class="link-btn" data-remove-document="'+esc(doc.id)+'">Remove</button></div></div>';
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
    form.reset();
    fillChoices(record || {});
    formError.hidden = true;
    formError.textContent = "";
    const row = legacyRow(record);
    definitions.forEach((f) => {
      const input = document.getElementById(f.id);
      let value = row[f.column] ?? "";
      if (f.type === "datetime-local") value = f.column === "ScheduleDate" && value ? new Date(new Date(value).getTime()+8*3600000).toISOString().slice(0,16) : localDatetime(value);
      input.value = value;
    });
    fields.dateApplied.value = fields.dateApplied.value || A.today();
    fields.status.value = statuses.includes(row.Status) ? row.Status : (statuses.find(status => statusTools.group(status) === statusTools.group(row.Status)) || "");
    statusTools.formOpened();
    documentTypes.forEach((type, i) => {
      document.getElementById("requirement_" + i).value = row[type] || "";
      document.getElementById("savedDocuments_" + i).textContent = "";
    });
    document.getElementById("applicantDialogTitle").textContent = record
      ? "Applicant details & documents"
      : "Add applicant";
    document.getElementById("saveApplicant").textContent = record
      ? "Save changes & uploads"
      : "Save applicant & documents";
    document.getElementById("applicantIdentity").textContent =
      "ApplicantID: " +
      (record?.databaseId || "Assigned on save") +
      " · AdminID: " +
      session.AdminID +
      " · Client reference: " +
      draftId;
    document.getElementById("applicantExcelData").textContent = JSON.stringify(
      row.ExcelData || [],
      null,
      2,
    );
    document.getElementById("applicantCompanyNote").textContent =
      "Checking company configuration…";
    workflow.open(record);
    A.openDialog(dialog);
    fields.name.focus();
    A.rpc("ats_mrf_context", { p_session_token: session.sessionToken })
      .then((context) => {
        document.getElementById("applicantCompanyNote").textContent =
          context.companyConfigured
            ? "CompanyID: " +
              context.CompanyID +
              " · Records and documents are shared only within AdminID " +
              session.AdminID +
              "."
            : "AdminID " +
              session.AdminID +
              " · CompanyID is optional and not configured. Applicant details and documents stay within this AdminID.";
      })
      .catch((error) => {
        document.getElementById("applicantCompanyNote").textContent =
          error.message;
      });
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
    selected.forEach(item => item.inputId = 'upload_' + item.index);
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
    if (!workflow.prepareChanges(changes)) return;
    if (currentRecord?.databaseId) changes.ExpectedStageVersion = Number(currentRecord.db?.StageVersion || 0);
    if (!changes.DateApplied)
      changes.DateApplied = new Date(changes.Date + "T00:00:00").toISOString();
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
    const editButton = event.target.closest("[data-edit]");
    if (!editButton) return;
    const record = applicants().find(
      (item) => String(item.id) === editButton.dataset.edit,
    );
    if (record) openForm(record);
  });
  search.addEventListener("input", render);
  filter.addEventListener("change", render);
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
  render();
  const linkedApplicantId = pageUrl.searchParams.get("applicant");
  if (linkedApplicantId !== null || pageUrl.searchParams.get("add") === "1") {
    const linkedApplicant = applicants().find(
      (record) => String(record.id) === linkedApplicantId,
    );
    if (linkedApplicant) openForm(linkedApplicant);
    else if (pageUrl.searchParams.get("add") === "1") openForm();
    pageUrl.searchParams.delete("applicant");
    pageUrl.searchParams.delete("add");
    history.replaceState(null, "", pageUrl);
  }
})();
