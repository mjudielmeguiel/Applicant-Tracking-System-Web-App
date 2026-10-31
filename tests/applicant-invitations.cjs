const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
const base='http://localhost:3118',token='b'.repeat(64);
const session={id:7,AdminID:7,name:'Test Admin',username:'admin',roleId:2,status:'Active',accountType:'admin',sessionToken:'test-session'};
const defaults={applicant_minutes:60,user_minutes:30,admin_minutes:30,required_fields:['Name','Position','Source','Email Address','Contact Number','Current Address','Site'],instructions:'Read every instruction. Complete the required information before the deadline.'};
(async()=>{
 const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--port','3118'],{stdio:'ignore'});
 let browser;
 try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch(_){}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 async function setup({admin=false,seconds=3600,draft={}}={}){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const state={policy:structuredClone(defaults),draft,revision:0,deadline:null,closed:false,status:null,saves:0,created:null,offline:false,errors:[]};
  if(admin)await context.addInitScript(s=>localStorage.setItem('ats_user',JSON.stringify(s)),session);
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.origin===base)return route.continue();
   if(url.hostname.endsWith('.supabase.co')){
    const name=url.pathname.split('/').pop(),args=req.postDataJSON()||{};
    if(state.offline&&name==='ats_application_save')return route.abort();
    let data={};
    if(name==='ats_me')data=session;
    if(name==='ats_catalog_list')data={AdminID:7,sources:[],positions:[],locations:[]};
    if(['ats_applicant_list','ats_invite_list','ats_list_users','ats_applicant_invite_list'].includes(name))data=[];
    if(name==='ats_activity_list')data={items:[],unreadCount:0};
    if(name==='ats_branding_get')data={AdminID:7,details:{name:'Test Company',color:'#192a56'}};
    if(name==='ats_profile_get')data={name:'Admin',photo:null};
    if(name==='ats_invitation_settings'){if(args.p_settings)state.policy=args.p_settings;data=state.policy;}
    if(name==='ats_applicant_invite_create'){state.created=args;data={AdminID:7,token,minutes:args.p_minutes};}
    if(name==='ats_application_open'){
     if(!state.deadline)state.deadline=new Date(Date.now()+seconds*1000).toISOString();
     if(Date.parse(state.deadline)<=Date.now()){state.closed=true;state.status='Rejected';}
     data=state.closed?{closed:true,status:state.status}:{closed:false,company:'Test Company',deadline:state.deadline,serverNow:new Date().toISOString(),draft:state.draft,revision:state.revision,required:state.policy.required_fields,instructions:state.policy.instructions,choices:{Position:['Driver'],Source:['Referral'],Site:['ALABANG']}};
    }
    if(name==='ats_application_save'){
     if(state.closed)data={closed:true,status:state.status};
     else{assert.equal(args.p_revision,state.revision);state.draft=args.p_draft;state.revision++;state.saves++;const issues=state.policy.required_fields.filter(k=>!state.draft[k]?.trim());
      if(args.p_submit){state.closed=true;state.status=issues.length?'Rejected':'For Pooling';data={closed:true,status:state.status};}
      else data={saved:true,revision:state.revision,issues,deadline:state.deadline,serverNow:new Date().toISOString()};
     }
    }
    return route.fulfill({json:data,headers:{'access-control-allow-origin':'*'}});
   }
   return route.fulfill({body:'',contentType:'text/css'});
  });
  const page=await context.newPage();page.on('pageerror',e=>state.errors.push(e.message));page.on('dialog',d=>d.accept());
  return{context,page,state};
 }
 const admin=await setup({admin:true});await admin.page.goto(base+'/applicants');await admin.page.locator('#openApplicantInvite').click();
 await admin.page.locator('#applicantInviteLabel').fill('QA applicant');await admin.page.locator('#applicantInviteMinutes').selectOption('10080');await admin.page.getByRole('button',{name:'Create applicant link'}).click();
 await admin.page.locator('#applicantInviteLink').waitFor({state:'visible'});assert.equal(await admin.page.locator('#applicantInviteLink').inputValue(),base+'/apply#token='+token);assert.equal(admin.state.created.p_minutes,10080);
 await admin.page.locator('#closeApplicantInvite').click();await admin.page.locator('#openSettings').click();await admin.page.locator('#policyApplicant').selectOption('120');await admin.page.locator('#policyUser').selectOption('1440');await admin.page.locator('#policyAdmin').selectOption('90');await admin.page.getByRole('button',{name:'Save invitation settings'}).click();await admin.page.waitForFunction(()=>document.getElementById('appNotice')?.textContent.includes('Invitation settings saved'));
 assert.equal(admin.state.policy.user_minutes,1440);assert.equal(admin.state.policy.admin_minutes,90);assert.equal(admin.state.policy.applicant_minutes,120);assert.deepEqual(admin.state.errors,[]);await admin.context.close();
 const complete=await setup();await complete.page.goto(base+'/apply#token='+token);await complete.page.getByLabel('Full name').fill('Alex Applicant');
 await complete.page.getByLabel('Email address').fill('qa@example.invalid');await complete.page.getByLabel('Contact number').fill('09123456789');await complete.page.getByLabel('Current address').fill('QA address');await complete.page.getByLabel('Job position').selectOption('Driver');await complete.page.getByLabel('Location / site').selectOption('ALABANG');await complete.page.getByLabel('How did you hear').selectOption('Referral');
 await complete.page.waitForFunction(()=>document.querySelector('.application-save')?.textContent.includes('Draft saved'));
 const deadline=complete.state.deadline;await complete.page.reload();await complete.page.getByLabel('Full name').waitFor();assert.equal(await complete.page.getByLabel('Full name').inputValue(),'Alex Applicant');assert.equal(complete.state.deadline,deadline);
 await complete.page.getByRole('button',{name:'Submit application'}).click();await complete.page.waitForFunction(()=>document.querySelector('.application-save')?.textContent.includes('Thank you'));assert.equal(complete.state.status,'For Pooling');assert.equal(new URL(complete.page.url()).hash,'');
 await complete.page.goto(base+'/apply#token='+token);await complete.page.waitForFunction(()=>document.querySelector('form')===null&&document.querySelector('.application-save')?.textContent.includes('closed'));assert.deepEqual(complete.state.errors,[]);await complete.context.close();
 const incomplete=await setup();await incomplete.page.goto(base+'/apply#token='+token);await incomplete.page.getByLabel('Full name').fill('Unfinished');await incomplete.page.getByRole('button',{name:'Submit application'}).click();await incomplete.page.waitForFunction(()=>document.querySelector('.application-save')?.textContent.includes('Rejected'));assert.equal(incomplete.state.status,'Rejected');await incomplete.context.close();
 const timeout=await setup({seconds:2,draft:{Name:'Saved partial'}});await timeout.page.goto(base+'/apply#token='+token);await timeout.page.waitForFunction(()=>document.querySelector('.application-save')?.textContent.includes('Rejected'));assert.equal(await timeout.page.locator('form').count(),0);assert.deepEqual(timeout.state.errors,[]);await timeout.context.close();
 const offline=await setup();await offline.page.goto(base+'/apply#token='+token);await offline.page.getByLabel('Full name').waitFor();offline.state.offline=true;await offline.page.getByLabel('Full name').fill('Offline draft');await offline.page.locator('[role=alert]').waitFor();assert.equal(offline.state.saves,0);offline.state.offline=false;await offline.page.evaluate(()=>window.dispatchEvent(new Event('online')));await offline.page.waitForFunction(()=>document.querySelector('.application-save')?.textContent.includes('Draft saved'));assert.equal(offline.state.draft.Name,'Offline draft');assert.equal(await offline.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(offline.state.errors,[]);await offline.context.close();
 console.log('PASS: admin creation/settings, public draft autosave/resume, single submission, incomplete rejection, countdown expiry, offline retry, mobile layout. No live data written.');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
