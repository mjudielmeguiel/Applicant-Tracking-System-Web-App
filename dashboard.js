(async function () {
  'use strict';
  if (!await window.ATS.ready) return;
  await window.ATS.applicantsReady;
  await window.ATS.catalogReady;
  const { read, escape, today, formatDate } = ATS;
  const stages = ATS.applicantStatuses;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const yearSelect = document.getElementById('chartYear');
  const monthSelect = document.getElementById('chartMonth');
  monthSelect.innerHTML = '<option value="0">All months</option>' +
    months.map((month, index) => `<option value="${index + 1}">${month}</option>`).join('');
  monthSelect.value = Number(ATS.manilaDateKey(new Date()).slice(5, 7));

  const badgeClass = ATS.applicantStatusTone;

  function render() {
    const applicants = read('ats_applicants');
    const events = read('ats_events');
    const currentDay = ATS.manilaDateKey(new Date());
    const currentYear = Number(currentDay.slice(0, 4));
    const selectedYear = Number(yearSelect.value) || currentYear;
    const selectedMonth = Number(monthSelect.value);
    const period = selectedMonth ? `${months[selectedMonth - 1]} ${selectedYear}` : String(selectedYear);
    const periodPrefix = selectedMonth ? `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-` : `${selectedYear}-`;
    const inPeriod = day => day.startsWith(periodPrefix);
    const years = new Set([currentYear, selectedYear]);
    const dated = applicants.map(applicant => {
      const row = applicant.db || applicant;
      const day = ATS.manilaDateKey(applicant.dateApplied);
      const hiredDay = ATS.manilaDateKey(row['DATE HIRED'] || applicant['DATE HIRED'] || applicant.hiredDate);
      let finalInterviewDay = ATS.manilaDateKey(row['FINAL INTERVIEW DATE']);
      if (badgeClass(row.ScheduleType || applicant.status) === 'status-final-interview') {
        finalInterviewDay = row.ScheduleResponse === 'Cancelled' ? '' : ATS.manilaDateKey(row.ScheduleDate) || finalInterviewDay;
      }
      for (const date of [day, hiredDay, finalInterviewDay]) {
        if (date) years.add(Number(date.slice(0, 4)));
      }
      return { applicant, day, hiredDay, finalInterviewDay };
    });
    yearSelect.innerHTML = [...years].sort((a, b) => b - a)
      .map(year => `<option value="${year}" ${year === selectedYear ? 'selected' : ''}>${year}</option>`).join('');
    const entries = dated.filter(({ day }) => inPeriod(day));
    document.getElementById('totalCount').textContent = entries.length;
    const countInPeriod = status => entries.filter(({ applicant }) => applicant.status === status).length;
    const addedToday = dated.filter(({ applicant, day }) => {
      const row = applicant.db || applicant;
      const imported = applicant.localCsv || row.WorkbookImportID;
      // Use the original application date for imports so a batch upload preserves historical counts.
      const addedDay = imported ? day :
        ATS.applicantAddedDay(applicant) || ATS.manilaDateKey(row['Submission Date']) || day;
      return addedDay === currentDay;
    });
    document.getElementById('addedTodayCount').textContent = addedToday.length;
    document.getElementById('dashboardHiredCount').textContent = dated.filter(({ hiredDay }) => inPeriod(hiredDay)).length;
    document.getElementById('finalCount').textContent = dated.filter(({ finalInterviewDay }) => inPeriod(finalInterviewDay)).length;

    const totals = Array(selectedMonth ? new Date(Date.UTC(selectedYear, selectedMonth, 0)).getUTCDate() : 12).fill(0);
    for (const { day } of entries) {
      const index = Number(selectedMonth ? day.slice(8, 10) : day.slice(5, 7)) - 1;
      if (index >= 0 && index < totals.length) totals[index]++;
    }
    const max = Math.max(...totals, 1);
    const chart = document.getElementById('monthlyChart');
    const labels = document.getElementById('chartLabels');
    const daily = Boolean(selectedMonth);
    const currentMonth = Number(currentDay.slice(5, 7));
    const highlighted = selectedYear === currentYear
      ? (daily ? (selectedMonth === currentMonth ? Number(currentDay.slice(8, 10)) - 1 : -1) : currentMonth - 1)
      : -1;
    const chartLabel = index => daily ? `Day ${index + 1}` : months[index];
    chart.classList.toggle('daily', daily);
    labels.classList.toggle('daily', daily);
    document.getElementById('monthlyTitle').textContent = daily ? 'Applications by day' : 'Applicants per month';
    chart.innerHTML = totals.map((total, index) => `<div class="chart-column ${index === highlighted ? 'current' : ''}" title="${chartLabel(index)}: ${total} applicants"><span class="chart-count">${!daily || total ? total : ''}</span><div class="chart-bar" style="height:${total / max * 190}px"></div></div>`).join('');
    labels.innerHTML = totals.map((_, index) => `<span>${daily ? ([0, 4, 9, 14, 19, 24].includes(index) || index === totals.length - 1 ? index + 1 : '') : months[index].slice(0, 3)}</span>`).join('');
    chart.setAttribute('aria-label', `Applicant counts for ${period}. ${totals.map((total, index) => `${chartLabel(index)}: ${total}`).join(', ')}.`);
    document.getElementById('chartSummary').textContent = entries.length ? `${entries.length} application${entries.length === 1 ? '' : 's'} received in ${period}.` : `No applications in ${period}.`;
    document.getElementById('pipelineList').innerHTML = stages.map(stage => {
      const total = countInPeriod(stage);
      const percent = entries.length ? Math.round(total / entries.length * 100) : 0;
      return `<div class="progress-row"><div class="progress-head"><span>${stage}</span><span>${total} · ${percent}%</span></div><div class="progress-track"><div class="progress-fill ${badgeClass(stage)}" style="width:${percent}%"></div></div></div>`;
    }).join('');

    const recent = entries.sort((a, b) => b.day.localeCompare(a.day)).slice(0, 5);
    document.getElementById('recentApplicants').innerHTML = recent.length ? recent.map(({ applicant, day }) => `<tr><td><span class="record-name">${escape(applicant.name)}</span></td><td>${escape(applicant.position)}</td><td><span class="record-badge ${badgeClass(applicant.status)}">${escape(applicant.status)}</span></td><td>${escape(formatDate(day))}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">No applicants in the selected period.</td></tr>';
    document.getElementById('applicantSummary').textContent = `Showing ${recent.length} of ${entries.length} applicant${entries.length === 1 ? '' : 's'}`;

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const upcoming = [...events, ...ATS.applicantAppointments().filter(item => !['Attended','Recorded'].includes(item.response))].filter(event => event.date > today() || (event.date === today() && (!event.startTime || (event.endTime || event.startTime) >= time))).sort((a, b) => `${a.date}${a.startTime || ''}`.localeCompare(`${b.date}${b.startTime || ''}`)).slice(0, 4);
    document.getElementById('upcomingSchedule').innerHTML = upcoming.length ? upcoming.map(event => {
      const date = new Date(`${event.date}T12:00:00`);
      const applicant = applicants.find(person => person.id === event.applicantId);
      return `<div class="schedule-item"><div class="schedule-date"><small>${date.toLocaleDateString('en-PH', { month: 'short' })}</small>${date.getDate()}</div><div class="schedule-info"><strong>${escape(event.title)}</strong><p>${event.startTime ? escape(event.startTime) : 'All day'} · ${event.type === 'appointment' ? 'Appointment' : event.type === 'meeting' ? 'Meeting' : 'Event'}${applicant ? ` · ${escape(applicant.name)}` : ''}</p>${event.location ? `<p>${escape(event.location)}</p>` : ''}</div></div>`;
    }).join('') : '<div class="inline-empty">Your schedule is clear.<br><a href="calendar.html?add=1">Create an event or meeting →</a></div>';
  }

  yearSelect.addEventListener('change', render);
  monthSelect.addEventListener('change', render);
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
