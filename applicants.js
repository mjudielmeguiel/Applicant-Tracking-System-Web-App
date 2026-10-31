(async function () {
  "use strict";
  if (!(await window.ATS.ready)) return;
  await window.ATS.catalogReady;
  await window.ATS.applicantsReady;

  const { read, save, escape: esc } = window.ATS;
  const key = "ats_applicants";
  const statuses = window.ATS.applicantStatuses;
  const statusTools = window.ApplicantStatusTools;
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
    '</fieldset><details class="applicant-integration"><summary>Integration & workbook source</summary><p id="applicantIdentity"></p><p>Name, email, contact, and position are also saved to FullName, Email, ContactNumber, and PositionApplied.</p><pre id="applicantExcelData"></pre></details>';
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
                ? " · " + row.slots_available + " available"
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
        .map(
          (doc) =>
            `<div class="saved-document"><span>${esc(doc.filename)} <small>${Math.ceil(doc.byte_size / 1024)} KB</small></span><button type="button" class="link-btn" data-download-document="${esc(doc.id)}">Download</button><button type="button" class="link-btn" data-remove-document="${esc(doc.id)}">Remove</button></div>`,
        )
        .join("");
    });
  }
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
      if (f.type === "datetime-local") value = localDatetime(value);
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
    if (!form.reportValidity()) return;
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
            ? new Date(value).toISOString()
            : value;
    });
    documentTypes.forEach((type, i) => {
      changes[type] =
        document.getElementById("requirement_" + i).value.trim() || null;
    });
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
        document.getElementById("upload_" + item.index).value = "";
        const status = document.getElementById("requirement_" + item.index);
        if (!status.value) status.value = "Submitted";
      }
      await A.reloadApplicants();
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
      if (detailsSaved) await loadDocuments().catch(() => {});
    } finally {
      lockForm(false);
      document.getElementById("saveApplicant").textContent =
        currentRecord?.databaseId
          ? "Save changes & uploads"
          : "Save applicant & documents";
    }
  });
  form.addEventListener("click", async (event) => {
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
  document.getElementById("addApplicant").disabled = false;
  document
    .getElementById("refreshApplicants")
    .addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await A.reloadApplicants();
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
  window.addEventListener('focus', render);
  setInterval(render, 60000);
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
