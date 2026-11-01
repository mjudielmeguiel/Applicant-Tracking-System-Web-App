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
  let savedJob = null, verificationGate=null;
  const jobs = [{id:'job-1',position_title:'Driver',site:'ALABANG',address:'123 Delivery Road, Alabang',occupied_applicants:[{id:80,name:'Occupied Driver',status:'Hired'}],description:'Deliver goods safely.',remaining_slots:2,total_slots:3,filled_count:1,applicant_count:4,required_documents:['SSS','ID PHOTO'],status:'Open',state:'Open',creator_name:'Test Admin',can_edit:true},{id:'job-2',position_title:'Checker',site:'PASIG',address:'45 Warehouse Road, Pasig',occupied_applicants:[{id:81,name:'Occupied Checker',status:'Deployed'}],description:'Check orders.',remaining_slots:0,total_slots:1,filled_count:1,applicant_count:1,required_documents:['SSS'],status:'Occupied',state:'Open',creator_name:'Other recruiter',can_edit:false}];
  jobs.push({...jobs[0],id:'job-3',site:'MIGHTY MART',address:'78 Mart Road, Manila',occupied_applicants:[],filled_count:0,applicant_count:0,total_slots:2,remaining_slots:2});
  await context.addInitScript(value => localStorage.setItem('ats_user', JSON.stringify(value)), session);
  const mockRequest=async route => {
    const url = new URL(route.request().url());
    if (url.origin === base || url.protocol === 'file:') return route.continue();
    if (url.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: url.pathname.includes('supabase') ? 'window.supabase={createClient:()=>({rpc:async()=>({data:null,error:null})})};' : 'window.dcodeIO={bcrypt:{}};' });
    if (url.hostname.endsWith('.supabase.co')) {
      const name = url.pathname.split('/').pop();
      if(name==='ats_me'&&verificationGate)await verificationGate;
      if(name==='ats_job_save'){const args=route.request().postDataJSON();savedJob=args.p_job;const index=jobs.findIndex(j=>j.id===args.p_id);if(index>=0)jobs[index]={...jobs[index],...savedJob,remaining_slots:savedJob.state==='Occupied'?0:Math.max(0,savedJob.total_slots-jobs[index].filled_count),status:savedJob.state==='Occupied'?'Occupied':'Open'};else jobs.push({...savedJob,id:'new-job',remaining_slots:savedJob.total_slots,filled_count:0,applicant_count:0,status:savedJob.state,creator_name:'Test Admin',can_edit:true});return route.fulfill({json:{saved:true}});}
      const responses = {
        ats_jobs_list: {AdminID:7,jobs}, ats_requirement_activity: [{id:1,applicant_id:9,applicant_name:'Alex Applicant',document_type:'SSS',action:'Submitted',actor_name:'Applicant',created_at:new Date().toISOString()}], ats_me: session, ats_catalog_list: { AdminID: 7, sources: [], positions: [], locations: [] },
        ats_applicant_list: [], ats_list_users: [], ats_invite_list: [],
        ats_invitation_settings: { applicant_minutes:60,user_minutes:30,admin_minutes:30,required_fields:['Name','Position','Source'],instructions:'Complete your application.' },
        ats_applicant_invite_list: [], ats_job_post_list: [],
        ats_profile_get: { name: session.name, photo: null }, ats_user_photos: { AdminID: 7, photos: {} },
        ats_branding_get: { AdminID: 7, details: { name: 'Test Company', color: '#192a56' } },
        ats_activity_list: { items: [], unreadCount: 0 }, ats_mrf_list: [],
        ats_mrf_context: { AdminID: 7, CompanyID: 'test' },
        ats_invite_context: { AdminID: 7, company: 'Test Company', inviteType: 'admin_handover', fullName: 'New Admin', username: 'new_admin', email: 'new@example.invalid', expiresAt: new Date(Date.now()+1800000).toISOString(), serverNow: new Date().toISOString() }
      };
      return route.fulfill({ json: responses[name] ?? {}, headers: { 'access-control-allow-origin': '*' } });
    }
    return route.fulfill({ body: '', contentType: 'text/css' });
  };
  await context.route('**/*',mockRequest);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  try {
    for (const [old, route, heading] of [
      ['dashboard.html', 'dashboard', 'Recruitment overview'],
      ['applicant-masterlist.html', 'applicants', 'Applicant Masterlist'],
      ['mrf-monitoring.html', 'job-openings', 'Job Openings'],
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

    await page.goto(base+'/dashboard');await page.locator('[data-job-id="job-1"]').waitFor();assert.equal(await page.locator('[data-job-id="job-2"]').count(),0);await page.getByRole('button',{name:/Notifications/}).click();await page.getByRole('button',{name:'Requirements updates ↗'}).click();await page.waitForFunction(()=>document.getElementById('requirementModalItems')?.textContent.includes('Alex Applicant'));await page.getByRole('button',{name:'Close requirements activity'}).click();
    assert.ok((await page.locator('.dashboard-positions').boundingBox()).x > (await page.locator('.dashboard-main-panels').boundingBox()).x);
    await page.goto(base+'/job-openings');await page.locator('[data-job-id="job-1"]').waitFor();assert.equal(await page.locator('a[title="MRF Monitoring"]').count(),0);assert.equal(await page.locator('a[title="Job Openings"]').count(),1);
    assert.equal(await page.locator('#jobPositionCards table').count(),1);assert.equal(await page.locator('.job-position-group').filter({hasText:'Driver'}).count(),1);assert.match(await page.locator('[data-job-id="job-3"]').innerText(),/MIGHTY MART.*78 Mart Road, Manila/s);assert.match(await page.locator('[data-job-id="job-1"]').innerText(),/Occupied Driver/);assert.equal(await page.locator('a[href="applicant-masterlist.html?applicant=db-80"]').count(),1);await page.locator('#jobAvailability').selectOption('Occupied');assert.equal(await page.locator('[data-job-id="job-1"]').count(),1);assert.equal(await page.locator('[data-job-id="job-3"]').count(),0);await page.locator('#jobAvailability').selectOption('All');assert.equal(await page.locator('[data-job-id="job-2"]').count(),1);assert.equal(await page.locator('[data-job-id="job-2"] [data-edit-job]').count(),0);
    await page.locator('#jobSearch').fill('PASIG');assert.equal(await page.locator('.job-location-row').count(),1);await page.locator('#jobSearch').fill('');await page.locator('[data-edit-job="job-1"]').click();assert.equal(await page.locator('#jobTitle').getAttribute('readonly'),'');await page.locator('#jobAddress').fill('Updated Alabang address');await page.locator('#jobSlots').fill('5');await page.locator('#jobDescription').fill('Updated Driver description');await page.getByRole('button',{name:'Save job opening'}).click();await page.locator('#jobForm').waitFor({state:'hidden'});assert.equal(savedJob.total_slots,5);assert.equal(savedJob.address,'Updated Alabang address');assert.deepEqual(savedJob.required_documents,['SSS','ID PHOTO']);
    await page.locator('#postJob').click();await page.locator('#jobTitle').fill('Safety Officer');await page.locator('#jobSite').fill('MANILA');await page.locator('#jobAddress').fill('100 Safety Road, Manila');await page.locator('#jobDescription').fill('Maintain site safety records.');await page.locator('#jobSlots').fill('2');await page.locator('#jobClearChecks').click();await page.getByRole('button',{name:'Save job opening'}).click();await page.locator('#jobError').waitFor({state:'visible'});await page.locator('[name=jobRequirement][value=SSS]').check();await page.getByRole('button',{name:'Save job opening'}).click();await page.locator('#jobForm').waitFor({state:'hidden'});assert.deepEqual(savedJob.required_documents,['SSS']);assert.equal(savedJob.site,'MANILA');assert.equal(savedJob.address,'100 Safety Road, Manila');
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'test-results/job-openings-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});
    await page.locator('#userAvatar').click();await page.locator('#openSettings').waitFor({state:'visible'});assert.equal(await page.locator('#accountRole').innerText(),'Administrator');const accountBox=await page.locator('#profileDialog').boundingBox();assert.ok(accountBox.x>page.viewportSize().width/2);assert.ok(accountBox.y<160);await page.screenshot({path:'test-results/minimal-account.png',fullPage:true});await page.locator('#openSettings').click();await page.locator('#editCompanySettings').click();await page.locator('#companySettings').waitFor({state:'visible'});await page.locator('#companyCancel').click();assert.equal(await page.locator('#catalogSettings').isVisible(),true);assert.equal(await page.locator('.sidebar .company-edit').count(),0);assert.equal(await page.locator('#catalogSettings [data-kind="position"]').count(),0);assert.equal(await page.locator('#catalogSettings [data-kind="location"]').count(),0);await page.getByRole('link',{name:'Manage job openings'}).click();await page.waitForURL(base+'/job-openings');
    const fileUrl=require('node:url').pathToFileURL(require('node:path').resolve('dashboard.html')).href;
    await page.goto(fileUrl);await page.locator('a[title="Job Openings"]').click();await page.waitForURL(require('node:url').pathToFileURL(require('node:path').resolve('mrf-monitoring.html')).href);await page.locator('#postJob').waitFor();assert.match(await page.locator('h1').innerText(),/Job Openings/);
    // Slow session verification must not collapse the admin navigation on page changes.
    for(const destination of ['applicant-masterlist.html','mrf-monitoring.html','users.html','calendar.html','dashboard.html']){
      let release;verificationGate=new Promise(resolve=>release=resolve);
      await page.locator('.sidebar a[href="'+destination+'"]').click();
      await page.waitForFunction(()=>Boolean(window.ATS?.ready));
      const usersLink=page.locator('.sidebar a[href="users.html"]');
      assert.equal(await usersLink.isVisible(),true,'Admin Users List stays visible before server verification');
      release();verificationGate=null;await page.evaluate(()=>window.ATS.ready);
      assert.equal(await usersLink.isVisible(),true,'Admin Users List stays visible after server verification');
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

    for(const [width,height,label] of [[360,800,'android-phone'],[800,1280,'android-tablet'],[1280,800,'tablet-landscape']]){
      const mobile=await browser.newContext({viewport:{width,height},hasTouch:true,isMobile:true,deviceScaleFactor:1});
      await mobile.addInitScript(({session,compact})=>{localStorage.setItem('ats_user',JSON.stringify(session));localStorage.setItem('ats_sidebar_collapsed',String(compact));},{session,compact:width===360});await mobile.route('**/*',mockRequest);
      const screen=await mobile.newPage();screen.on('pageerror',e=>errors.push(e.message));
      for(const route of ['dashboard','applicants','job-openings','users','calendar']){
        await screen.goto(base+'/'+route);await screen.waitForFunction(()=>window.ATS?.getUser()?.AdminID===7&&document.querySelector('.company-name')?.textContent==='Test Company');
        assert.equal(await screen.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label+' '+route+' must not overflow the page');
        const rail=await screen.locator('#sidebar').boundingBox();assert.equal(rail.x,0);assert.ok(rail.height>=height-1,label+' navigation should fill the viewport');
        if(width<=1024){
          assert.equal(rail.width,72);assert.equal(await screen.locator('.sidebar .company-edit').count(),0);assert.equal(await screen.getByRole('link',{name:'Dashboard',exact:true}).isVisible(),true);await screen.locator('#sidebarToggle').click();assert.equal(await screen.locator('#sidebarToggle').getAttribute('aria-expanded'),'true');assert.equal(await screen.evaluate(()=>document.querySelector('.main').inert),true);await screen.waitForFunction(()=>document.getElementById('sidebar').getBoundingClientRect().width>200);assert.ok((await screen.locator('#sidebar').boundingBox()).width>72);assert.equal(await screen.locator('#sidebar .nav-text').first().isVisible(),true);await screen.keyboard.press('Escape');assert.equal(await screen.locator('#sidebarToggle').getAttribute('aria-expanded'),'false');assert.equal(await screen.evaluate(()=>document.querySelector('.main').inert),false);await screen.locator('#sidebarToggle').click();await screen.locator('.mobile-nav-backdrop').click({position:{x:width-8,y:100}});assert.equal(await screen.locator('#sidebarToggle').getAttribute('aria-expanded'),'false');
        }
        for(const button of await screen.locator('.topbar button:visible,.table-card-head .btn-sm:visible').all()){
          const bounds=await button.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1,label+' '+route+' action must fit');assert.ok(bounds.height>=43,label+' '+route+' action should be touch-sized');
        }
        if(route==='dashboard')await screen.screenshot({path:'test-results/'+label+'-dashboard.png',fullPage:true});
        if(route==='job-openings'&&width===360){await screen.locator('#postJob').click();await screen.locator('.job-dialog').waitFor({state:'visible'});const bounds=await screen.locator('.job-dialog').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);assert.ok(bounds.height<=height);assert.equal(await screen.locator('#jobTitle').evaluate(node=>getComputedStyle(node).fontSize),'16px');await screen.locator('.job-dialog .dialog-close').click();}
      }
      await mobile.close();
    }
    await page.goto(base + '/not-a-real-page');
    assert.match(await page.locator('h1').innerText(), /Page not found/);
    assert.deepEqual(errors, []);
    console.log('PASS: five workspace screens, old URLs, scripts, admin modal, invitation fragment, login query and 404.');
  } finally { await browser.close(); }
  } finally { server?.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
