(async function () {
  "use strict";
  const A = window.ATS,
    $ = (id) => document.getElementById(id),
    esc = A.escape;
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
  function render() {
    const query = $("userSearch").value.trim().toLowerCase(),
      status = $("userStatus").value.toLowerCase();
    const filtered = users.filter(
      (u) =>
        [u.UserID, u.AdminID, u.FullName, u.Username, u.Email]
          .join(" ")
          .toLowerCase()
          .includes(query) &&
        (!status || String(u.Status || "").toLowerCase() === status),
    );
    $("usersTotal").textContent = users.length;
    $("usersActive").textContent = users.filter(
      (u) => u.Status === "Active",
    ).length;
    $("usersInactive").textContent = users.filter(
      (u) => u.Status === "Inactive",
    ).length;
    $("usersSource").textContent = "Supabase";
    $("usersBody").innerHTML =
      filtered
        .map(
          (u) =>
            `<tr><td>${esc(u.UserID)}</td><td>${esc(u.AdminID ?? "—")}</td><td><div class="user-info-name">${esc(u.FullName)}</div><div class="user-info-email">${esc(u.Email)}</div></td><td>${esc(u.Username)}</td><td><span class="badge-status role">USER</span></td><td>${esc(u.Status)}</td><td>${u.CreatedAt ? esc(A.formatDate(String(u.CreatedAt).slice(0, 10))) : "—"}</td></tr>`,
        )
        .join("") ||
      `<tr><td colspan="7" class="empty-state">${loading ? "Loading users…" : "No users to display."}</td></tr>`;
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
            (u) => String(u.Role).trim().toUpperCase() === "USER" && String(u.AdminID) === String(session.AdminID),
          ),
        );
        if (batch.length < 500) break;
      }
      if (A.getUser()?.sessionToken !== session.sessionToken) return;
      users = records;
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
    $("newAdminID").value = session.AdminID;
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
          photo.size > 262144)
      )
        throw Error("Choose a PNG, JPEG, or WebP image no larger than 256 KB.");
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
      values.p_profile_picture = photo
        ? "\\x" +
          Array.from(new Uint8Array(await photo.arrayBuffer()), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join("")
        : null;
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
        "User saved. UserID: " + saved.UserID + " · AdminID: " + saved.AdminID,
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
  $("userSearch").addEventListener("input", render);
  $("userStatus").addEventListener("change", render);
  $("refreshUsers").addEventListener("click", loadUsers);
  await loadUsers();
})();
