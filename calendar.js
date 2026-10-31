(async function () {
  'use strict';
  if (!await window.ATS.ready) return;
  await window.ATS.applicantsReady;
  const A = window.ATS;
  const $ = (id) => document.getElementById(id);
  const escape = A.escape;
  const dayKey = A.dateKey;
  const parseDate = (value) => new Date(value + 'T12:00:00');
  let selectedDate = A.today();
  let displayedMonth = new Date(parseDate(selectedDate).getFullYear(), parseDate(selectedDate).getMonth(), 1, 12);
  let editingId = null;
  let deletingId = null;
  let applicants = [];
  let events = [];
  const eventDialog = $('eventDialog');
  const deleteDialog = $('deleteEventDialog');
  const form = $('eventForm');

  function dateLabel(value, options) {
    return parseDate(value).toLocaleDateString('en-US', options || { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function timeLabel(value) {
    const parts = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
    if (!parts) return '';
    const hour = Number(parts[1]);
    const minute = Number(parts[2]);
    return new Date(2000, 0, 1, hour, minute).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function itemsOn(date) {
    return {
      applicants: applicants.filter((item) => item.dateApplied === date),
      appointments: A.applicantAppointments().filter(item => item.date === date),
      events: events.filter((item) => item.date === date && item.type === 'event'),
      meetings: events.filter((item) => item.date === date && item.type === 'meeting')
    };
  }

  function countLabel(count, noun) { return count + ' ' + noun + (count === 1 ? '' : 's'); }

  function countChip(count, noun, className) {
    if (!count) return '';
    return '<span class="calendar-day-count ' + className + '"><span class="calendar-chip-number">' + count + '</span><span class="calendar-chip-label"> ' + noun + (count === 1 ? '' : 's') + '</span></span>';
  }

  function render() {
    applicants = A.read('ats_applicants');
    events = A.read('ats_events');
    const year = displayedMonth.getFullYear();
    const month = displayedMonth.getMonth();
    const prefix = year + '-' + String(month + 1).padStart(2, '0') + '-';
    $('calendarMonth').textContent = displayedMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    $('monthApplicantCount').textContent = applicants.filter((item) => String(item.dateApplied).startsWith(prefix)).length;
    $('monthEventCount').textContent = events.filter((item) => item.type === 'event' && String(item.date).startsWith(prefix)).length;
    $('monthMeetingCount').textContent = events.filter((item) => item.type === 'meeting' && String(item.date).startsWith(prefix)).length;
    const first = new Date(year, month, 1, 12);
    const daysInMonth = new Date(year, month + 1, 0, 12).getDate();
    const cells = Math.ceil((first.getDay() + daysInMonth) / 7) * 7;
    let html = '';
    for (let index = 0; index < cells; index++) {
      const date = new Date(year, month, 1 - first.getDay() + index, 12);
      const key = dayKey(date);
      const counts = itemsOn(key);
      const classes = ['calendar-day'];
      if (date.getMonth() !== month) classes.push('is-outside');
      if (key === A.today()) classes.push('is-today');
      if (key === selectedDate) classes.push('is-selected');
      const label = dateLabel(key, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + ': ' + countLabel(counts.applicants.length, 'applicant') + ', ' + countLabel(counts.events.length, 'event') + ', ' + countLabel(counts.meetings.length, 'meeting') + ' · ' + countLabel(counts.appointments.length, 'appointment');
      html += '<button type="button" class="' + classes.join(' ') + '" data-date="' + key + '" aria-label="' + escape(label) + '" aria-pressed="' + (key === selectedDate) + '"><span class="calendar-date-number">' + date.getDate() + '</span>';
      html += countChip(counts.applicants.length, 'applicant', 'applicant-count');
      html += countChip(counts.events.length, 'event', 'event-count');
      html += countChip(counts.meetings.length, 'meeting', 'meeting-count');
      html += countChip(counts.appointments.length, 'appointment', 'meeting-count');
      html += '</button>';
    }
    $('calendarGrid').innerHTML = html;
    renderAgenda();
  }

  function renderAgenda() {
    const counts = itemsOn(selectedDate);
    const schedule = [...counts.events, ...counts.meetings, ...counts.appointments].sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')) || String(a.title || '').localeCompare(String(b.title || '')));
    $('selectedDateLabel').textContent = dateLabel(selectedDate, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    $('selectedDateSummary').textContent = countLabel(counts.applicants.length, 'applicant') + ' · ' + countLabel(counts.events.length, 'event') + ' · ' + countLabel(counts.meetings.length, 'meeting') + ', ' + countLabel(counts.appointments.length, 'appointment');
    let html = '';
    if (!schedule.length && !counts.applicants.length) {
      html = '<div class="agenda-empty"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M8 2v4M16 2v4M3 10h18M8 15h3M8 18h6"/></svg><strong>A little room to plan</strong><p>No applicants, events, or meetings for this date. Add an event to get started.</p></div>';
    }
    if (schedule.length) {
      html += '<h3 class="agenda-section-label">Schedule</h3>';
      schedule.forEach((event) => {
        const kind = event.type === 'meeting' || event.type === 'appointment' ? 'meeting' : 'event';
        const applicant = applicants.find((item) => String(item.id) === String(event.applicantId));
        const start = timeLabel(event.startTime);
        const end = timeLabel(event.endTime);
        const time = start ? start + (end ? ' – ' + end : '') : 'All day';
        html += '<article class="agenda-record"><div class="agenda-record-head"><h3>' + escape(event.title || 'Untitled event') + '</h3><span class="agenda-kind ' + kind + '">' + (event.type === 'appointment' ? 'Appointment' : kind === 'meeting' ? 'Meeting' : 'Event') + '</span></div><p>' + escape(time) + '</p>';
        if (applicant) html += '<p>Applicant: <a href="applicant-masterlist.html?applicant=' + encodeURIComponent(applicant.id) + '">' + escape(applicant.name) + '</a></p>';
        if (event.location) html += '<p>' + escape(event.location) + '</p>';
        if (event.description) html += '<p>' + escape(event.description) + '</p>';
        if (event.type !== 'appointment') html += '<div class="agenda-record-actions"><button type="button" data-edit="' + escape(event.id) + '" aria-label="Edit ' + escape(event.title) + '">Edit</button><button type="button" data-delete="' + escape(event.id) + '" aria-label="Delete ' + escape(event.title) + '">Delete</button></div></article>';
        if (event.type === 'appointment') html += '<p>Response: '+escape(event.response)+'</p></article>';
      });
    }
    if (counts.applicants.length) {
      html += '<h3 class="agenda-section-label">Applied on this day</h3>';
      counts.applicants.forEach((applicant) => {
        html += '<article class="agenda-record"><h3><a href="applicant-masterlist.html?applicant=' + encodeURIComponent(applicant.id) + '">' + escape(applicant.name) + '</a></h3><p>' + escape(applicant.position) + ' · ' + escape(applicant.status) + '</p></article>';
      });
    }
    $('dayAgenda').innerHTML = html;
  }

  function announce(message) {
    $('calendarAnnouncement').textContent = message;
  }

  function openEvent(event) {
    form.reset();
    $('eventError').hidden = true;
    $('eventEnd').setCustomValidity('');
    editingId = event ? event.id : null;
    $('eventDialogTitle').textContent = event ? 'Edit event' : 'Create event';
    $('saveEventBtn').textContent = event ? 'Save changes' : 'Create event';
    $('eventApplicant').innerHTML = '<option value="">No linked applicant</option>' + A.read('ats_applicants').map((applicant) => '<option value="' + escape(applicant.id) + '">' + escape(applicant.name + (applicant.position ? ' — ' + applicant.position : '')) + '</option>').join('');
    $('eventDate').value = event ? event.date : selectedDate;
    if (event) {
      $('eventTitle').value = event.title;
      $('eventType').value = event.type;
      $('eventStart').value = event.startTime || '';
      $('eventEnd').value = event.endTime || '';
      $('eventApplicant').value = event.applicantId || '';
      $('eventLocation').value = event.location || '';
      $('eventDescription').value = event.description || '';
    }
    A.openDialog(eventDialog);
  }

  function validateTimes() {
    const start = $('eventStart').value;
    const end = $('eventEnd').value;
    $('eventEnd').setCustomValidity(end && !start ? 'Choose a start time before setting an end time.' : end && start && end <= start ? 'End time must be after the start time on the same day.' : '');
  }

  $('addEventBtn').addEventListener('click', () => openEvent());
  $('addSelectedEvent').addEventListener('click', () => openEvent());
  ['closeEventDialog', 'cancelEventDialog'].forEach((id) => $(id).addEventListener('click', () => A.closeDialog(eventDialog)));
  $('cancelDeleteEvent').addEventListener('click', () => A.closeDialog(deleteDialog));
  ['eventStart', 'eventEnd'].forEach((id) => $(id).addEventListener('input', validateTimes));
  $('eventTitle').addEventListener('input', () => $('eventTitle').setCustomValidity(''));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    validateTimes();
    $('eventTitle').setCustomValidity($('eventTitle').value.trim() ? '' : 'Enter a title for this event.');
    if (!form.reportValidity()) return;
    const record = { id: editingId || A.id(), title: $('eventTitle').value.trim(), type: $('eventType').value, date: $('eventDate').value, startTime: $('eventStart').value, endTime: $('eventEnd').value, applicantId: $('eventApplicant').value, location: $('eventLocation').value.trim(), description: $('eventDescription').value.trim() };
    try {
      const records = A.read('ats_events');
      if (editingId && !records.some((event) => event.id === editingId)) throw new Error('This event was removed in another tab. Close this form and create a new event.');
      A.save('ats_events', editingId ? records.map((event) => event.id === editingId ? record : event) : [...records, record]);
      selectedDate = record.date;
      const date = parseDate(record.date);
      displayedMonth = new Date(date.getFullYear(), date.getMonth(), 1, 12);
      A.closeDialog(eventDialog);
      render();
      announce(editingId ? 'Event updated.' : 'Event created.');
    } catch (error) {
      $('eventError').textContent = error.message || 'Could not save this event. Please try again.';
      $('eventError').hidden = false;
    }
  });
  $('deleteEventForm').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      A.save('ats_events', A.read('ats_events').filter((event) => event.id !== deletingId));
      A.closeDialog(deleteDialog);
      deletingId = null;
      render();
      announce('Event deleted.');
    } catch (error) {
      $('deleteEventError').textContent = error.message || 'Could not delete this event. Please try again.';
      $('deleteEventError').hidden = false;
    }
  });
  $('dayAgenda').addEventListener('click', (e) => {
    const editButton = e.target.closest('[data-edit]');
    const deleteButton = e.target.closest('[data-delete]');
    if (editButton) {
      const event = A.read('ats_events').find((item) => String(item.id) === editButton.dataset.edit);
      if (event) openEvent(event);
    }
    if (deleteButton) {
      const event = A.read('ats_events').find((item) => String(item.id) === deleteButton.dataset.delete);
      if (!event) return;
      deletingId = event.id;
      $('deleteEventDescription').textContent = '“' + event.title + '” will be removed from your calendar.';
      $('deleteEventError').hidden = true;
      A.openDialog(deleteDialog);
    }
  });
  function chooseDate(key, focus) {
    selectedDate = key;
    const date = parseDate(key);
    displayedMonth = new Date(date.getFullYear(), date.getMonth(), 1, 12);
    render();
    if (focus) $('calendarGrid').querySelector('[data-date="' + key + '"]')?.focus();
  }
  $('calendarGrid').addEventListener('click', (e) => {
    const button = e.target.closest('[data-date]');
    if (button) chooseDate(button.dataset.date, true);
  });
  $('calendarGrid').addEventListener('keydown', (e) => {
    const button = e.target.closest('[data-date]');
    if (!button) return;
    const directions = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(e.key in directions)) return;
    e.preventDefault();
    const date = parseDate(button.dataset.date);
    date.setDate(date.getDate() + directions[e.key]);
    chooseDate(dayKey(date), true);
  });
  function changeMonth(offset) {
    const newMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + offset, 1, 12);
    if (newMonth.getFullYear() < 1900 || newMonth.getFullYear() > 9999) return;
    displayedMonth = newMonth;
    const selectedDay = parseDate(selectedDate).getDate();
    const lastDay = new Date(newMonth.getFullYear(), newMonth.getMonth() + 1, 0, 12).getDate();
    selectedDate = dayKey(new Date(newMonth.getFullYear(), newMonth.getMonth(), Math.min(selectedDay, lastDay), 12));
    render();
  }
  $('previousMonth').addEventListener('click', () => changeMonth(-1));
  $('nextMonth').addEventListener('click', () => changeMonth(1));
  $('calendarToday').addEventListener('click', () => chooseDate(A.today(), false));
  window.addEventListener('storage', (e) => { if (!e.key || /^(ats_applicants|ats_events)(:admin:|$)/.test(e.key)) render(); });
  window.addEventListener('ats:data-change', render);
  async function refreshAppointments(){if(document.hidden||eventDialog.open)return;try{await A.reloadApplicants();}catch(error){A.notify('Unable to refresh appointments.');}}
  window.addEventListener('focus',refreshAppointments);
  setInterval(refreshAppointments,60000);
  render();
  const query = new URLSearchParams(window.location.search);
  if (query.get('add') === '1') {
    query.delete('add');
    const remainingQuery = query.toString();
    window.history.replaceState(null, '', window.location.pathname + (remainingQuery ? '?' + remainingQuery : '') + window.location.hash);
    openEvent();
  }
})();
