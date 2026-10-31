const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
const base='http://localhost:3118',token='b'.repeat(64);
const session={id:7,AdminID:7,name:'Test Admin',username:'admin',email:'admin@example.invalid',roleId:2,status:'Active',accountType:'admin',sessionToken:'test-session'};
const user={...session,id:101,UserID:101,name:'Test Recruiter',email:'recruiter@example.invalid',roleId:null,accountType:'user'};
const kinds=['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME'];
const policy={applicant_minutes:60,user_minutes:30,admin_minutes:30,required_fields:['Name','Position','Source','Email Address','Contact Number','Current Address','Site'],instructions:'Complete the form, then upload every requirement. This link stays open until all documents are submitted.'};
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
(async()=>{
 const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--port','3118'],{stdio:'ignore'});let browser;
 try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch(_){}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 async function setup({account=null,submitted=false}={}){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const state={policy:structuredClone(policy),draft:{},revision:0,submitted,closed:false,documents:[],saves:0,created:null,errors:[],uploadFailure:false,contact:'09123456789'};
  if(account)await context.addInitScript(s=>localStorage.setItem('ats_user',JSON.stringify(s)),account);
  const publicContext=()=>state.closed?{closed:true}:{closed:false,phase:state.submitted?'requirements':'application',company:'Test Company',inviter:{name:'Test Recruiter',photo,email:'recruiter@example.invalid',contact:state.contact,role:'Recruitment user'},...(state.submitted?{requiredDocuments:kinds,documents:state.documents}:{draft:state.draft,revision:state.revision,required:state.policy.required_fields,instructions:state.policy.instructions,choices:{Position:['Driver','Closed position'],Source:['Referral'],Site:['ALABANG'],Gender:['Male','Female']},positions:[{name:'Driver',remaining_slots:3},{name:'Closed position',remaining_slots:0}]})};
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.origin===base)return route.continue();
   if(url.hostname.endsWith('.supabase.co')){
    const name=url.pathname.split('/').pop();
    if(name==='application-requirements'){
     const kind=req.postDataBuffer().toString().match(/name="documentType"\r\n\r\n([^\r]+)/)?.[1];
     assert.ok(kinds.includes(kind));
     if(state.uploadFailure){state.uploadFailure=false;return route.fulfill({status:400,json:{error:'Upload interrupted. Retry the document.'}});}
     state.documents.push({id:'doc-'+state.documents.length,type:kind,filename:'requirement.pdf',size:50});
     state.closed=kinds.every(k=>state.documents.some(d=>d.type===k));
     return route.fulfill({json:{saved:true,id:'doc-'+state.documents.length,closed:state.closed}});
    }
    const args=req.postDataJSON()||{};let data={};
    if(name==='ats_me')data=account||session;
    if(name==='ats_catalog_list')data={AdminID:7,sources:[],positions:[],locations:[]};
    if(['ats_applicant_list','ats_invite_list','ats_list_users','ats_applicant_invite_list'].includes(name))data=[];
    if(name==='ats_activity_list')data={items:[],unreadCount:0};
    if(name==='ats_branding_get')data={AdminID:7,details:{name:'Test Company',color:'#192a56'}};
    if(name==='ats_profile_get')data={name:account?.name||'Admin',email:account?.email||session.email,photo,contact:state.contact};
    if(name==='ats_profile_update'){state.contact=args.p_contact;data={saved:true,photo:args.p_profile_picture,contact:state.contact,email:account.email};}
    if(name==='ats_invitation_settings'||name==='ats_invitation_options'){if(args.p_settings)state.policy=args.p_settings;data=state.policy;}
    if(name==='ats_applicant_invite_create'){state.created=args;data={AdminID:7,token,mode:'requirements'};}
    if(name==='ats_application_open')data=publicContext();
    if(name==='ats_application_save'){
     if(state.closed)data={closed:true};
     else if(state.submitted)data=publicContext();
     else{
      assert.equal(args.p_revision,state.revision);const issues=state.policy.required_fields.filter(k=>!args.p_draft[k]?.trim());
      if(args.p_draft.Gender&&!['Male','Female'].includes(args.p_draft.Gender))issues.push('Gender');
      if(args.p_submit&&issues.length)return route.fulfill({status:400,json:{code:'22023',message:'Correct the application information: '+issues.join(', ')}});
      state.draft=args.p_draft;state.revision++;state.saves++;
      if(args.p_submit){state.submitted=true;data={closed:false,phase:'requirements',saved:true,status:'For Pooling'};}
      else data={saved:true,revision:state.revision,issues};
     }
    }
    return route.fulfill({json:data,headers:{'access-control-allow-origin':'*'}});
   }
   return route.fulfill({body:'',contentType:'text/css'});
  });
  const page=await context.newPage();page.on('pageerror',e=>state.errors.push(e.message));page.on('dialog',d=>d.accept());
  return{context,page,state};
 }
 const staff=await setup({account:user});await staff.page.goto(base+'/applicants');await staff.page.locator('#openApplicantInvite').click();
 assert.equal(await staff.page.locator('#applicantInviteMinutes').isVisible(),false);
 await staff.page.locator('#applicantInviteLabel').fill('QA staff applicant');await staff.page.getByRole('button',{name:'Create applicant link'}).click();await staff.page.locator('#applicantInviteLink').waitFor({state:'visible'});
 assert.equal(await staff.page.locator('#applicantInviteLink').inputValue(),base+'/apply#token='+token);
 assert.equal(await staff.page.locator('#openSettings').count(),0);await staff.page.locator('#closeApplicantInvite').click();
 await staff.page.locator('#userAvatar').click();await staff.page.locator('#profileContact').fill('09998887776');await staff.page.getByRole('button',{name:'Save profile',exact:true}).click();await staff.page.locator('#profileDialog').waitFor({state:'hidden'});assert.equal(staff.state.contact,'09998887776');assert.deepEqual(staff.state.errors,[]);await staff.context.close();
 const admin=await setup({account:session});await admin.page.goto(base+'/applicants');await admin.page.locator('#openSettings').click();await admin.page.locator('#policyUser').selectOption('1440');await admin.page.locator('#policyAdmin').selectOption('90');assert.equal(await admin.page.locator('#policyApplicant').isVisible(),false);await admin.page.getByRole('button',{name:'Save invitation settings'}).click();await admin.page.waitForFunction(()=>document.getElementById('appNotice')?.textContent.includes('Invitation settings saved'));assert.equal(admin.state.policy.user_minutes,1440);assert.equal(admin.state.policy.admin_minutes,90);assert.deepEqual(admin.state.errors,[]);await admin.context.close();
 const applicant=await setup();await applicant.page.goto(base+'/apply#token='+token);
 await applicant.page.getByLabel('Full name').waitFor();
 assert.equal(await applicant.page.locator('.application-clock').count(),0);
 assert.match(await applicant.page.locator('.application-recruiter').innerText(),/Test Recruiter.*Recruitment user/s);
 assert.equal(await applicant.page.locator('a[href="mailto:recruiter@example.invalid"]').count(),1);assert.equal(await applicant.page.locator('a[href="tel:09123456789"]').count(),1);
 assert.equal(await applicant.page.locator('.application-recruiter img').count(),1);
 assert.match(await applicant.page.locator('.application-positions').innerText(),/3 available slots/);
 assert.equal(await applicant.page.getByLabel('Job position').locator('option[value="Closed position"]').count(),0);
 assert.deepEqual(await applicant.page.getByLabel('Gender',{exact:true}).locator('option').evaluateAll(options=>options.map(o=>o.value)),['','Male','Female']);
 await applicant.page.getByLabel('Full name').fill('Alex Applicant');await applicant.page.getByRole('button',{name:'Submit application and continue to requirements'}).click();await applicant.page.locator('[role=alert]').waitFor();assert.equal(applicant.state.submitted,false);assert.equal(await applicant.page.getByLabel('Full name').count(),1);
 await applicant.page.getByLabel('Email address').fill('qa@example.invalid');await applicant.page.getByLabel('Contact number').fill('09123456789');await applicant.page.getByLabel('Current address').fill('QA address');await applicant.page.getByLabel('Gender',{exact:true}).selectOption('Female');await applicant.page.getByLabel('Job position').selectOption('Driver');await applicant.page.getByLabel('Location / site').selectOption('ALABANG');await applicant.page.getByLabel('How did you hear').selectOption('Referral');
 await applicant.page.waitForFunction(()=>document.querySelector('.application-save')?.textContent.includes('Draft saved'));
 await applicant.page.reload();await applicant.page.getByLabel('Full name').waitFor();assert.equal(await applicant.page.getByLabel('Full name').inputValue(),'Alex Applicant');
 await applicant.page.getByRole('button',{name:'Submit application and continue to requirements'}).click();await applicant.page.getByRole('heading',{name:'Applicant requirements',exact:true}).waitFor();
 assert.equal(await applicant.page.getByLabel('Full name').count(),0);assert.equal(new URL(applicant.page.url()).hash,'#token='+token);
 const file={name:'requirement.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nQA document\n%%EOF')};
 applicant.state.uploadFailure=true;await applicant.page.locator('[id="upload-SSS"]').setInputFiles(file);await applicant.page.locator('[role=alert]').waitFor();assert.match(await applicant.page.locator('[role=alert]').innerText(),/Upload interrupted/);assert.equal(applicant.state.documents.length,0);
 await applicant.page.locator('[id="upload-SSS"]').setInputFiles(file);await applicant.page.waitForFunction(()=>document.querySelector('.application-requirements')?.textContent.includes('1 of 10'));
 await applicant.page.reload();await applicant.page.getByRole('heading',{name:'Applicant requirements',exact:true}).waitFor();assert.equal(await applicant.page.getByLabel('Full name').count(),0);assert.equal(applicant.state.closed,false);
 await fs.mkdir('test-results',{recursive:true});await applicant.page.screenshot({path:'test-results/applicant-requirements-mobile.png',fullPage:true});
 assert.equal(await applicant.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 for(const kind of kinds.filter(k=>k!=='SSS')){await applicant.page.locator('[id="upload-'+kind+'"]').setInputFiles(file);if(kind!=='RESUME')await applicant.page.waitForFunction(()=>!document.querySelector('input[type=file]:disabled'));}
 await applicant.page.waitForFunction(()=>document.querySelector('.application-save')?.textContent.includes('complete and closed'));
 assert.equal(applicant.state.documents.length,10);assert.equal(new URL(applicant.page.url()).hash,'');assert.equal(await applicant.page.locator('input[type=file]').count(),0);
 await applicant.page.goto(base+'/apply#token='+token);await applicant.page.waitForFunction(()=>document.querySelector('.application-save')?.textContent.includes('complete and closed'));assert.equal(await applicant.page.locator('input').count(),0);assert.deepEqual(applicant.state.errors,[]);await applicant.context.close();
 console.log('PASS: user-created links, profile contact, admin-only settings, positive slots, Male/Female, inviter card, draft resume, required-field correction, requirements-only re-entry, retryable private uploads, final closure and mobile layout.');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
