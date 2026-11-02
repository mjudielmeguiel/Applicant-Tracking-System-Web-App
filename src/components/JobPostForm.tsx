'use client';
import { useEffect, useRef, useState } from 'react';
import { publicRpc } from '@/lib/public-rpc';
import '@/styles/application.css';
import ApplicationLanguageSwitch from '@/components/ApplicationLanguageSwitch';
import ApplicantInstructions from '@/components/ApplicantInstructions';
import ApplicationPreview from '@/components/ApplicationPreview';
type Job = {id: string; position_title: string; site: string; address?: string; description: string; remaining_slots: number; creator_name?: string; creator_photo?: string};
type Post = {unavailable?: boolean; closed: boolean; reason?: string; title: string; company: {name: string; logo?: string; address?: string}; contact?: {name?: string; email?: string; contact?: string}; jobs: Job[]; expiresAt: string; serverNow: string; applicantLimit: number; submittedCount: number};
export default function JobPostForm({token}: {token: string}) {
  const [language,setLanguage]=useState<'en'|'tl'>('en');
  const tr=(en:string,tl:string)=>language==='tl'?tl:en;
  const [post,setPost] = useState<Post|null>(null), [error,setError] = useState(''), [query,setQuery] = useState('');
  const [jobId,setJobId] = useState(''), [busy,setBusy] = useState(false), [submitted,setSubmitted] = useState(false);
  const [basic,setBasic] = useState({name:'',email:'',phone:'',gender:'',birthdate:''}), [remaining,setRemaining] = useState<number|null>(null);
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const age=basic.birthdate&&basic.birthdate<=today?Number(today.slice(0,4))-Number(basic.birthdate.slice(0,4))-(today.slice(5)<basic.birthdate.slice(5)?1:0):null;
  const applicationDialog=useRef<HTMLDialogElement>(null);
  const request = useRef(''), offset = useRef(0), inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    if (!/^[a-f0-9]{64}$/.test(token)) {setError('This job post is unavailable.');return;}
    try {
      const key='ats_job_post_request:'+token;
      request.current=sessionStorage.getItem(key)||crypto.randomUUID();sessionStorage.setItem(key,request.current);
      setSubmitted(Boolean(sessionStorage.getItem('ats_job_post_receipt:'+token)));
    } catch {request.current=crypto.randomUUID();}
    publicRpc<{saved:boolean}>('ats_public_jobs_receipt',{p_token:token,p_request_id:request.current}).then(value=>{if(active&&value.saved){setSubmitted(true);try{sessionStorage.setItem('ats_job_post_receipt:'+token,'saved');}catch{}}}).catch(()=>{});
    publicRpc<Post>('ats_public_jobs_open',{p_token:token}).then(value=>{if(active){offset.current=Date.parse(value.serverNow)-Date.now();setPost(value);}}).catch(reason=>{if(active)setError(reason.message);});
    return ()=>{active=false;};
  },[token]);
  useEffect(()=>{
    if(!post||post.unavailable)return;
    const tick=()=>setRemaining(Math.max(0,Math.ceil((Date.parse(post.expiresAt)-Date.now()-offset.current)/1000)));
    tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);
  },[post]);
  const closed=post?.closed||remaining===0;
  const jobs=(post?.jobs||[]).filter(job=>job.remaining_slots>0);
  const matches=jobs.filter(job=>[job.position_title,job.site,job.address,job.description,job.creator_name].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const selected=jobs.find(job=>job.id===jobId);
  useEffect(()=>{const modal=applicationDialog.current;if(!modal)return;if(selected&&!closed&&!submitted){if(!modal.open)modal.showModal();}else if(modal.open)modal.close();},[selected?.id,closed,submitted]);
  function chooseJob(id:string){setError('');setJobId(id);}
  const logo=post?.company.logo&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(post.company.logo)&&post.company.logo.length<900000?post.company.logo:'';
  async function submit(event: React.FormEvent) {
    event.preventDefault();if(inFlight.current||closed||submitted||!selected)return;
    inFlight.current=true;setBusy(true);setError('');
    try {
      const result=await publicRpc<{saved: boolean; applicantId: number}>('ats_public_jobs_submit',{p_token:token,p_job_id:jobId,p_basic:basic,p_request_id:request.current});
      if(!result.saved)throw Error('Your application was not saved. Please retry.');
      try{sessionStorage.setItem('ats_job_post_receipt:'+token,String(result.applicantId));}catch{}
      setSubmitted(true);setBasic({name:'',email:'',phone:'',gender:'',birthdate:''});
    }catch(reason){try{const receipt=await publicRpc<{saved:boolean}>('ats_public_jobs_receipt',{p_token:token,p_request_id:request.current});if(receipt.saved){setSubmitted(true);setError('');try{sessionStorage.setItem('ats_job_post_receipt:'+token,'saved');}catch{}return;}}catch{}setError((reason as Error).message);try{const value=await publicRpc<Post>('ats_public_jobs_open',{p_token:token});offset.current=Date.parse(value.serverNow)-Date.now();setPost(value);}catch{}}
    finally{inFlight.current=false;setBusy(false);}
  }
  return <main className="application-page"><article className="application-card public-job-post">
    <header className="application-brand">{logo&&<img src={logo} alt="Company logo"/>}<div><p className="eyebrow">CAREER OPPORTUNITIES</p><h1>{post?.company.name||'Job openings'}</h1>{post?.company.address&&<p>{post.company.address}</p>}</div></header>
    <ApplicationLanguageSwitch language={language} onLanguage={setLanguage}/>
    <ApplicantInstructions language={language} onLanguage={setLanguage}/>
    {error&&!selected&&<p className="form-error" role="alert">{error}</p>}
    {!post&&!error&&<p role="status">Loading available jobs…</p>}
    {post&&<><h2 className="public-post-title">{post.title}</h2>{!post.unavailable&&<aside className="application-instructions"><p>Applications close on <strong>{new Date(post.expiresAt).toLocaleString()}</strong>.</p><p>{post.submittedCount} of {post.applicantLimit} applications received. The link closes at its deadline or when this limit is reached.</p><p>Choose an available position and location, then submit your basic information. Personal details are optional. No account or document upload is needed here. HR will review your application. Submitting an application does not reserve a job slot.</p></aside>}
      {submitted?<section className="application-instructions" role="status"><h2>Application submitted</h2><p>Your application is saved. The recruitment team can review it even after this post closes. Thank you.</p></section>:closed?<section className="application-instructions" role="status"><h2>Applications closed</h2><p>{post.reason||'This job post has expired.'}</p>{!post.unavailable&&<p>Previously submitted applications are retained for HR review.</p>}</section>:<>
        <section className="application-positions"><h2>Available job openings</h2><label className="field-label" htmlFor="publicJobSearch">Search position or location</label><input className="field-input" id="publicJobSearch" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Position, site or address"/><div>{matches.map(job=><button className="public-job-card" type="button" key={job.id} disabled={busy} aria-label={'Apply for '+job.position_title+' at '+job.site} onClick={()=>chooseJob(job.id)}><span className="public-job-person"><span className="public-job-avatar"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="18" r="11"/><ellipse cx="32" cy="47" rx="22" ry="13"/></svg>{typeof job.creator_photo==='string'&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(job.creator_photo)&&job.creator_photo.length<360000&&<img src={job.creator_photo} alt={(job.creator_name||'Job creator')+' profile picture'} loading="lazy" onError={event=>{event.currentTarget.style.display='none';}}/>}</span><span className="public-job-person-copy"><span className="public-job-creator">{job.creator_name||'Recruitment team'}</span><span className="public-job-byline">{tr('Posted this position','Nag-post ng posisyong ito')}</span></span></span><strong className="public-job-position">{job.position_title}</strong><span className="public-job-tags"><span className="public-job-site">{job.site}</span><span className="public-job-slots">{job.remaining_slots} available {job.remaining_slots===1?'slot':'slots'}</span></span>{job.address&&<span className="public-job-address">{job.address}</span>}<span className="public-job-description">{job.description}</span><span className="public-job-card-footer"><span className="public-job-accepting">{tr('Accepting applications','Tumatanggap ng aplikasyon')}</span><span className="public-job-apply">{tr('Apply now','Mag-apply')} →</span></span></button>)}</div>{!matches.length&&<p>No matching jobs are currently available.</p>}</section>
      </>}
      {post.contact&&<footer className="application-footer"><strong>Recruitment contact: {post.contact.name||post.company.name}</strong>{post.contact.email&&<p><a href={'mailto:'+post.contact.email}>{post.contact.email}</a></p>}{post.contact.contact&&<p>{post.contact.contact}</p>}<p>{post.company.name} · {post.company.address}</p></footer>}
    </>}
    <dialog ref={applicationDialog} className="public-job-modal" aria-labelledby="publicApplicationTitle" onCancel={event=>{if(busy)event.preventDefault();else setJobId('');}}>
      <div className="public-job-modal-head"><div><h2 id="publicApplicationTitle">{tr('Apply for','Mag-apply bilang')} {selected?.position_title}</h2><p>{selected?.site}</p></div><button type="button" className="btn-sm ghost" aria-label="Close application form" disabled={busy} onClick={()=>setJobId('')}>×</button></div>
      {selected&&<form onSubmit={submit} className="public-job-modal-body"><fieldset disabled={busy||Boolean(closed)}><legend>{tr('Basic applicant information','Pangunahing impormasyon ng aplikante')}</legend>
        {error&&<p className="form-error" role="alert">{error}</p>}
        <div className="application-grid">{[['name','Full name','text',120],['email','Email address','email',254],['phone','Contact number','tel',25]].map(([key,label,type,max])=><div key={key}><label className="field-label" htmlFor={'public-'+key}>{language==='tl'?({name:'Buong pangalan',email:'Email address',phone:'Numero ng telepono'}[String(key)]||label):label}</label><input className="field-input" id={'public-'+key} type={String(type)} maxLength={Number(max)} minLength={key==='name'?2:undefined} pattern={key==='phone'?'[+()0-9 .-]{7,25}':undefined} placeholder={key==='name'?'Juan Dela Cruz':key==='email'?'juan@example.com':'0917 123 4567'} value={basic[key as keyof typeof basic]} onChange={e=>setBasic({...basic,[key]:e.target.value})}/></div>)}
        <div><label className="field-label" htmlFor="publicGender">{tr('Gender','Kasarian')}</label><select id="publicGender" className="field-input" value={basic.gender} onChange={e=>setBasic({...basic,gender:e.target.value})}><option value="">{tr('Select gender','Pumili ng kasarian')}</option><option value="Male">{tr('Male','Lalaki')}</option><option value="Female">{tr('Female','Babae')}</option></select></div>
        <div><label className="field-label" htmlFor="publicBirthdate">{tr('Birthdate','Petsa ng kapanganakan')}</label><input id="publicBirthdate" className="field-input" type="date" max={today} value={basic.birthdate} onChange={e=>setBasic({...basic,birthdate:e.target.value})}/></div>
        <div><label className="field-label" htmlFor="publicAge">{tr('Age','Edad')}</label><input id="publicAge" className="field-input" readOnly value={age===null?'':String(age)} placeholder={tr('Calculated from birthdate','Batay sa petsa ng kapanganakan')}/></div>
        <div><label className="field-label" htmlFor="publicJobChoice">{tr('Job applied','Trabahong inaaplayan')}</label><input className="field-input" id="publicJobChoice" value={selected.position_title+' · '+selected.site} readOnly/></div></div>
        {selected.address&&<p className="public-selected-address">{selected.address}</p>}
        <p className="public-job-modal-note">{tr('The selected job and location are filled in automatically. HR will review your application.','Awtomatikong inilagay ang napiling trabaho at lokasyon. Susuriin ng HR ang iyong aplikasyon.')}</p>
        <ApplicationPreview language={language} disabled={busy||Boolean(closed)} entries={[
          ['Full name',basic.name],['Email address',basic.email],['Contact number',basic.phone],['Gender',basic.gender],['Birthdate',basic.birthdate],['Age',age===null?'':String(age)],['Job applied',selected.position_title],['Location / site',selected.site],['Site address',selected.address||'']
        ]}/>
        <button className="btn btn-primary" type="submit" disabled={busy||Boolean(closed)}>{busy?tr('Submitting…','Isinusumite…'):tr('Submit application','Isumite ang aplikasyon')}</button>
      </fieldset></form>}
    </dialog>
  </article></main>;
}
