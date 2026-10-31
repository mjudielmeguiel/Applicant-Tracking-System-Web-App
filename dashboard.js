(async function () {
  'use strict';
  if (!await window.ATS.ready) return;
  await window.ATS.applicantsReady;
  await window.ATS.catalogReady;
  const { read, escape, today, formatDate } = ATS;
  const stages = ATS.applicantStatuses;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const currentYear = new Date().getFullYear();
  const yearSelect = document.getElementById('chartYear');

  const badgeClass = ATS.applicantStatusTone;

  function render() {
    const applicants = read('ats_applicants');
    const events = read('ats_events');
    const positions = ATS.positionSummary().filter(position => position.remaining > 0);
    const countError = document.getElementById('positionCountsError');
    countError.hidden = !ATS.catalogError;
    if (ATS.catalogError) countError.textContent = 'Position counts could not be loaded from Supabase. Refresh counts to try again.';
    document.getElementById('jobPositionCards').innerHTML = ATS.catalogError ? '' : positions.map(position =>
      `<article class="job-position-card" data-position="${escape(position.name)}"><h3>${escape(position.name)}</h3><div class="job-position-counts"><div><strong data-position-applicants>${position.applicants}</strong><span>Applicants</span></div><div><strong data-position-remaining>${position.remaining}</strong><span>Remaining slots</span></div></div><p>${position.filled} filled · ${position.totalSlots} total slots</p></article>`
    ).join('') || (ATS.catalogError ? '' : '<p class="inline-empty">No job positions with available slots. Update total job slots in Settings when vacancies open.</p>');
    document.getElementById('totalCount').textContent = applicants.length;
    const count = status => applicants.filter(applicant => applicant.status === status).length;
    document.getElementById('screenedCount').textContent = count('Screened');
    document.getElementById('phoneCount').textContent = count('Phone Interview') + count('For Phone Interview');
    document.getElementById('finalCount').textContent = count('Final Interview') + count('For Final Interview');

    const selectedYear = Number(yearSelect.value) || currentYear;
    const years = [...new Set([currentYear, selectedYear, ...applicants.map(applicant => Number(String(applicant.dateApplied).slice(0, 4))).filter(year => year >= 1900 && year <= 9999)])].sort((a, b) => b - a);
    yearSelect.innerHTML = years.map(year => `<option value="${year}" ${year === selectedYear ? 'selected' : ''}>${year}</option>`).join('');
    const monthly = Array(12).fill(0);
    applicants.forEach(applicant => {
      const date = String(applicant.dateApplied || '');
      const month = Number(date.slice(5, 7)) - 1;
      if (Number(date.slice(0, 4)) === selectedYear && month >= 0 && month < 12) monthly[month]++;
    });
    const max = Math.max(...monthly, 1);
    const chart = document.getElementById('monthlyChart');
    chart.innerHTML = monthly.map((total, month) => `<div class="chart-column ${month === new Date().getMonth() && selectedYear === currentYear ? 'current' : ''}" title="${months[month]}: ${total} applicants"><span class="chart-count">${total}</span><div class="chart-bar" style="height:${total / max * 190}px"></div></div>`).join('');
    chart.setAttribute('aria-label', `Applicant counts for ${selectedYear}. ${monthly.map((total, month) => `${months[month]}: ${total}`).join(', ')}.`);
    const yearTotal = monthly.reduce((sum, total) => sum + total, 0);
    document.getElementById('chartSummary').textContent = yearTotal ? `${yearTotal} application${yearTotal === 1 ? '' : 's'} received in ${selectedYear}.` : `No applications in ${selectedYear}. Add an applicant to start tracking.`;
    document.getElementById('pipelineList').innerHTML = stages.map(stage => {
      const total = count(stage);
      const percent = applicants.length ? Math.round(total / applicants.length * 100) : 0;
      return `<div class="progress-row"><div class="progress-head"><span>${stage}</span><span>${total} · ${percent}%</span></div><div class="progress-track"><div class="progress-fill ${badgeClass(stage)}" style="width:${percent}%"></div></div></div>`;
    }).join('');

    const recent = [...applicants].sort((a, b) => String(b.dateApplied).localeCompare(String(a.dateApplied))).slice(0, 5);
    document.getElementById('recentApplicants').innerHTML = recent.length ? recent.map(applicant => `<tr><td><span class="record-name">${escape(applicant.name)}</span></td><td>${escape(applicant.position)}</td><td><span class="record-badge ${badgeClass(applicant.status)}">${escape(applicant.status)}</span></td><td>${escape(formatDate(applicant.dateApplied))}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">No applicants yet. <a href="applicant-masterlist.html?add=1">Add your first applicant</a>.</td></tr>';
    document.getElementById('applicantSummary').textContent = `Showing ${recent.length} of ${applicants.length} applicant${applicants.length === 1 ? '' : 's'}`;

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const upcoming = [...events, ...ATS.applicantAppointments().filter(item => item.response !== 'Attended')].filter(event => event.date > today() || (event.date === today() && (!event.startTime || (event.endTime || event.startTime) >= time))).sort((a, b) => `${a.date}${a.startTime || ''}`.localeCompare(`${b.date}${b.startTime || ''}`)).slice(0, 4);
    document.getElementById('upcomingSchedule').innerHTML = upcoming.length ? upcoming.map(event => {
      const date = new Date(`${event.date}T12:00:00`);
      const applicant = applicants.find(person => person.id === event.applicantId);
      return `<div class="schedule-item"><div class="schedule-date"><small>${date.toLocaleDateString('en-PH', { month: 'short' })}</small>${date.getDate()}</div><div class="schedule-info"><strong>${escape(event.title)}</strong><p>${event.startTime ? escape(event.startTime) : 'All day'} · ${event.type === 'appointment' ? 'Appointment' : event.type === 'meeting' ? 'Meeting' : 'Event'}${applicant ? ` · ${escape(applicant.name)}` : ''}</p>${event.location ? `<p>${escape(event.location)}</p>` : ''}</div></div>`;
    }).join('') : '<div class="inline-empty">Your schedule is clear.<br><a href="calendar.html?add=1">Create an event or meeting →</a></div>';
  }

  yearSelect.addEventListener('change', render);
  window.addEventListener('storage', render);
  window.addEventListener('ats:data-change', render);
  let refreshingPositions = false;
  async function refreshPositions() {
    if (refreshingPositions) return;
    refreshingPositions = true;
    const button = document.getElementById('refreshPositionCounts'); button.disabled = true;
    try { await Promise.all([ATS.reloadApplicants(), ATS.reloadCatalogs()]); render(); }
    catch (error) { const message = document.getElementById('positionCountsError'); message.textContent = 'Unable to refresh counts. Previously loaded figures are retained. Try again.'; message.hidden = false; }
    finally { refreshingPositions = false; button.disabled = false; }
  }
  document.getElementById('refreshPositionCounts').addEventListener('click', refreshPositions);
  window.addEventListener('ats:catalogs-changed', render);
  window.addEventListener('focus', refreshPositions);
  setInterval(() => { if (!document.hidden) refreshPositions(); }, 60000);
  render();
})();
