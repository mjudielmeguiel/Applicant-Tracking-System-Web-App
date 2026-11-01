const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
const {encode}=require('fast-png');
const base='http://localhost:3118',token='b'.repeat(64);
const session={id:7,AdminID:7,name:'Test Admin',username:'admin',email:'admin@example.invalid',roleId:2,status:'Active',accountType:'admin',sessionToken:'test-session'};
const user={...session,id:101,UserID:101,name:'Test Recruiter',email:'recruiter@example.invalid',roleId:null,accountType:'user'};
const job={id:'11111111-1111-4111-8111-111111111111',position_title:'Driver',site:'ALABANG',description:'Deliver goods safely at the Alabang site.',remaining_slots:3,required_documents:['SSS','ID PHOTO']};
const kinds=['NBI','POLICE','SSS','PHILHEALTH','PAG IBIG','TIN','MEDICAL','DIPLOMA','TOR','RESUME','ID PHOTO'];
const policy={requirements_days:3,applicant_minutes:60,user_minutes:30,admin_minutes:30,required_fields:[],instructions:'Complete the form, then upload every requirement. This link stays open until all documents are submitted.'};
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
(async()=>{
 const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--port','3118'],{stdio:'ignore'});let browser;
 try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch(_){}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 async function setup({account=null,submitted=false,sample=false}={}){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const state={policy:structuredClone(policy),draft:{},revision:0,submitted,closed:false,expired:false,deadline:new Date(Date.now()+3*86400000).toISOString(),documents:sample?[{id:'seed-sss',type:'SSS',document_type:'SSS',filename:'sss.png',size:300,byte_size:300,mime_type:'image/png',review_status:'Submitted',latest:true},{id:'seed-police',type:'POLICE',document_type:'POLICE',filename:'police.pdf',size:300,byte_size:300,mime_type:'application/pdf',review_status:'Submitted',latest:true}]:[],saves:0,created:null,errors:[],uploadFailure:false,nextAutoReject:false,reviewCalls:[],contact:'09123456789'};
  if(account)await context.addInitScript(s=>localStorage.setItem('ats_user',JSON.stringify(s)),account);
  const publicContext=()=>state.closed?{closed:true}:{closed:state.expired,expired:state.expired,requirementsDays:3,requirementsDeadline:state.deadline,serverNow:new Date().toISOString(),companyInfo:{name:'Test Company',logo:photo,address:'Company address, Manila'},phase:state.submitted?'requirements':'application',company:'Test Company',inviter:{name:'Test Recruiter',photo,email:'recruiter@example.invalid',contact:state.contact,role:'Recruitment user'},...(state.submitted?{requiredDocuments:kinds,documents:state.documents}:{draft:state.draft,revision:state.revision,required:state.policy.required_fields,instructions:state.policy.instructions,choices:{Position:['Driver','Closed position'],Source:['Referral'],Site:['ALABANG'],Gender:['Male','Female']},jobs:[job,{...job,id:'closed-job',position_title:'Closed position',remaining_slots:0}]})};
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.origin===base)return route.continue();
   if(url.hostname.endsWith('.supabase.co')){
    const name=url.pathname.split('/').pop();
    if(url.pathname.startsWith('/storage/'))return route.fulfill({body:Buffer.from(photo.split(',')[1],'base64'),contentType:url.pathname.includes('pdf')?'application/pdf':'image/png'});
    if(name==='application-requirements'){
     if(req.headers()['content-type']?.includes('application/json')){const d=state.documents.find(d=>d.id===req.postDataJSON().documentId);return route.fulfill({json:{url:'https://wqshrjlcjqbjqcophvfv.supabase.co/storage/v1/object/sign/'+(d.mime_type==='application/pdf'?'preview.pdf':'preview.png'),mime_type:d.mime_type,previewable:true}});}
     const kind=req.postDataBuffer().toString().match(/name="documentType"\r\n\r\n([^\r]+)/)?.[1];
     assert.ok(kinds.includes(kind));
     if(state.uploadFailure){state.uploadFailure=false;return route.fulfill({status:400,json:{error:'Upload interrupted. Retry the document.'}});}
     state.documents.filter(d=>d.type===kind).forEach(d=>d.latest=false);
     const rejected=state.nextAutoReject;state.nextAutoReject=false;
     const image=req.postDataBuffer().toString().includes('Content-Type: image/png');
     const doc={id:'doc-'+state.documents.length,type:kind,document_type:kind,filename:kind==='ID PHOTO'?'id-photo.png':image?'requirement.png':'requirement.pdf',mime_type:image?'image/png':'application/pdf',size:50,byte_size:50,latest:true,review_status:rejected?'Rejected':'Submitted',review_comment:rejected?'The image appears blurred. Please upload a clearer image.':'',automated:rejected};
     state.documents.push(doc);
     state.closed=kinds.every(k=>state.documents.some(d=>d.type===k&&d.latest!==false&&d.review_status!=='Rejected'));
     return route.fulfill({json:{saved:true,id:doc.id,closed:state.closed,review_status:doc.review_status,review_comment:doc.review_comment}});
    }
    const args=req.postDataJSON()||{};let data={};
    if(name==='applicant-documents')return route.fulfill({json:{url:'https://wqshrjlcjqbjqcophvfv.supabase.co/storage/v1/object/sign/'+(args.documentId==='seed-police'?'preview.pdf':'preview.png'),mime_type:args.documentId==='seed-police'?'application/pdf':'image/png',previewable:true}});
    if(name==='ats_me')data=account||session;
    if(name==='ats_jobs_list')data={AdminID:7,jobs:[job]};
    if(name==='ats_job_post_list')data=[];
    if(name==='ats_catalog_list')data={AdminID:7,sources:[],positions:[],locations:[]};
    if(['ats_applicant_list','ats_invite_list','ats_list_users','ats_applicant_invite_list'].includes(name))data=[];
    if(name==='ats_applicant_list'&&sample)data=[{ApplicantID:200,AdminID:7,Name:'Review Applicant',FullName:'Review Applicant',Position:'Driver',PositionApplied:'Driver',Source:'Referral',Site:'ALABANG',Status:'For Pooling',Date:'2026-11-01',DateApplied:'2026-11-01T00:00:00Z'}];
    if(name==='ats_applicant_documents')data=state.documents;
    if(name==='ats_applicant_stage_history')data=[];
    if(name==='ats_document_review'){
     state.reviewCalls.push(args);const doc=state.documents.find(d=>d.id===args.p_document_id);doc.review_status=args.p_status;doc.review_comment=args.p_comment;doc.automated=false;state.closed=false;data={saved:true};
    }
    if(name==='ats_activity_list')data={items:[],unreadCount:0};
    if(name==='ats_branding_get')data={AdminID:7,details:{name:'Test Company',color:'#192a56'}};
    if(name==='ats_profile_get')data={name:account?.name||'Admin',email:account?.email||session.email,photo,contact:state.contact};
    if(name==='ats_profile_update'){state.contact=args.p_contact;data={saved:true,photo:args.p_profile_picture,contact:state.contact,email:account.email};}
    if(name==='ats_invitation_settings'||name==='ats_invitation_options'){if(args.p_settings)state.policy=args.p_settings;data=state.policy;}
    if(name==='ats_applicant_invite_create_v2'){state.created=args;data={AdminID:7,token,mode:'requirements'};}
    if(name==='ats_application_open')data=publicContext();
    if(name==='ats_application_save'){
     if(state.closed)data={closed:true};
     else if(state.submitted)data=publicContext();
     else{
      assert.equal(args.p_revision,state.revision);if(args.p_draft.JobOpeningID){args.p_draft.Position=job.position_title;args.p_draft.Site=job.site;}const issues=args.p_draft.JobOpeningID?[]:['Choose a job opening'];
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
 assert.equal(await staff.page.locator('#applicantInviteMinutes').isVisible(),true);await staff.page.locator('#applicantInviteMinutes').selectOption('7');await staff.page.locator('#applicantInviteJob').selectOption(job.id);
 await staff.page.locator('#applicantInviteLabel').fill('QA staff applicant');await staff.page.getByRole('button',{name:'Create applicant link'}).click();await staff.page.locator('#applicantInviteLink').waitFor({state:'visible'});
 assert.equal(await staff.page.locator('#applicantInviteLink').inputValue(),base+'/apply#token='+token);
 assert.equal(staff.state.created.p_days,7);assert.equal(staff.state.created.p_job_id,job.id);
 assert.equal(await staff.page.locator('#openSettings').count(),0);await staff.page.locator('#closeApplicantInvite').click();
 await staff.page.locator('#userAvatar').click();await staff.page.locator('#profileContact').fill('09998887776');await staff.page.getByRole('button',{name:'Save profile',exact:true}).click();await staff.page.locator('#profileDialog').waitFor({state:'hidden'});assert.equal(staff.state.contact,'09998887776');assert.deepEqual(staff.state.errors,[]);await staff.context.close();
 const admin=await setup({account:session});await admin.page.goto(base+'/applicants');await admin.page.locator('#openSettings').click();await admin.page.locator('#policyUser').selectOption('1440');await admin.page.locator('#policyAdmin').selectOption('90');await admin.page.locator('#policyApplicant').selectOption('2');assert.equal(await admin.page.locator('#policyApplicant').isVisible(),true);await admin.page.getByRole('button',{name:'Save invitation settings'}).click();await admin.page.waitForFunction(()=>document.getElementById('appNotice')?.textContent.includes('Invitation settings saved'));assert.equal(admin.state.policy.requirements_days,2);assert.equal(admin.state.policy.user_minutes,1440);assert.equal(admin.state.policy.admin_minutes,90);assert.deepEqual(admin.state.errors,[]);await admin.context.close();
 const reviewer=await setup({account:user,sample:true});await reviewer.page.goto(base+'/applicants');await reviewer.page.locator('[data-edit="db-200"]').click();await reviewer.page.getByRole('tab',{name:/Requirements/}).click();
 await reviewer.page.locator('[data-preview-document="seed-sss"]').click();await reviewer.page.locator('.document-preview-dialog[open] img').waitFor();await reviewer.page.locator('.document-preview-dialog').getByRole('button',{name:'Close preview'}).click();
 await reviewer.page.locator('[data-preview-document="seed-police"]').click();await reviewer.page.locator('.document-preview-dialog[open] iframe').waitFor();await reviewer.page.locator('.document-preview-dialog').getByRole('button',{name:'Close preview'}).click();
 await reviewer.page.locator('[data-review-document="seed-sss"]').click();await reviewer.page.locator('#documentReviewStatus').selectOption('Rejected');await reviewer.page.getByRole('button',{name:'Save review',exact:true}).click();assert.equal(reviewer.state.reviewCalls.length,0);
 await reviewer.page.locator('#documentReviewComment').fill('SSS image is low quality. Please upload a clear image.');await reviewer.page.getByRole('button',{name:'Save review',exact:true}).click();await reviewer.page.waitForFunction(()=>!document.getElementById('documentReviewDialog').open);assert.equal(reviewer.state.reviewCalls[0].p_status,'Rejected');assert.match(await reviewer.page.locator('#savedDocuments_2').innerText(),/Please upload a clear image/);assert.equal(await reviewer.page.locator('#requirement_2').inputValue(),'Rejected');assert.equal(await reviewer.page.locator('#idPhotoFile').isVisible(),true);assert.deepEqual(reviewer.state.errors,[]);await reviewer.context.close();
 const applicant=await setup();await applicant.page.goto(base+'/apply#token='+token);
 await applicant.page.getByLabel('Full name').waitFor();
 assert.equal(await applicant.page.locator('.application-clock').count(),1);assert.match(await applicant.page.locator('.application-brand').innerText(),/Company address, Manila/);assert.equal(await applicant.page.locator('.application-brand img').count(),1);assert.match(await applicant.page.locator('.application-positions').innerText(),/Deliver goods safely/);
 assert.match(await applicant.page.locator('.application-recruiter').innerText(),/Test Recruiter.*Recruitment user/s);
 assert.equal(await applicant.page.locator('a[href="mailto:recruiter@example.invalid"]').count(),1);assert.equal(await applicant.page.locator('a[href="tel:09123456789"]').count(),1);
 assert.equal(await applicant.page.locator('.application-recruiter img').count(),1);
 assert.match(await applicant.page.locator('.application-positions').innerText(),/3 available slots/);
 assert.equal(await applicant.page.getByLabel('Job opening and location').locator('option[value="Closed position"]').count(),0);
 assert.deepEqual(await applicant.page.getByLabel('Gender',{exact:true}).locator('option').evaluateAll(options=>options.map(o=>o.value)),['','Male','Female']);
 await applicant.page.getByLabel('Full name').fill('Alex Applicant');await applicant.page.getByRole('button',{name:'Submit application and continue to requirements'}).click();await applicant.page.locator('.application-card [role=alert]').waitFor();assert.equal(applicant.state.submitted,false);assert.equal(await applicant.page.getByLabel('Full name').count(),1);
 await applicant.page.getByLabel('Email address').fill('qa@example.invalid');await applicant.page.getByLabel('Contact number').fill('09123456789');await applicant.page.getByLabel('Current address').fill('QA address');await applicant.page.getByLabel('Gender',{exact:true}).selectOption('Female');await applicant.page.getByLabel('Job opening and location').selectOption(job.id);await applicant.page.getByLabel('How did you hear').selectOption('Referral');
 await applicant.page.waitForFunction(()=>document.querySelector('.application-save')?.textContent.includes('Draft saved'));
 await applicant.page.reload();await applicant.page.getByLabel('Full name').waitFor();assert.equal(await applicant.page.getByLabel('Full name').inputValue(),'Alex Applicant');
 await applicant.page.getByRole('button',{name:'Submit application and continue to requirements'}).click();await applicant.page.getByRole('heading',{name:'Applicant requirements',exact:true}).waitFor();
 assert.equal(await applicant.page.getByLabel('Full name').count(),0);assert.equal(new URL(applicant.page.url()).hash,'#token='+token);
 const file={name:'requirement.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nQA document\n%%EOF')};
 const pixels=new Uint8Array(300*300*4);for(let y=0;y<300;y++)for(let x=0;x<300;x++){const i=(y*300+x)*4,v=(Math.floor(x/4)+Math.floor(y/4))%2?25:230;pixels[i]=pixels[i+1]=pixels[i+2]=v;pixels[i+3]=255;}
 const picture={name:'id.png',mimeType:'image/png',buffer:Buffer.from(encode({width:300,height:300,channels:4,depth:8,data:pixels}))};
 applicant.state.uploadFailure=true;await applicant.page.locator('[id="upload-SSS"]').setInputFiles(file);await applicant.page.locator('.application-card [role=alert]').waitFor();assert.match(await applicant.page.locator('.application-card [role=alert]').innerText(),/Upload interrupted/);assert.equal(applicant.state.documents.length,0);
 applicant.state.nextAutoReject=true;await applicant.page.locator('[id="upload-SSS"]').setInputFiles(picture);await applicant.page.waitForFunction(()=>document.querySelector('.application-card [role=alert]')?.textContent.includes('automatically rejected'));assert.equal(await applicant.page.locator('[id="upload-SSS"]').isEnabled(),true);
 await applicant.page.locator('.application-document.document-rejected button').click();await applicant.page.locator('.application-preview[open] img').waitFor();await applicant.page.getByRole('button',{name:'Close preview',exact:true}).click();
 await applicant.page.locator('[id="upload-SSS"]').setInputFiles(picture);await applicant.page.waitForFunction(()=>document.querySelector('.application-requirements')?.textContent.includes('1 of 11'));
 await applicant.page.reload();await applicant.page.getByRole('heading',{name:'Applicant requirements',exact:true}).waitFor();assert.equal(await applicant.page.getByLabel('Full name').count(),0);assert.equal(applicant.state.closed,false);
 await fs.mkdir('test-results',{recursive:true});await applicant.page.screenshot({path:'test-results/applicant-requirements-mobile.png',fullPage:true});
 assert.equal(await applicant.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 let submitted=1;for(const kind of kinds.filter(k=>k!=='SSS')){await applicant.page.locator('[id="upload-'+kind+'"]').setInputFiles(kind==='ID PHOTO'?picture:file);submitted++;if(kind!=='ID PHOTO')await applicant.page.waitForFunction(expected=>document.querySelector('.application-requirements')?.textContent.includes(expected+' of 11'),submitted);}
 await applicant.page.waitForFunction(()=>document.querySelector('.application-save')?.textContent.includes('complete and closed'));
 assert.equal(applicant.state.documents.length,12);assert.equal(new URL(applicant.page.url()).hash,'');assert.equal(await applicant.page.locator('input[type=file]').count(),0);
 await applicant.page.goto(base+'/apply#token='+token);await applicant.page.waitForFunction(()=>document.querySelector('.application-save')?.textContent.includes('complete and closed'));assert.equal(await applicant.page.locator('input').count(),0);assert.deepEqual(applicant.state.errors,[]);await applicant.context.close();
 const reopened=await setup({submitted:true});reopened.state.documents=structuredClone(applicant.state.documents);reopened.state.documents.find(d=>d.type==='SSS'&&d.latest).review_status='Rejected';reopened.state.documents.find(d=>d.type==='SSS'&&d.latest).review_comment='Text too small. Please upload a clearer SSS image.';
 await reopened.page.goto(base+'/apply#token='+token);await reopened.page.getByRole('heading',{name:'Applicant requirements',exact:true}).waitFor();assert.equal(await reopened.page.locator('[id="upload-SSS"]').isEnabled(),true);assert.equal(await reopened.page.locator('[id="upload-ID PHOTO"]').isDisabled(),true);assert.match(await reopened.page.locator('.application-requirements').innerText(),/Text too small/);
 const police=reopened.page.locator('.application-requirements article').filter({has:reopened.page.getByRole('heading',{name:/POLICE/})});await police.getByRole('button',{name:/Preview/}).click();await reopened.page.locator('.application-preview[open] iframe').waitFor();await reopened.page.getByRole('button',{name:'Close preview',exact:true}).click();
 await reopened.page.locator('[id="upload-SSS"]').setInputFiles(picture);await reopened.page.waitForFunction(()=>document.querySelector('.application-save')?.textContent.includes('complete and closed'));assert.deepEqual(reopened.state.errors,[]);await reopened.context.close();

 const optional=await setup();await optional.page.goto(base+'/apply#token='+token);await optional.page.getByLabel('Job opening and location').selectOption(job.id);await optional.page.getByRole('button',{name:'Submit application and continue to requirements'}).click();await optional.page.getByRole('heading',{name:'Applicant requirements',exact:true}).waitFor();assert.equal(optional.state.draft.Name||'','');assert.equal(optional.state.submitted,true);await optional.context.close();
 const overdue=await setup({submitted:true});overdue.state.expired=true;overdue.state.deadline=new Date(Date.now()-10000).toISOString();await overdue.page.goto(base+'/apply#token='+token);await overdue.page.getByRole('button',{name:'Check for renewed access'}).waitFor();assert.match(await overdue.page.locator('.application-save').innerText(),/Requirements overdue/);assert.equal(await overdue.page.locator('input[type=file]').count(),0);assert.equal(new URL(overdue.page.url()).hash,'#token='+token);assert.equal(await overdue.page.locator('.application-recruiter').isVisible(),true);overdue.state.expired=false;overdue.state.deadline=new Date(Date.now()+86400000).toISOString();await overdue.page.getByRole('button',{name:'Check for renewed access'}).click();await overdue.page.getByRole('heading',{name:'Applicant requirements',exact:true}).waitFor();assert.equal(await overdue.page.locator('[id="upload-SSS"]').isEnabled(),true);assert.deepEqual(overdue.state.errors,[]);await overdue.context.close();
 console.log('PASS: staff PDF/image previews and required rejection comments, user-created links, profile contact, slots/gender, autosave, automatic rejection feedback, ID upload, private applicant previews, reopen only rejected category, replacement closure and mobile layout.');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
