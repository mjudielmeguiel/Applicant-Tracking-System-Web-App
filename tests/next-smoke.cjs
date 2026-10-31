// Run against a built, running Next server. All remote services are mocked.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const base = process.env.TEST_BASE_URL || 'http://localhost:3117';
const session = { id: 7, AdminID: 7, name: 'Test Admin', username: 'test_admin', email: 'qa@example.invalid', roleId: 2, role: 'Administrator', status: 'Active', accountType: 'admin', sessionToken: 'test-session' };
(async () => {
  const server = process.env.TEST_BASE_URL ? null : spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--port', '3117'], { stdio: 'ignore' });
  if (server) {
    let started = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await fetch(base + '/api/health')).ok) { started = true; break; } } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!started) { server.kill(); throw Error('Next test server did not start. Run npm run build first.'); }
  }
  try {
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const context = await browser.newContext();
  const errors = [];
  await context.addInitScript(value => localStorage.setItem('ats_user', JSON.stringify(value)), session);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: url.pathname.includes('supabase') ? 'window.supabase={createClient:()=>({rpc:async()=>({data:null,error:null})})};' : 'window.dcodeIO={bcrypt:{}};' });
    if (url.hostname.endsWith('.supabase.co')) {
      const name = url.pathname.split('/').pop();
      const responses = {
        ats_me: session, ats_catalog_list: { AdminID: 7, sources: [], positions: [], locations: [] },
        ats_applicant_list: [], ats_list_users: [], ats_invite_list: [],
        ats_invitation_settings: { applicant_minutes:60,user_minutes:30,admin_minutes:30,required_fields:['Name','Position','Source'],instructions:'Complete your application.' },
        ats_applicant_invite_list: [],
        ats_profile_get: { name: session.name, photo: null }, ats_user_photos: { AdminID: 7, photos: {} },
        ats_branding_get: { AdminID: 7, details: { name: 'Test Company', color: '#192a56' } },
        ats_activity_list: { items: [], unreadCount: 0 }, ats_mrf_list: [],
        ats_mrf_context: { AdminID: 7, CompanyID: 'test' },
        ats_invite_context: { AdminID: 7, company: 'Test Company', inviteType: 'admin_handover', fullName: 'New Admin', username: 'new_admin', email: 'new@example.invalid', expiresAt: new Date(Date.now()+1800000).toISOString(), serverNow: new Date().toISOString() }
      };
      return route.fulfill({ json: responses[name] ?? {}, headers: { 'access-control-allow-origin': '*' } });
    }
    return route.fulfill({ body: '', contentType: 'text/css' });
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  try {
    for (const [old, route, heading] of [
      ['dashboard.html', 'dashboard', 'Recruitment overview'],
      ['applicant-masterlist.html', 'applicants', 'Applicant Masterlist'],
      ['mrf-monitoring.html', 'mrf', 'MRF Monitoring'],
      ['users.html', 'users', 'Users List'],
      ['calendar.html', 'calendar', 'Calendar'],
    ]) {
      await page.goto(base + '/' + old);
      await page.waitForURL(base + '/' + route);
      await page.waitForFunction(() => window.ATS?.getUser()?.AdminID === 7 && document.querySelector('.company-name')?.textContent === 'Test Company');
      assert.match(await page.locator('main').innerText(), new RegExp(heading));
      assert.equal(await page.locator('#sidebar').count(), 1);
      assert.equal(await page.locator('.runtime-error').count(), 0);
    }
    await page.goto(base + '/users');
    await page.locator('#openAdminHandover').click();
    await page.locator('#adminHandoverDialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#confirmCurrentAdminPassword').getAttribute('required'), '');
    await page.goto(base + '/invite.html#token=' + 'a'.repeat(64));
    await page.waitForFunction(() => !document.getElementById('invitedUserForm').hidden);
    assert.match(page.url(), /\/invite#token=/);
    assert.equal(await page.locator('#inviteHandoverWarning').isVisible(), true);
    await page.goto(base + '/index.html?invitation=created');
    await page.waitForFunction(() => window.supabase);
    assert.match(await page.locator('#invitationNotice').innerText(), /account was created/);
    assert.equal(new URL(page.url()).search, '?invitation=created');
    await page.goto(base + '/not-a-real-page');
    assert.match(await page.locator('h1').innerText(), /Page not found/);
    assert.deepEqual(errors, []);
    console.log('PASS: five workspace screens, old URLs, scripts, admin modal, invitation fragment, login query and 404.');
  } finally { await browser.close(); }
  } finally { server?.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
