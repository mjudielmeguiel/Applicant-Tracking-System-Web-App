(async function () {
  "use strict";
  const A = window.ATS,
    session = await A.ready;
  if (!session) return;
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  let toolbar = topbar.querySelector(".page-actions");
  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.className = "page-actions";
    const avatar = topbar.querySelector(".avatar");
    topbar.append(toolbar);
    if (avatar) toolbar.append(avatar);
  }
  const key =
    "ats_activity_sound:" +
    session.AdminID +
    ":" +
    session.accountType +
    ":" +
    session.id;
  let sound = localStorage.getItem(key) === "on",
    busy = false,
    initialized = false,
    latest = 0,
    items = [],
    unreadOnly = false,
    more = false,
    unreadCount = 0;
  const audio = new Audio("assets/notification-alert-sound.mp3");
  audio.preload = "auto";
  const bell = document.createElement("button");
  bell.className = "activity-bell";
  bell.type = "button";
  bell.setAttribute("aria-label", "Notifications");
  bell.setAttribute("aria-expanded", "false");
  bell.setAttribute("aria-controls", "activityPanel");
  bell.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="activity-count" hidden></span>';
  toolbar.prepend(bell);
  const panel = document.createElement("section");
  panel.id = "activityPanel";
  panel.className = "activity-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Team activity notifications");
  panel.innerHTML =
    '<header class="activity-header"><div><p class="activity-eyebrow">WORKSPACE UPDATES</p><h2>Activity & notifications</h2><p class="activity-scope"></p></div><button type="button" class="activity-close" aria-label="Close notifications">×</button></header><div class="activity-toolbar"><div class="activity-tabs"><button type="button" data-filter="all" aria-pressed="true">All activity</button><button type="button" data-filter="unread" aria-pressed="false">Unread</button></div><button type="button" id="activitySound"></button></div><div class="activity-summary"><span id="activitySummary" role="status"></span><button type="button" id="activityReadAll">Mark all read</button></div><div id="activityError" role="status" hidden></div><div id="activityItems" class="activity-items"></div><footer><button type="button" id="activityMore" hidden>Show earlier activity</button><button type="button" id="activityRefresh">Refresh</button><span>Updates every 15 seconds</span></footer>';
  document.body.append(panel);
  const $ = (id) => panel.querySelector("#" + id);
  panel.querySelector(".activity-scope").textContent =
    "Your team · AdminID " + session.AdminID;
  function soundLabel() {
    $("activitySound").textContent = sound ? "Sound on" : "Sound off";
    $("activitySound").setAttribute("aria-pressed", String(sound));
  }
  function close() {
    panel.hidden = true;
    bell.setAttribute("aria-expanded", "false");
  }
  bell.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    bell.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) {
      panel.querySelector(".activity-close").focus();
      refresh();
    }
  });
  panel.querySelector(".activity-close").addEventListener("click", () => {
    close();
    bell.focus();
  });
  document.addEventListener("click", (e) => {
    if (!panel.contains(e.target) && !bell.contains(e.target)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) {
      close();
      bell.focus();
    }
  });
  const message = (row) =>
    row.actor_name +
    " " +
    (row.action === "created"
      ? row.entity_type === "user" || row.entity_type === "applicant"
        ? "added"
        : "created"
      : row.action === "deleted"
        ? "removed"
        : "updated") +
    " " +
    (row.entity_type === "mrf" ? "MRF" : row.entity_type) +
    " " +
    row.entity_label;
  function relative(value) {
    const seconds = Math.max(
      0,
      Math.floor((Date.now() - new Date(value).getTime()) / 1000),
    );
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return Math.floor(seconds / 60) + " min ago";
    if (seconds < 86400) return Math.floor(seconds / 3600) + " hr ago";
    return new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  function render() {
    $("activityItems").replaceChildren();
    const visible = items.filter((row) => !unreadOnly || !row.is_read);
    visible.forEach((row) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "activity-item" + (row.is_read ? "" : " is-unread");
      button.dataset.activityId = row.id;
      const initials = document.createElement("span");
      initials.className = "activity-initials";
      initials.textContent = row.actor_name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0])
        .join("")
        .toUpperCase();
      const copy = document.createElement("span");
      copy.className = "activity-copy";
      const label = document.createElement("span");
      label.className = "activity-type";
      label.textContent =
        (row.entity_type === "mrf" ? "MRF" : row.entity_type) +
        " · " +
        row.action;
      const text = document.createElement("span");
      text.className = "activity-message";
      text.textContent = message(row);
      const time = document.createElement("time");
      time.dateTime = row.created_at;
      time.textContent = relative(row.created_at);
      time.title = new Date(row.created_at).toLocaleString();
      copy.append(label, text, time);
      button.append(initials, copy);
      button.setAttribute(
        "aria-label",
        message(row) + (row.is_read ? ", read" : ", unread. Mark as read"),
      );
      button.addEventListener("click", async () => {
        try {
          await A.rpc("ats_activity_read", {
            p_session_token: session.sessionToken,
            p_activity_id: row.id,
          });
          row.is_read = true;
          await refresh();
        } catch (error) {
          showError(error);
        }
      });
      $("activityItems").append(button);
    });
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "activity-empty";
      empty.textContent = !$("activityError").hidden
        ? "Activity is unavailable. Use Refresh to try again."
        : initialized
          ? unreadOnly
            ? unreadCount
              ? "Show earlier activity to view older unread updates."
              : "You’re all caught up."
            : "No activity yet. Your team’s updates will appear here."
          : "Loading your team’s activity…";
      $("activityItems").append(empty);
    }
    $("activityMore").hidden = !more;
  }
  function showError(error) {
    $("activityError").textContent =
      error.message || "Activity could not be loaded. Try Refresh.";
    $("activityError").hidden = false;
  }
  async function refresh(older = false) {
    if (busy || A.getUser()?.sessionToken !== session.sessionToken) return;
    busy = true;
    try {
      const data = await A.rpc("ats_activity_list", {
        p_session_token: session.sessionToken,
        p_before_id:
          older && items.length
            ? Math.min(...items.map((r) => Number(r.id)))
            : null,
      });
      if (
        !data ||
        !Array.isArray(data.items) ||
        data.items.some((r) => String(r.admin_id) !== String(session.AdminID))
      )
        throw Error("Invalid team activity response.");
      if (A.getUser()?.sessionToken !== session.sessionToken) return;
      const incoming = data.items;
      if (!older && initialized && Number(data.latestId) > latest) {
        const newRows = incoming.filter((r) => Number(r.id) > latest);
        if (newRows.length) {
          if (sound) {
            audio.currentTime = 0;
            audio.play().catch(() => {});
          }
          A.notify(message(newRows[0]));
        }
      }
      const merged = new Map(items.map((r) => [String(r.id), r]));
      incoming.forEach((r) => merged.set(String(r.id), r));
      items = [...merged.values()].sort((a, b) => Number(b.id) - Number(a.id));
      if (!initialized || older) more = incoming.length === 50;
      latest = Math.max(latest, Number(data.latestId) || 0);
      initialized = true;
      const count = Number(data.unreadCount) || 0;
      unreadCount = count;
      if (!count)
        items.forEach((row) => {
          row.is_read = true;
        });
      const badge = bell.querySelector(".activity-count");
      badge.textContent = count > 99 ? "99+" : count;
      badge.hidden = !count;
      bell.setAttribute("aria-label", "Notifications, " + count + " unread");
      $("activitySummary").textContent = count
        ? count + " unread notification" + (count === 1 ? "" : "s")
        : "All notifications read";
      $("activityReadAll").disabled = !count;
      $("activityError").hidden = true;
      render();
    } catch (error) {
      showError(error);
      render();
    } finally {
      busy = false;
    }
  }
  panel.querySelectorAll("[data-filter]").forEach((button) =>
    button.addEventListener("click", () => {
      unreadOnly = button.dataset.filter === "unread";
      panel
        .querySelectorAll("[data-filter]")
        .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      render();
    }),
  );
  $("activitySound").addEventListener("click", async () => {
    sound = !sound;
    localStorage.setItem(key, sound ? "on" : "off");
    soundLabel();
    if (sound) {
      try {
        audio.currentTime = 0;
        await audio.play();
      } catch (_) {
        sound = false;
        localStorage.setItem(key, "off");
        soundLabel();
        showError(
          Error(
            "Sound could not play. You can continue using visual notifications.",
          ),
        );
      }
    }
  });
  $("activityReadAll").addEventListener("click", async () => {
    try {
      await A.rpc("ats_activity_read", {
        p_session_token: session.sessionToken,
        p_activity_id: null,
      });
      items.forEach((r) => (r.is_read = true));
      await refresh();
    } catch (error) {
      showError(error);
    }
  });
  $("activityRefresh").addEventListener("click", () => refresh());
  $("activityMore").addEventListener("click", () => refresh(true));
  window.addEventListener("ats:activity-refresh", () => refresh());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  soundLabel();
  render();
  await refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 15000);
})();
