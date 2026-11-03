// Run against a built Next server, or set TEST_BASE_URL to an existing server.
// All remote requests are intercepted; these checks never write to Supabase.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const base = (process.env.TEST_BASE_URL || 'http://localhost:3129').replace(/\/$/, '');
const origin = new URL(base).origin;
const session = {
  id: 7, AdminID: 7, name: 'Presence Test Admin', username: 'presence_admin',
  email: 'presence-admin@example.invalid', roleId: 2, role: 'Administrator',
  status: 'Active', accountType: 'admin', sessionToken: 'presence-test-session',
};
const serverNow = Date.parse('2030-06-15T12:00:00Z');
const ago = seconds => new Date(serverNow - seconds * 1000).toISOString();
const user = (UserID, FullName, Status = 'Active', extra = {}) => ({
  UserID, AdminID: 7, FullName, Username: 'presence_user_' + UserID,
  Email: 'presence-' + UserID + '@example.invalid', Role: 'USER', Status,
  CreatedAt: '2026-11-01T00:00:00Z', ...extra,
});
const directory = [
  user(101, 'Available Recruiter'),
  user(102, 'Busy Recruiter', 'Active', { Role: 'RECRUITER' }),
  user(103, 'Minute Recruiter'),
  user(104, 'Hourly Recruiter'),
  user(105, 'Disabled Recruiter', 'Inactive'),
  user(106, 'Stale Recruiter'),
  user(107, 'No Activity Recruiter'),
  user(108, 'Invalid Activity Recruiter'),
  user(109, 'Future Activity Recruiter'),
  user(110, 'Missing Presence Recruiter'),
  user(200, 'Excluded Admin', 'Active', { Role: 'ADMIN' }),
  user(201, 'Other Workspace Recruiter', 'Active', { AdminID: 8 }),
];
const entry = (status, presence, last_seen) => ({ status, presence, last_seen, server_now: new Date(serverNow).toISOString() });
const presence = {
  101: entry('Active', 'Active', ago(15)),
  102: entry('Busy', 'Busy', ago(20)),
  103: entry('Offline', 'Offline', ago(60)),
  104: entry('Inactive', 'Inactive', ago(2 * 3600)),
  // Disabled account access overrides even a live presence response.
  105: entry('Active', 'Active', ago(3 * 86400)),
  // Effective presence, rather than preferred status, determines availability.
  106: entry('Active', 'Offline', ago(4 * 86400)),
  107: entry('Offline', 'Offline', null),
  108: entry('Offline', 'Offline', 'invalid-timestamp'),
  109: entry('Offline', 'Offline', ago(-300)),
};

