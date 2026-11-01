const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
const base='http://localhost:3119',token='f'.repeat(64);
const account={id:7,UserID:7,AdminID:7,name:'HR Recruiter',email:'hr@example.invalid',accountType:'user',roleId:null,status:'Active',sessionToken:'test-session'};
const job={id:'11111111-1111-4111-8111-111111111111',position_title:'Driver',site:'ALABANG',address:'123 Road, Alabang',description:'Deliver items safely.',remaining_slots:2,total_slots:2,filled_count:0,applicant_count:0,required_documents:['SSS'],status:'Open',state:'Open',creator_name:'HR Recruiter',can_edit:true};
(async()=>{
 const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--port','3119'],{stdio:'ignore'});let browser;
 try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
 const state={post:null,create:null,applications:[],requests:[],failNext:true,expired:false},errors=[];
 const contexts=[];
 async function pageFor(staff=false){
  const context=await browser.newContext({viewport:{width:390,height:844}});contexts.push(context);
  if(staff)await context.addInitScript(a=>localStorage.setItem('ats_user',JSON.stringify(a)),account);
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(url.origin===base)return route.continue();
   if(url.hostname.endsWith('.supabase.co')){
    const name=url.pathname.split('/').pop(),args=req.postDataJSON()||{};let data={};
    const responses={ats_me:account,ats_catalog_list:{AdminID:7,sources:[],positions:[],locations:[]},ats_jobs_list:{AdminID:7,jobs:[job]},ats_requirement_activity:[],ats_branding_get:{AdminID:7,details:{name:'Example Company',color:'#192a56'}},ats_profile_get:{name:account.name},ats_activity_list:{items:[],unreadCount:0},ats_applicant_list:[],ats_invitation_options:{requirements_days:3}};
    data=responses[name]||{};
    if(name==='ats_job_post_create'){state.create=args;state.post={id:'post-1',token,label:args.p_label,applicant_limit:args.p_limit,expires_at:args.p_expires_at,submitted_count:0,state:'Open'};data={...state.post,AdminID:7};}
    if(name==='ats_job_post_list')data=args.p_post_id?state.applications:(state.post?[{...state.post,state:state.expired?'Expired':state.post.state}]:[]);
    if(name==='ats_public_jobs_open')data={closed:state.expired||state.post.state!=='Open',reason:state.expired?'This job post has expired.':'The applicant limit has been reached.',title:state.post.label,company:{name:'Example Company',address:'Company address, Manila'},contact:{name:'HR Recruiter',email:'hr@example.invalid'},jobs:[job,{...job,id:'closed-job',position_title:'Closed position',remaining_slots:0}],expiresAt:state.post.expires_at,serverNow:new Date().toISOString(),applicantLimit:state.post.applicant_limit,submittedCount:state.post.submitted_count};
    if(name==='ats_public_jobs_receipt')data={saved:state.applications.some(row=>row.request_id===args.p_request_id)};
    if(name==='ats_public_jobs_submit'){
     state.requests.push(args);if(state.failNext){state.failNext=false;return route.fulfill({status:400,json:{message:'Temporary connection issue. Retry your submission.'}});}
     state.applications.push({request_id:args.p_request_id,id:80,name:args.p_basic.name,position:'Driver',site:'ALABANG',email:args.p_basic.email,contact:args.p_basic.phone,status:'For Pooling',submitted_at:new Date().toISOString()});state.post.submitted_count++;if(state.loseAck){state.loseAck=false;return route.fulfill({status:503,json:{message:'Submission response was interrupted.'}});}data={saved:true,applicantId:80};
    }
    return route.fulfill({json:data,headers:{'access-control-allow-origin':'*'}});
   }
   return route.fulfill({body:'',contentType:'text/css'});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return page;
 }
 const hr=await pageFor(true);await hr.goto(base+'/job-openings');await hr.locator('#createJobPost').click();
 await hr.locator('#jobPostTitle').fill('Join our operations team');await hr.locator('#jobPostLimit').fill('50');await hr.locator('#jobPostDuration').selectOption('3');assert.equal(await hr.locator('#jobPostWebsite').inputValue(),'https://applicant-tracking-system-web-app-chi.vercel.app');await hr.getByRole('button',{name:'Generate link',exact:true}).click();await hr.locator('#generatedJobPostLink').waitFor({state:'visible'});
 assert.equal(await hr.locator('#generatedJobPostLink').inputValue(),'https://applicant-tracking-system-web-app-chi.vercel.app/jobs/'+token);assert.equal(await hr.locator('#openGeneratedJobPost').getAttribute('href'),'https://applicant-tracking-system-web-app-chi.vercel.app/jobs/'+token);assert.equal(state.create.p_limit,50);assert.ok(Date.parse(state.create.p_expires_at)>Date.now()+2*86400000);assert.ok(Date.parse(state.create.p_expires_at)<=Date.now()+7*86400000);
 await hr.getByRole('button',{name:'Close public post form'}).click();
 const applicant=await pageFor();await applicant.goto(base+'/jobs/'+token);await applicant.getByRole('heading',{name:'Available job openings',exact:true}).waitFor();assert.equal(await applicant.locator('form').count(),0);assert.equal(await applicant.locator('input[type=file]').count(),0);assert.equal(await applicant.locator('input[type=password]').count(),0);assert.match(await applicant.locator('.application-positions').innerText(),/ALABANG.*123 Road.*2 available slots/s);assert.doesNotMatch(await applicant.locator('.application-positions').innerText(),/Closed position/);
 await applicant.getByRole('button',{name:'Apply for Driver at ALABANG',exact:true}).click();await applicant.getByRole('dialog').waitFor({state:'visible'});assert.equal(await applicant.getByLabel('Job applied').inputValue(),'Driver · ALABANG');assert.equal(await applicant.getByLabel('Job applied').getAttribute('readonly'),'');assert.equal(await applicant.getByLabel('Current address').count(),0);assert.equal(await applicant.getByLabel('Gender').count(),0);await applicant.getByRole('button',{name:'Close application form'}).click();await applicant.getByRole('dialog').waitFor({state:'hidden'});await applicant.getByRole('button',{name:'Apply for Driver at ALABANG',exact:true}).focus();await applicant.keyboard.press('Enter');await applicant.getByRole('dialog').waitFor({state:'visible'});await applicant.getByLabel('Full name').fill('Alice Applicant');await applicant.getByLabel('Email address',{exact:true}).fill('alice@example.invalid');await applicant.getByLabel('Contact number').fill('09123456789');assert.equal(await applicant.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await fs.mkdir('test-results',{recursive:true});await applicant.screenshot({path:'test-results/public-job-post-mobile.png',fullPage:true});
 await applicant.getByRole('button',{name:'Submit application',exact:true}).click();await applicant.locator('.application-card [role=alert]').waitFor();assert.match(await applicant.locator('.application-card [role=alert]').innerText(),/Temporary connection/);await applicant.getByRole('button',{name:'Submit application',exact:true}).click();await applicant.getByRole('heading',{name:'Application submitted',exact:true}).waitFor();assert.equal(state.requests[0].p_request_id,state.requests[1].p_request_id);assert.equal(state.applications.length,1);
 await applicant.reload();await applicant.getByRole('heading',{name:'Application submitted',exact:true}).waitFor();assert.equal(await applicant.locator('form').count(),0);
 await applicant.evaluate(t=>sessionStorage.removeItem('ats_job_post_receipt:'+t),token);await applicant.reload();await applicant.getByRole('heading',{name:'Application submitted',exact:true}).waitFor();
 const recovered=await pageFor();await recovered.goto(base+'/jobs/'+token);await recovered.getByRole('button',{name:'Apply for Driver at ALABANG',exact:true}).click();await recovered.getByLabel('Full name').fill('Recovered Applicant');state.loseAck=true;await recovered.getByRole('button',{name:'Submit application',exact:true}).click();await recovered.getByRole('heading',{name:'Application submitted',exact:true}).waitFor();assert.equal(state.applications.length,2);
 state.post.state='Limit reached';const capped=await pageFor();await capped.goto(base+'/jobs/'+token);await capped.getByRole('heading',{name:'Applications closed'}).waitFor();assert.equal(await capped.locator('form').count(),0);assert.doesNotMatch(await capped.locator('main').innerText(),/Alice Applicant/);
 state.expired=true;const expired=await pageFor();await expired.goto(base+'/jobs/'+token);await expired.getByRole('heading',{name:'Applications closed'}).waitFor();assert.match(await expired.locator('main').innerText(),/has expired/);
 await hr.locator('#refreshJobPosts').click();await hr.locator('#jobPostList').getByText(/Expired/).waitFor();await hr.getByRole('button',{name:'View applicants (2)',exact:true}).click();await hr.locator('#jobPostApplicants').waitFor({state:'visible'});assert.match(await hr.locator('#jobPostApplicantRows').innerText(),/Alice Applicant.*Driver.*ALABANG.*alice@example.invalid/s);assert.deepEqual(errors,[]);
 for(const context of contexts)await context.close();console.log('PASS public link creation by HR, 50-applicant setting, expiry, available jobs/location/address, basic-only form, mobile layout, retry ID, receipt, closed intake and retained expired-post roster.');
 }finally{await browser?.close();server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
