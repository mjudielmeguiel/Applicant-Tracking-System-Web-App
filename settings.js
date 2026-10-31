(async function () {
  "use strict";
  const A = window.ATS,
    session = await A.ready;
  if (!A.isAdmin(session)) return;
  const header = document.querySelector(".topbar");
  if (!header) return;
  let actions = header.querySelector(".page-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = "page-actions";
    const avatar = header.querySelector(".avatar");
    header.append(actions);
    if (avatar) actions.append(avatar);
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn-sm ghost";
  button.id = "openSettings";
  button.textContent = "Settings";
  actions.prepend(button);
  const modal = document.createElement("dialog");
  modal.className = "app-dialog catalog-dialog";
  modal.id = "catalogSettings";
  modal.setAttribute("aria-labelledby", "catalogTitle");
  modal.innerHTML =
    '<div class="dialog-head"><div><p class="eyebrow">WORKSPACE CONFIGURATION</p><h2 id="catalogTitle">Recruitment settings</h2><p>Manage reference choices and your team’s available job slots.</p></div><button type="button" class="dialog-close" id="closeSettings" aria-label="Close settings">×</button></div><div class="catalog-tabs"><button type="button" data-kind="position" aria-pressed="true">Job positions</button><button type="button" data-kind="source" aria-pressed="false">Sources</button><button type="button" data-kind="location" aria-pressed="false">Locations</button></div><div class="catalog-scope"></div><p id="catalogError" class="form-error" role="alert" hidden></p><p id="catalogSaved" class="form-success" role="status" hidden></p><div class="catalog-layout"><section><div class="catalog-list-head"><h3 id="catalogListTitle">Job positions</h3><button class="link-btn" id="refreshCatalogs" type="button">Refresh</button></div><div class="catalog-table"><table><thead id="catalogHead"></thead><tbody id="catalogRows"></tbody></table></div></section><form id="catalogForm"><h3 id="catalogFormTitle">Add job position</h3><label class="field-label" for="catalogName">Name</label><input id="catalogName" class="field-input" maxlength="120" required><div id="catalogSlotsGroup"><label class="field-label" for="catalogSlots">Available slots</label><input id="catalogSlots" class="field-input" type="number" min="0" max="999999" step="1" value="0" required></div><p class="catalog-form-note">Existing names are preserved so linked records stay valid.</p><button class="btn-sm primary" id="saveCatalog" type="submit">Add position</button><button class="btn-sm ghost" id="newCatalog" type="button" hidden>Add another</button></form></div><div class="dialog-actions"><span>Changes are saved to Supabase.</span><button class="btn-sm ghost" id="doneSettings" type="button">Done</button></div>';
  document.body.append(modal);
  const $ = (id) => modal.querySelector("#" + id);
  modal.querySelector(".catalog-scope").textContent =
    "AdminID " +
    session.AdminID +
    " · Slots and custom choices are specific to your team.";
  let kind = "position",
    editing = null,
    busy = false;
  const plural = () =>
    kind === "source"
      ? "sources"
      : kind === "position"
        ? "positions"
        : "locations";
  function reset() {
    editing = null;
    $("catalogForm").reset();
    $("catalogName").readOnly = false;
    $("newCatalog").hidden = true;
    $("catalogSlotsGroup").hidden = kind === "source";
    $("catalogSlots").disabled = kind === "source";
    modal.querySelector('label[for="catalogSlots"]').textContent = kind === "position" ? "Total job slots" : "Available slots";
    $("catalogFormTitle").textContent =
      "Add " + (kind === "position" ? "job position" : kind);
    $("saveCatalog").textContent = "Add " + kind;
  }
  function render() {
    const data = A.catalogs?.[plural()] || [];
    const positionStats = new Map(A.positionSummary().map(row => [row.name.trim().toLowerCase(), row]));
    $("catalogListTitle").textContent =
      kind === "position"
        ? "Job positions"
        : kind === "source"
          ? "Sources"
          : "Locations";
    $("catalogHead").innerHTML =
      "<tr><th>Name</th>" +
      (kind === "source"
        ? ""
        : kind === "position" ? "<th>Applicants</th><th>Total slots</th><th>Filled</th><th>Remaining</th><th>Action</th>" : "<th>Available</th><th>Hired</th><th>Action</th>") +
      "</tr>";
    $("catalogRows").replaceChildren();
    data.forEach((row) => {
      const tr = document.createElement("tr"),
        name = document.createElement("td");
      name.textContent = row.name;
      tr.append(name);
      if (kind !== "source") {
        const stats = positionStats.get(row.name.trim().toLowerCase());
        const values = kind === "position" ? [A.catalogError ? "—" : stats?.applicants || 0, row.slots_available, A.catalogError ? "—" : stats?.filled || 0, A.catalogError ? "—" : stats?.remaining || 0] : [row.slots_available, row.hired_count];
        for (const value of values) {
          const td = document.createElement("td");
          td.textContent = value;
          tr.append(td);
        }
        const td = document.createElement("td"),
          edit = document.createElement("button");
        edit.type = "button";
        edit.className = "link-btn";
        edit.textContent = "Edit slots";
        edit.setAttribute("aria-label", "Edit slots for " + row.name);
        edit.disabled = busy;
        edit.addEventListener("click", () => {
          editing = row.id;
          $("catalogName").value = row.name;
          $("catalogName").readOnly = true;
          $("catalogSlots").value = row.slots_available;
          $("newCatalog").hidden = false;
          $("catalogFormTitle").textContent = kind === "position" ? "Update total job slots" : "Update available slots";
          $("saveCatalog").textContent = "Save slots";
          $("catalogSlots").focus();
        });
        td.append(edit);
        tr.append(td);
      }
      $("catalogRows").append(tr);
    });
    if (!data.length) {
      const tr = document.createElement("tr"),
        td = document.createElement("td");
      td.colSpan = kind === "source" ? 1 : kind === "position" ? 6 : 4;
      td.className = "empty-state";
      td.textContent = "No choices available. Add one or refresh.";
      tr.append(td);
      $("catalogRows").append(tr);
    }
  }
  function error(e) {
    $("catalogError").textContent = e.message || "Could not save settings.";
    $("catalogError").hidden = false;
  }
  function lock(value) {
    busy = value;
    modal.querySelectorAll("button,input").forEach((c) => {
      c.disabled = value;
    });
    if (!value) $("catalogSlots").disabled = kind === "source";
  }
  async function load() {
    try {
      $("catalogError").hidden = true;
      await A.reloadCatalogs();
      render();
    } catch (e) {
      error(e);
    }
  }
  button.addEventListener("click", async () => {
    await A.applicantsReady;
    reset();
    $("catalogSaved").hidden = true;
    modal.showModal();
    const data = await A.catalogReady;
    if (!data) await load();
    else render();
  });
  ["closeSettings", "doneSettings"].forEach((id) =>
    $(id).addEventListener("click", () => {
      if (!busy) modal.close();
    }),
  );
  modal.addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
  modal.addEventListener("click", (e) => {
    if (busy) e.stopPropagation();
  });
  modal.querySelectorAll("[data-kind]").forEach((tab) =>
    tab.addEventListener("click", () => {
      kind = tab.dataset.kind;
      modal
        .querySelectorAll("[data-kind]")
        .forEach((t) => t.setAttribute("aria-pressed", String(t === tab)));
      $("catalogError").hidden = true;
      $("catalogSaved").hidden = true;
      reset();
      render();
    }),
  );
  $("newCatalog").addEventListener("click", reset);
  $("refreshCatalogs").addEventListener("click", load);
  $("catalogForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !$("catalogForm").reportValidity()) return;
    const name = $("catalogName").value.trim();
    if (!name) {
      error(Error("Enter a name."));
      return;
    }
    const args = {
      p_session_token: session.sessionToken,
      p_kind: kind,
      p_name: name,
      p_slots: kind === "source" ? 0 : Number($("catalogSlots").value),
      p_entry_id: editing,
    };
    $("catalogError").hidden = true;
    $("catalogSaved").hidden = true;
    lock(true);
    try {
      const saved = await A.rpc("ats_catalog_save", args);
      if (!saved?.saved || String(saved.AdminID) !== String(session.AdminID))
        throw Error("Supabase did not confirm the saved setting.");
      await A.reloadCatalogs();
      $("catalogSaved").textContent = "Saved " + name + " to Supabase.";
      $("catalogSaved").hidden = false;
      reset();
      window.dispatchEvent(new Event("ats:activity-refresh"));
    } catch (e) {
      error(e);
    } finally {
      lock(false);
      render();
    }
  });
  window.addEventListener("ats:data-change", () => { if (modal.open && !busy) render(); });
  window.addEventListener("ats:catalogs-changed", () => {
    if (modal.open && !busy) render();
  });
})();