(async () => {
  let server;
  let browser;
  let presenceRequests = 0;
  const errors = [];
  const unexpectedRemote = [];
  try {
    if (!process.env.TEST_BASE_URL) {
      server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--port', '3129'], { stdio: 'ignore' });
      let started = false;
      for (let attempt = 0; attempt < 150; attempt++) {
        try { if ((await fetch(base + '/api/health')).ok) { started = true; break; } } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(started, 'Next test server did not start. Run npm run build first, or set TEST_BASE_URL.');
    }
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(value => localStorage.setItem('ats_user', JSON.stringify(value)), session);
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (url.hostname === 'cdn.jsdelivr.net') {
        return route.fulfill({ contentType: 'text/javascript', body: url.pathname.includes('supabase') ? 'window.supabase={createClient:()=>({rpc:async()=>({data:null,error:null})})};' : 'window.dcodeIO={bcrypt:{}};' });
      }
      if (url.hostname.endsWith('.supabase.co')) {
        const name = url.pathname.split('/').pop();
        if (name === 'ats_presence_list') {
          presenceRequests++;
          return route.fulfill({ json: presence });
        }
        const responses = {
          ats_me: session,
          ats_list_users: directory,
          ats_presence: entry('Active', 'Active', ago(0)),
          ats_user_limit: { limit: 10, count: 10, remaining: 0 },
          ats_user_photos: { AdminID: 7, photos: {} },
          ats_profile_get: { name: session.name, photo: null },
          ats_branding_get: { AdminID: 7, details: { name: 'Presence Test Company', color: '#192a56' } },
          ats_catalog_list: { AdminID: 7, sources: [], positions: [], locations: [] },
          ats_activity_list: { items: [], unreadCount: 0 },
          ats_requirement_activity: [],
          ats_applicant_list: [],
          ats_invite_list: [],
          ats_applicant_invite_list: [],
          ats_job_post_list: [],
          ats_jobs_list: { AdminID: 7, jobs: [] },
          ats_invitation_settings: { applicant_minutes: 60, user_minutes: 30, admin_minutes: 30, required_fields: ['Name', 'Position', 'Source'], instructions: 'Complete your application.' },
        };
        if (Object.hasOwn(responses, name)) return route.fulfill({ json: responses[name] });
        unexpectedRemote.push(name);
        return route.fulfill({ status: 400, json: { code: 'TEST_UNMOCKED_RPC', message: 'Unexpected remote request in presence test.' } });
      }
      return route.fulfill({ body: '', contentType: 'text/css' });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    // A decade of browser clock skew must not distort recorded server activity.
    await page.clock.install({ time: new Date('2040-06-15T12:00:00Z') });
    await page.goto(base + '/users');
    await page.waitForFunction(() => window.ATS?.getUser()?.AdminID === 7 && document.getElementById('usersTotal')?.textContent.trim() === '10' && !document.getElementById('refreshUsers')?.disabled);

    const row = id => page.locator('#usersBody tr:has([data-manage-user="' + id + '"])');
    const statusCell = id => row(id).locator('td').nth(3);
    async function expectCounts(online, offline) {
      await page.waitForFunction(({ online, offline }) => document.getElementById('usersOnline')?.textContent.trim() === String(online) && document.getElementById('usersOffline')?.textContent.trim() === String(offline), { online, offline });
      assert.equal((await page.locator('#usersTotal').innerText()).trim(), '10');
    }
    async function expectRows(count) {
      await page.waitForFunction(count => document.querySelectorAll('#usersBody [data-manage-user]').length === count, count);
    }

    await expectCounts(2, 8);
    await expectRows(10);
    // Nine accounts are enabled, but only two have effective online presence.
    assert.equal(directory.filter(record => record.AdminID === 7 && ['USER', 'RECRUITER'].includes(record.Role) && record.Status === 'Active').length, 9);
    for (const id of [101, 102]) {
      assert.match(await statusCell(id).innerText(), /^Online\b/);
      assert.equal(await row(id).locator('.user-last-seen').count(), 0, 'Online users do not show an offline activity label.');
    }
    for (const id of [103, 104, 105, 106, 107, 108, 109, 110]) assert.match(await statusCell(id).innerText(), /^Offline\b/, 'User ' + id + ' must be offline.');
    assert.match(await row(103).locator('.user-last-seen').innerText(), /Last active 1 min ago/);
    assert.match(await row(104).locator('.user-last-seen').innerText(), /Last active 2 (?:hr|hour)s? ago/);
    assert.match(await row(105).locator('.user-last-seen').innerText(), /Last active 3 days? ago/);
    assert.match(await row(106).locator('.user-last-seen').innerText(), /Last active 4 days? ago/);
    for (const id of [107, 108, 110]) assert.equal((await row(id).locator('.user-last-seen').innerText()).trim(), 'No activity recorded');
    const futureText = await row(109).locator('.user-last-seen').innerText();
    assert.doesNotMatch(futureText, /NaN|undefined|Invalid Date|\d+\s+\w+\s+(?:from now|in the future)|-\d/);
    assert.ok(/Last active|No activity recorded/.test(futureText), 'A future timestamp must have a safe relative or unavailable label.');
    assert.doesNotMatch(await page.locator('#usersBody').innerText(), /NaN|undefined|Invalid Date/);

    const headers = await page.locator('#usersBody').locator('..').locator('thead th').allTextContents();
    assert.equal(headers.length, 6, 'Users table has six columns.');
    assert.equal(headers.filter(header => header.trim().toLowerCase() === 'status').length, 1);
    assert.doesNotMatch(headers.join(' '), /Presence|Account status/i);
    for (const tr of await page.locator('#usersBody tr').all()) assert.equal(await tr.locator('td').count(), 6);
    const options = await page.locator('#userStatus option').evaluateAll(options => options.map(option => ({ value: option.value, text: option.textContent.trim() })));
    assert.ok(options.some(option => option.value === 'online' && option.text === 'Online'));
    assert.ok(options.some(option => option.value === 'offline' && option.text === 'Offline'));
    assert.ok(!options.some(option => ['active', 'inactive'].includes(option.value.toLowerCase())));
    await fs.mkdir('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/users-online-offline-desktop.png', fullPage: true, animations: 'disabled' });

    await page.locator('[data-user-filter="online"]').click();
    assert.equal(await page.locator('#userStatus').inputValue(), 'online');
    await expectRows(2);
    await expectCounts(2, 8);
    await page.locator('#userSearch').fill('Minute Recruiter');
    await expectRows(0);
    await page.locator('[data-user-filter="offline"]').click();
    assert.equal(await page.locator('#userStatus').inputValue(), 'offline');
    await expectRows(1);
    assert.equal(await row(103).count(), 1, 'Search and presence filters are combined.');
    await expectCounts(2, 8);
    await page.locator('#userSearch').fill('');
    await expectRows(8);
    await page.locator('#userStatus').selectOption('online');
    await expectRows(2);
    await page.locator('#userStatus').selectOption('offline');
    await expectRows(8);
    await page.locator('#userStatus').selectOption('');
    await expectRows(10);

    const beforeRefresh = presenceRequests;
    presence[103].last_seen = ago(5 * 60);
    await page.locator('#refreshUsers').click();
    await page.waitForFunction(() => !document.getElementById('refreshUsers')?.disabled);
    await row(103).locator('.user-last-seen').filter({ hasText: /Last active 5 mins? ago/ }).waitFor();
    assert.ok(presenceRequests > beforeRefresh, 'Manual refresh reloads presence timestamps.');
    await expectCounts(2, 8);

    const beforeHeartbeat = presenceRequests;
    presence[101] = entry('Active', 'Offline', ago(60));
    await page.clock.fastForward(30_001);
    await page.waitForFunction(() => document.getElementById('usersOnline')?.textContent.trim() === '1');
    assert.ok(presenceRequests > beforeHeartbeat, 'The 30-second refresh reloads effective presence.');
    await expectCounts(1, 9);
    assert.match(await statusCell(101).innerText(), /^Offline\b/);
    assert.match(await row(101).locator('.user-last-seen').innerText(), /Last active 1 min ago/);

    for (const width of [360, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Users screen must not overflow at ' + width + 'px.');
      assert.equal(await page.locator('[data-user-filter="online"]').isVisible(), true);
      assert.equal(await page.locator('[data-user-filter="offline"]').isVisible(), true);
      assert.equal(await page.locator('#userStatus').isVisible(), true);
      assert.equal(await page.locator('#usersBody').locator('..').locator('thead th').count(), 6);
      if (width === 390) await page.screenshot({ path: 'test-results/users-online-offline-phone.png', fullPage: true, animations: 'disabled' });
    }
    assert.deepEqual(errors, [], 'No browser runtime errors.');
    assert.deepEqual(unexpectedRemote, [], 'All remote traffic is mocked explicitly.');
    console.log('PASS: Users Online/Offline counts, effective presence, disabled accounts, relative activity with clock skew, combined filters, refreshes, six-column table, and phone widths.');
  } finally {
    await browser?.close();
    server?.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
