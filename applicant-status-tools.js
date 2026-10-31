(function () {
  "use strict";
  const A = window.ATS;
  const aliases = {
    "For Orientation": "Orientation",
    "For Final Interview": "Final Interview",
    "For Phone Interview": "Phone Interview",
    "For F2F Interview": "F2F Interview",
    "For Online Interview": "Online Interview",
    "For Pooling": "Pooling",
    "For Job Offer": "Job Offer",
  };
  const dateToStatus = {
    "PHONE INTERVIEW DATE": "For Phone Interview",
    "F2F INTERVIEW DATE": "For F2F Interview",
    "ONLINE INTERVIEW DATE": "For Online Interview",
    "ORIENTATION DATE": "For Orientation",
    "EXAM DATE": "For Exam",
    "NO SHOW DATE": "No Show",
    "NO ANSWER DATE": "No Answer",
    "FINAL INTERVIEW DATE": "For Final Interview",
    "DATE HIRED": "Hired",
    "JOB OFFER DATE": "For Job Offer",
    "Date of Deployment": "Deployed",
    "REJECTED DATE": "Rejected",
    "BACKOUT DATE": "Backout",
  };
  const completed = {
    "No Show": "NO SHOW DATE",
    "No Answer": "NO ANSWER DATE",
    Hired: "DATE HIRED",
    Deployed: "Date of Deployment",
    Rejected: "REJECTED DATE",
    Backout: "BACKOUT DATE",
  };
  const stageFields = {
    "Phone Interview": "PHONE INTERVIEW DATE",
    "F2F Interview": "F2F INTERVIEW DATE",
    "Online Interview": "ONLINE INTERVIEW DATE",
    "For Exam": "EXAM DATE",
    "No Show": "NO SHOW DATE",
    "No Answer": "NO ANSWER DATE",
    Screened: "DATE SCREENED",
    "Final Interview": "FINAL INTERVIEW DATE",
    Hired: "DATE HIRED",
    "Job Offer": "JOB OFFER DATE",
    Deployed: "Date of Deployment",
    Rejected: "REJECTED DATE",
    Backout: "BACKOUT DATE",
    Orientation: "ORIENTATION DATE",
  };
  const stageLabels = {
    "PHONE INTERVIEW DATE": "Phone interview",
    "F2F INTERVIEW DATE": "Face-to-face interview",
    "ONLINE INTERVIEW DATE": "Online interview",
    "ORIENTATION DATE": "Orientation",
    "EXAM DATE": "Exam",
    "NO SHOW DATE": "No show",
    "NO ANSWER DATE": "No answer",
    "DATE SCREENED": "Screened",
    "FINAL INTERVIEW DATE": "Final interview",
    "DATE HIRED": "Hired",
    "JOB OFFER DATE": "Job offer",
    "Date of Deployment": "Deployment",
    "REJECTED DATE": "Rejected",
    "BACKOUT DATE": "Backout",
    "For Onboarding Target Start Date": "Onboarding",
    "Date of Interview": "Interview",
    ScheduleDate: "Scheduled",
    "REQUIREMENTS COMPLETION DATE": "Requirements complete",
  };
  const group = (status) =>
    aliases[String(status || "Screened").trim()] ||
    String(status || "Screened").trim();
  function formatted(value) {
    const text = String(value || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return A.formatDate(text);
    if (
      /^\d{4}-\d{2}-\d{2}T/.test(text) &&
      !Number.isNaN(new Date(text).getTime())
    )
      return new Date(text).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    return text;
  }
  function phone(value) {
    let digits = String(value || "").replace(/[^0-9]/g, "");
    if (/^0063[0-9]{10}$/.test(digits)) digits = digits.slice(2);
    if (/^63[0-9]{10}$/.test(digits)) digits = "0" + digits.slice(2);
    return digits;
  }
  const email = (value) =>
    String(value || "")
      .trim()
      .toLowerCase();
  function duplicateField(error) {
    const message = String(error.message || error);
    return /email/i.test(message)
      ? "applicantEmail"
      : /contact|phone/i.test(message)
        ? "applicantPhone"
        : null;
  }
  window.ApplicantStatusTools = {
    group,
    phone,
    email,
    renderCards(host, records, filter, render) {
      const first = [
        "Phone Interview",
        "Final Interview",
        "F2F Interview",
        "Online Interview",
      ];
      const groups = [
        ...new Set([
          ...first,
          ...A.applicantStatuses.map(group),
        ]),
      ];
      host.replaceChildren();
      function card(label, count, status) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "applicant-status-card";
        button.dataset.statusGroup = status;
        button.setAttribute(
          "aria-pressed",
          String(
            status
              ? group(filter.value) === status && !!filter.value
              : !filter.value,
          ),
        );
        const title = document.createElement("span"),
          value = document.createElement("strong");
        title.textContent = label;
        value.textContent = count;
        button.append(title, value);
        button.setAttribute("aria-label", label + ": " + count + " applicants");
        button.addEventListener("click", () => {
          if (!status) filter.value = "";
          else {
            const option = [...filter.options].find(
              (o) => o.value && group(o.value) === status,
            );
            if (option) filter.value = option.value;
            else {
              filter.add(new Option(status, status));
              filter.value = status;
            }
          }
          render();
        });
        host.append(button);
      }
      card("All applicants", records.length, "");
      groups.forEach((status) =>
        card(
          status,
          records.filter((row) => group(row.status) === status).length,
          status,
        ),
      );
    },
    dates(record) {
      const row = record.db || {},
        kind = group(record.status);
      let key = stageFields[kind];
      if (
        ["Phone Interview", "Final Interview", "F2F Interview", "Online Interview", "Orientation", "For Exam", "Job Offer"].includes(kind)
      )
        key = row.ScheduleDate ? "ScheduleDate" : row[stageFields[kind]] ? stageFields[kind] : "Date of Interview";
      const stage =
        key && row[key]
          ? `<span class="applicant-stage-date">${A.escape(stageLabels[key] || key)}: ${A.escape(formatted(row[key]))}</span>`
          : "";
      const changed = row.StatusChangedAt
        ? `<span class="applicant-ref">Status updated: ${A.escape(formatted(row.StatusChangedAt))}</span>`
        : "";
      const entries = Object.keys(stageLabels)
        .filter((field) => row[field])
        .map(
          (field) =>
            `<li><strong>${A.escape(stageLabels[field])}</strong> ${A.escape(formatted(row[field]))}</li>`,
        )
        .join("");
      return `<span class="applicant-date-applied">Applied: ${A.escape(record.dateApplied ? A.formatDate(record.dateApplied) : "—")}</span>${stage}${row.ScheduleDate ? `<span class="applicant-ref">Response: ${A.escape(row.ScheduleResponse || "Pending")}</span>` : ""}${changed}${entries ? `<details class="applicant-date-history"><summary>Stage dates</summary><ul>${entries}</ul></details>` : ""}`;
    },
    validateContacts(current, records) {
      const inputEmail = document.getElementById("applicantEmail"),
        inputPhone = document.getElementById("applicantPhone");
      const e = email(inputEmail.value),
        p = phone(inputPhone.value);
      const others = records.filter(
        (row) => !current || String(row.id) !== String(current.id),
      );
      let input, message;
      if (e && others.some((row) => email(row.email) === e)) {
        input = inputEmail;
        message =
          "An applicant with this email address already exists in your AdminID.";
      } else if (p && others.some((row) => phone(row.phone) === p)) {
        input = inputPhone;
        message =
          "An applicant with this contact number already exists in your AdminID.";
      }
      if (input) {
        input.setCustomValidity(message);
        input.classList.add("invalid");
        input.reportValidity();
        input.focus();
        return message;
      }
      return null;
    },
    serverError(error) {
      if (error.code !== "23505") return error.message;
      const field = duplicateField(error);
      const message =
        field === "applicantEmail"
          ? "An applicant with this email address already exists in your AdminID."
          : field === "applicantPhone"
            ? "An applicant with this contact number already exists in your AdminID."
            : error.message;
      if (field)
        setTimeout(() => {
          const input = document.getElementById(field);
          input.classList.add("invalid");
          input.focus();
        }, 0);
      return message;
    },
    initForm() {
      const status = document.getElementById("applicantStatus"),
        hint = document.createElement("p");
      hint.className = "applicant-status-hint";
      hint.id = "applicantStatusHint";
      hint.setAttribute("role", "status");
      status.after(hint);
      ["applicantEmail", "applicantPhone"].forEach((id) =>
        document.getElementById(id).addEventListener("input", (e) => {
          e.target.setCustomValidity("");
          e.target.classList.remove("invalid");
        }),
      );
      Object.entries(dateToStatus).forEach(([field, target]) => {
        const input = document.querySelector(
            '[data-applicant-field="' + field + '"]',
          ),
          feedback = document.createElement("p");
        feedback.className = "applicant-status-hint stage-status-feedback";
        feedback.setAttribute("role", "status");
        input.after(feedback);
        input.addEventListener("change", () => {
          if (!input.value) {
            feedback.textContent = "";
            return;
          }
          if (group(status.value) !== group(target)) status.value = target;
          feedback.textContent = "Status: " + status.value + ".";
          hint.textContent =
            "Status set to " +
            status.value +
            " to match " +
            stageLabels[field] +
            ". Select a different status afterwards if this is a historical date.";
        });
      });
      status.addEventListener("change", () => {
        document.querySelectorAll(".stage-status-feedback").forEach((p) => {
          p.textContent = "";
        });
        const field = completed[status.value];
        if (field) {
          const input = document.querySelector(
            '[data-applicant-field="' + field + '"]',
          );
          if (!input.value) {
            input.value = A.today();
            hint.textContent =
              stageLabels[field] +
              " date set to today. You can edit the actual date.";
          } else
            hint.textContent =
              "Using the recorded " +
              stageLabels[field].toLowerCase() +
              " date.";
        } else
          hint.textContent =
            "Interview and onboarding dates use the schedule you enter; no appointment date is assumed.";
      });
    },
    formOpened() {
      ["applicantEmail", "applicantPhone"].forEach((id) => {
        const input = document.getElementById(id);
        input.setCustomValidity("");
        input.classList.remove("invalid");
      });
      document.querySelectorAll(".stage-status-feedback").forEach((p) => {
        p.textContent = "";
      });
      document.getElementById("applicantStatusHint").textContent = "";
    },
  };
})();
