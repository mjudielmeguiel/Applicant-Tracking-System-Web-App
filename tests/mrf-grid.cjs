const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { createServer } = require('../scripts/serve.cjs');

// The grid contract is exercised against an isolated mock service. No Supabase
// records are created or changed by this test.
const fields = [
  { key: 'MRFID', label: 'MRF ID', type: 'integer', group: 'source', primary: true, readOnly: true },
  { key: 'MRF No.', label: 'MRF No.', type: 'text', group: 'source', required: true },
  { key: 'POSITION', label: 'Position', type: 'text', group: 'requisition' },
  { key: 'DEPARTMENT', label: 'Department', type: 'text', group: 'requisition' },
  { key: 'STATUS', label: 'Status', type: 'text', group: 'requisition' },
  { key: 'CREATED DATE', label: 'Created date', type: 'date', group: 'requisition' },
  { key: 'APPROVED DATE', label: 'Approved date', type: 'date', group: 'requisition' },
  { key: 'DATE OF DEPLOYMENT', label: 'Date of deployment', type: 'date', group: 'deployment' },
  { key: 'MRF Completed Date', label: 'MRF completed date', type: 'date', group: 'deployment' },
  { key: 'Commitment date', label: 'Commitment date', type: 'date', group: 'deployment' },
  { key: 'Headcount', label: 'Headcount', type: 'integer', group: 'metrics' },
  { key: 'Feedback', label: 'Feedback', type: 'text', group: 'feedback' },
  { key: 'ExcelSheet', label: 'Source worksheet', type: 'text', group: 'import', readOnly: true },
  { key: 'ExcelRow', label: 'Source row', type: 'integer', group: 'import', readOnly: true },
  { key: 'ExcelData', label: 'Original workbook data', type: 'json', group: 'import', readOnly: true },
  { key: 'CreatedAt', label: 'Created at', type: 'datetime', group: 'system', readOnly: true }
];

