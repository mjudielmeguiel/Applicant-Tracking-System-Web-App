const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { createServer } = require('../scripts/serve.cjs');

(async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, timezoneId: 'Asia/Manila' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const output = path.resolve(__dirname, '../test-results');
  await fs.mkdir(output, { recursive: true });
  // Test only against an isolated browser context. No real records are changed.
  await context.route('https://fonts.googleapis.com/**', route => route.abort());
  await context.route('https://wqshrjlcjqbjqcophvfv.supabase.co/**', route => route.fulfill({
    json: [
      { AdminID: 1, FullName: 'Test Administrator', Username: 'testadmin', Email: 'admin@example.test', Status: 'Active', RoleID: 2, CreatedAt: '2026-10-01T00:00:00Z' },
      { AdminID: 2, FullName: 'Second Administrator', Username: 'second', Email: 'second@example.test', Status: 'Inactive', RoleID: 2 }
    ]
  }));
  try {
    await page.goto(base + '/dashboard.html');
    await page.evaluate(() => localStorage.setItem('ats_user', JSON.stringify({ id: 1, name: 'Test Administrator', username: 'testadmin', email: 'admin@example.test' })));
    const today = await page.evaluate(() => ATS.today());
    await page.reload();
    assert.equal(await page.locator('#totalCount').innerText(), '0');
    assert.match(await page.locator('#userGreeting').innerText(), /Test Administrator/);
    await page.locator('a[href="applicant-masterlist.html?add=1"]').first().click();
    await page.locator('#applicantDialog[open]').waitFor();
    await page.locator('#applicantName').fill('Alex Applicant');
    await page.locator('#applicantPosition').fill('Frontend Developer');
    await page.locator('#applicantEmail').fill('alex@example.test');
    await page.locator('#applicantStatus').selectOption('Phone Interview');
    await page.locator('#applicantRequirements').fill('65');
    await page.locator('#saveApplicant').click();
    await page.locator('#applicantDialog').waitFor({ state: 'hidden' });
    assert.match(await page.locator('#applicantRows').innerText(), /Alex Applicant/);
    await page.locator('#applicantSearch').fill('missing applicant');
    assert.match(await page.locator('#applicantRows').innerText(), /No applicants match/);
    await page.locator('#clearApplicantFilters').click();
    await page.locator('#applicantRows [data-edit]').click();
    await page.locator('#applicantStatus').selectOption('Final Interview');
    await page.locator('#saveApplicant').click();
    await page.locator('#sidebarToggle').click();
    await page.locator('.nav-link[title="Dashboard"]').click();
    assert.equal(await page.locator('#sidebar').evaluate(element => element.classList.contains('collapsed')), true);
    assert.equal(await page.locator('#totalCount').innerText(), '1');
    assert.equal(await page.locator('#finalCount').innerText(), '1');
    assert.match(await page.locator('#monthlyChart').getAttribute('aria-label'), /: 1/);
    await page.locator('#sidebarToggle').click();
    await page.screenshot({ path: path.join(output, 'dashboard-desktop.png'), fullPage: true, animations: 'disabled' });

    await page.locator('.nav-link[title="Calendar"]').click();
    assert.equal(await page.locator('#monthApplicantCount').innerText(), '1');
    assert.match(await page.locator(`[data-date="${today}"]`).innerText(), /1 applicant/);
    await page.locator('#addEventBtn').click();
    await page.locator('#eventTitle').fill('Recruitment briefing');
    await page.locator('#eventDate').fill(today);
    await page.locator('#eventStart').fill('10:00');
    await page.locator('#eventEnd').fill('09:00');
    await page.locator('#saveEventBtn').click();
    assert.equal(await page.locator('#eventDialog').evaluate(element => element.open), true);
    assert.equal(await page.evaluate(() => ATS.read('ats_events').length), 0);
    await page.locator('#eventEnd').fill('11:00');
    await page.locator('#eventApplicant').selectOption({ label: 'Alex Applicant — Frontend Developer' });
    await page.locator('#saveEventBtn').click();
    await page.locator('#eventDialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#monthEventCount').innerText(), '1');
    await page.locator('#addSelectedEvent').click();
    await page.locator('#eventTitle').fill('Final interview');
    await page.locator('#eventType').selectOption('meeting');
    await page.locator('#eventStart').fill('14:00');
    await page.locator('#eventEnd').fill('15:00');
    await page.locator('#saveEventBtn').click();
    await page.locator('#eventDialog').waitFor({ state: 'hidden' });
    assert.match(await page.locator(`[data-date="${today}"]`).innerText(), /1 applicant[\s\S]*1 event[\s\S]*1 meeting/);
    await page.reload();
    assert.equal(await page.locator('#monthMeetingCount').innerText(), '1');
    await page.locator('#dayAgenda a').first().click();
    await page.locator('#applicantDialog[open]').waitFor();
    assert.equal(await page.locator('#applicantName').inputValue(), 'Alex Applicant');
    await page.keyboard.press('Escape');
    await page.locator('.nav-link[title="Calendar"]').click();
    await page.screenshot({ path: path.join(output, 'calendar-desktop.png'), fullPage: true });
    await page.locator('#addEventBtn').click();
    await page.screenshot({ path: path.join(output, 'event-modal-desktop.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await page.locator('#nextMonth').click();
    assert.notEqual(await page.locator('#monthApplicantCount').innerText(), '1');
    const nextDate = await page.locator('.calendar-day.is-selected').getAttribute('data-date');
    await page.locator('#addSelectedEvent').click();
    assert.equal(await page.locator('#eventDate').inputValue(), nextDate);
    await page.locator('#cancelEventDialog').click();
    await page.locator('#calendarToday').click();
    assert.equal(await page.locator('#monthApplicantCount').innerText(), '1');
    await page.locator('#dayAgenda [data-edit]').first().click();
    await page.locator('#eventTitle').fill('Updated recruitment briefing');
    await page.locator('#saveEventBtn').click();
    await page.locator('#eventDialog').waitFor({ state: 'hidden' });
    assert.match(await page.locator('#dayAgenda').innerText(), /Updated recruitment briefing/);
    await page.locator('#dayAgenda [data-delete]').first().click();
    await page.locator('#deleteEventDialog[open]').waitFor();
    await page.locator('#deleteEventForm [type="submit"]').click();
    await page.locator('#deleteEventDialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#monthEventCount').innerText(), '0');
    assert.equal(await page.locator('#monthMeetingCount').innerText(), '1');

    await page.locator('.nav-link[title="MRF Monitoring"]').click();
    await page.locator('#addMrf').click();
    await page.locator('#mrfPosition').fill('Frontend Developer');
    await page.locator('#mrfDepartment').fill('Engineering');
    await page.locator('#mrfHeadcountInput').fill('2');
    await page.locator('#saveMrf').click();
    await page.locator('#mrfDialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#mrfTotal').innerText(), '1');
    assert.equal(await page.locator('#mrfHeadcount').innerText(), '2');
    await page.locator('#mrfBody [data-edit-mrf]').click();
    await page.locator('#mrfFormStatus').selectOption('Closed');
    await page.locator('#saveMrf').click();
    await page.locator('#mrfDialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#mrfClosed').innerText(), '1');
    await page.locator('#mrfStatus').selectOption('Open');
    assert.match(await page.locator('#mrfBody').innerText(), /No requisitions match/);
    await page.locator('#mrfStatus').selectOption('');
    await page.screenshot({ path: path.join(output, 'mrf-desktop.png'), fullPage: true });

    await page.locator('.nav-link[title="Users List"]').click();
    await page.waitForFunction(() => document.getElementById('usersTotal').textContent === '2');
    await page.locator('#userStatus').selectOption('Inactive');
    assert.match(await page.locator('#usersBody').innerText(), /Second Administrator/);
    assert.doesNotMatch(await page.locator('#usersBody').innerText(), /Test Administrator/);
    await page.locator('#userStatus').selectOption('');
    await page.screenshot({ path: path.join(output, 'users-desktop.png'), fullPage: true });
    await context.unroute('https://wqshrjlcjqbjqcophvfv.supabase.co/**');
    await context.route('https://wqshrjlcjqbjqcophvfv.supabase.co/**', route => route.abort());
    await page.locator('#refreshUsers').click();
    await page.locator('#usersError').waitFor({ state: 'visible' });
    assert.match(await page.locator('#usersBody').innerText(), /Test Administrator/);
    assert.equal(await page.locator('#usersSource').innerText(), 'Current session');

    for (const width of [320, 390, 768, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      for (const file of ['dashboard.html', 'applicant-masterlist.html', 'calendar.html', 'mrf-monitoring.html', 'users.html']) {
        await page.goto(base + '/' + file);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        assert.equal(overflow, false, `${file} overflows viewport at ${width}px`);
        if (width === 390) await page.screenshot({ path: path.join(output, file.replace('.html', '-phone.png')), fullPage: true, animations: 'disabled' });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + '/calendar.html?add=1');
    await page.locator('#eventDialog[open]').waitFor();
    await page.screenshot({ path: path.join(output, 'event-modal-phone.png'), animations: 'disabled' });
    assert.equal(await page.locator('#eventDialog').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    assert.deepEqual(errors, [], 'No browser JavaScript errors');
    console.log('PASS: navigation, shared sidebar state, applicant add/edit/filter, dashboard counts/chart, calendar create/edit/persistence/counts/time validation, applicant links, MRF create/edit/filter, users directory/offline fallback, responsive layouts.');
    console.log(`Screenshots: ${output}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