(async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, timezoneId: 'Asia/Manila' });
  const page = await context.newPage();
  const base = `http://127.0.0.1:${server.address().port}`;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const output = path.resolve(__dirname, '../test-results');
  await fs.mkdir(output, { recursive: true });
  let records = Array.from({ length: 56 }, (_, index) => ({
    MRFID: index + 1, 'MRF No.': `TEST-${String(index + 1).padStart(3, '0')}`, POSITION: `Test position ${index + 1}`,
    DEPARTMENT: index % 2 ? 'Operations' : 'Engineering', STATUS: index % 2 ? 'Closed' : 'Open',
    'CREATED DATE': index < 28 ? '2026-10-01' : '2026-10-20', 'APPROVED DATE': '2026-10-22',
    Headcount: index + 1, Feedback: index === 54 ? 'Unique workbook feedback' : '', ExcelSheet: `Worksheet ${index % 3 + 1}`,
    ExcelRow: index + 2, ExcelData: { original: `Workbook row ${index + 1}`, 'Invalid date': 'Pending approval' },
    CreatedAt: '2026-10-31T03:00:00Z'
  }));
  let failLoad = false;
  let failSave = false;
  const writes = [];
  await context.route('https://fonts.googleapis.com/**', route => route.abort());
  await context.route('**/mrf-store.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.MRFStore = {
      fields: ${JSON.stringify(fields)},
      value(record,key) { return record[key] == null && record.ExcelData && record.ExcelData[key] != null ? record.ExcelData[key] : record[key]; },
      async list() { const response = await fetch('/__mrf_test__'); if (!response.ok) throw new Error('Permission denied for MRF_Monitoring.'); return response.json(); },
      async save(record,id) { const response = await fetch('/__mrf_test__' + (id == null ? '' : '/' + id), { method:id == null ? 'POST' : 'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(record) }); if(!response.ok) throw new Error('Supabase could not save this MRF record.'); return response.json(); }
    };`
  }));
  await context.route('**/__mrf_test__**', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ status: failLoad ? 403 : 200, json: failLoad ? { error: 'permission denied' } : records });
    if (failSave) return route.fulfill({ status: 403, json: { error: 'save denied' } });
    const change = request.postDataJSON();
    writes.push({ method: request.method(), data: change });
    let saved;
    if (request.method() === 'PATCH') {
      const id = Number(new URL(request.url()).pathname.split('/').pop());
      saved = { ...records.find(record => record.MRFID === id), ...change };
      records = records.map(record => record.MRFID === id ? saved : record);
    } else {
      saved = { ...change, MRFID: records.length + 1, CreatedAt: new Date().toISOString() };
      records.push(saved);
    }
    return route.fulfill({ json: saved });
  });
  try {
    await page.goto(base + '/mrf-monitoring.html');
    await page.waitForFunction(() => document.getElementById('mrfTotal').textContent === '56');
    assert.equal(await page.locator('#mrfHead [data-sort]').count(), fields.length, 'Every database field starts visible');
    assert.equal(await page.locator('#mrfBody tr').count(), 25);
    assert.equal(await page.locator('#mrfSheets').innerText(), '3');
    assert.equal(await page.locator('#mrfDateField').inputValue(), 'CREATED DATE');
    assert.equal(await page.locator('#mrfConnection').getAttribute('data-state'), 'connected');
    await page.locator('#mrfNext').click();
    assert.equal(await page.locator('#mrfPageLabel').innerText(), 'Page 2 of 3');
    assert.equal(await page.locator('#mrfBody tr:first-child .mrf-identity-cell').innerText(), '26');
    await page.locator('#mrfPageSize').selectOption('50');
    assert.equal(await page.locator('#mrfBody tr').count(), 50);
    assert.equal(await page.locator('#mrfPageLabel').innerText(), 'Page 1 of 2');
    await page.locator('[data-sort="MRFID"]').click();
    assert.equal(await page.locator('#mrfBody tr:first-child .mrf-identity-cell').innerText(), '56');
    await page.locator('[data-sort="MRFID"]').click();
    await page.locator('#mrfSearch').fill('unique workbook feedback');
    assert.equal(await page.locator('#mrfMatching').innerText(), '1');
    assert.match(await page.locator('#mrfBody').innerText(), /TEST-055/);
    await page.locator('#mrfColumns summary').click();
    await page.locator('#mrfColumnSearch').fill('Feedback');
    await page.locator('[data-column="Feedback"]').uncheck();
    assert.equal(await page.locator('#mrfHead [data-sort="Feedback"]').count(), 0);
    assert.equal(await page.locator('#mrfMatching').innerText(), '1', 'Hidden fields remain searchable');
    await page.locator('#showAllMrfColumns').click();
    assert.equal(await page.locator('#mrfHead [data-sort]').count(), fields.length);
    await page.locator('#mrfColumns summary').click();
    await page.locator('#clearMrfFilters').click();
    await page.locator('#mrfSheet').selectOption('Worksheet 1');
    assert.equal(await page.locator('#mrfMatching').innerText(), '19');
    await page.locator('#mrfStatus').selectOption('Closed');
    assert.equal(await page.locator('#mrfMatching').innerText(), '9');
    await page.locator('#clearMrfFilters').click();
    await page.locator('#mrfFrom').fill('2026-10-15');
    assert.equal(await page.locator('#mrfMatching').innerText(), '28');
    await page.locator('#mrfTo').fill('2026-10-01');
    assert.equal(await page.locator('#mrfFilterError').isVisible(), true);
    await page.locator('#clearMrfFilters').click();
    await page.locator('#mrfBody [data-source-field="ExcelData"]').first().click();
    await page.locator('#mrfSourceDialog[open]').waitFor();
    assert.match(await page.locator('#mrfSourceData').innerText(), /Pending approval/);
    await page.locator('#closeMrfSource').click();
    await page.locator('#addMrf').click();
    await page.locator('#saveMrf').click();
    assert.equal(writes.length, 0, 'Required MRF number prevents incomplete create');
    await page.locator('[data-mrf-field="MRF No."]').fill('TEST-NEW');
    await page.locator('[data-mrf-field="POSITION"]').fill('New test position');
    await page.locator('[data-mrf-field="STATUS"]').fill('Open');
    failSave = true;
    await page.locator('#saveMrf').click();
    await page.locator('#mrfFormError').waitFor({ state: 'visible' });
    assert.match(await page.locator('#mrfFormError').innerText(), /could not save/);
    assert.equal(await page.locator('#mrfDialog').evaluate(dialog => dialog.open), true);
    failSave = false;
    await page.locator('#saveMrf').click();
    await page.locator('#mrfDialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#mrfTotal').innerText(), '57');
    assert.equal(writes[0].method, 'POST');
    assert.equal(Object.hasOwn(writes[0].data, 'MRFID'), false);
    await page.locator('#mrfSearch').fill('TEST-NEW');
    await page.locator('#mrfBody [data-edit-mrf]').click();
    await page.locator('[data-mrf-field="STATUS"]').fill('Closed');
    await page.locator('#saveMrf').click();
    await page.locator('#mrfDialog').waitFor({ state: 'hidden' });
    assert.deepEqual(writes[1], { method: 'PATCH', data: { STATUS: 'Closed' } }, 'Edits send changed fields only');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('mrfTotal').textContent === '57');
    await page.locator('#mrfSearch').fill('TEST-NEW');
    assert.match(await page.locator('#mrfBody').innerText(), /Closed/);
    await page.locator('#clearMrfFilters').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#exportMrfs').click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^mrf-monitoring-.*\.csv$/);
    await page.screenshot({ path: path.join(output, 'mrf-full-grid-desktop.png'), fullPage: true });
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Grid must remain contained at ${width}px`);
      assert.equal(await page.locator('#mrfGridScroll').evaluate(element => element.scrollWidth > element.clientWidth), true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'mrf-full-grid-phone.png'), fullPage: true });
    await page.locator('#addMrf').click();
    assert.equal(await page.locator('#mrfDialog').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    await page.keyboard.press('Escape');
    failLoad = true;
    await page.locator('#refreshMrfs').click();
    await page.locator('#mrfError').waitFor({ state: 'visible' });
    assert.match(await page.locator('#mrfErrorMessage').innerText(), /Previously loaded results/);
    await page.reload();
    await page.locator('#mrfError').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#mrfTotal').innerText(), '—');
    assert.match(await page.locator('#mrfErrorMessage').innerText(), /Permission denied/);
    assert.equal(await page.locator('#addMrf').isDisabled(), true);
    assert.equal(await page.evaluate(() => localStorage.getItem('ats_mrfs')), null, 'No silent local-storage fallback');
    assert.deepEqual(errors, [], 'No browser JavaScript errors');
    console.log('PASS: full MRF field grid, source values, filters/sort/pagination/columns, required create, changed-only edit, save errors, persistence, export, responsive containment and explicit connection failures.');
  } finally {
    await context.close();
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
