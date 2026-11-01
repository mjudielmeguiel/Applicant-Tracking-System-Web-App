'use client';
import { useEffect, useRef, useState } from 'react';
import { publicRpc } from '@/lib/public-rpc';
import '@/styles/application.css';
type Job = {id: string; position_title: string; site: string; address?: string; description: string; remaining_slots: number};
type Post = {closed: boolean; reason?: string; title: string; company: {name: string; logo?: string; address?: string}; contact?: {name?: string; email?: string; contact?: string}; jobs: Job[]; expiresAt: string; serverNow: string; applicantLimit: number; submittedCount: number};
export default function JobPostForm({token}: {token: string}) {
  const [post,setPost] = useState<Post|null>(null), [error,setError] = useState(''), [query,setQuery] = useState('');
  const [jobId,setJobId] = useState(''), [busy,setBusy] = useState(false), [submitted,setSubmitted] = useState(false);
  const [basic,setBasic] = useState({name:'',email:'',phone:''}), [remaining,setRemaining] = useState<number|null>(null);
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
    if(!post)return;
    const tick=()=>setRemaining(Math.max(0,Math.ceil((Date.parse(post.expiresAt)-Date.now()-offset.current)/1000)));
    tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);
  },[post]);
  const closed=post?.closed||remaining===0;
  const jobs=(post?.jobs||[]).filter(job=>job.remaining_slots>0);
  const matches=jobs.filter(job=>[job.position_title,job.site,job.address,job.description].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
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
      setSubmitted(true);setBasic({name:'',email:'',phone:''});
    }catch(reason){try{const receipt=await publicRpc<{saved:boolean}>('ats_public_jobs_receipt',{p_token:token,p_request_id:request.current});if(receipt.saved){setSubmitted(true);setError('');try{sessionStorage.setItem('ats_job_post_receipt:'+token,'saved');}catch{}return;}}catch{}setError((reason as Error).message);try{const value=await publicRpc<Post>('ats_public_jobs_open',{p_token:token});offset.current=Date.parse(value.serverNow)-Date.now();setPost(value);}catch{}}
    finally{inFlight.current=false;setBusy(false);}
  }
  return <main className="application-page"><article className="application-card public-job-post">
    <header className="application-brand">{logo&&<img src={logo} alt="Company logo"/>}<div><p className="eyebrow">CAREER OPPORTUNITIES</p><h1>{post?.company.name||'Job openings'}</h1>{post?.company.address&&<p>{post.company.address}</p>}</div></header>
    {error&&!selected&&<p className="form-error" role="alert">{error}</p>}
    {!post&&!error&&<p role="status">Loading available jobs…</p>}
    {post&&<><h2 className="public-post-title">{post.title}</h2><aside className="application-instructions"><p>Applications close on <strong>{new Date(post.expiresAt).toLocaleString()}</strong>.</p><p>{post.submittedCount} of {post.applicantLimit} applications received. The link closes at its deadline or when this limit is reached.</p><p>Choose an available position and location, then submit your basic information. Personal details are optional. No account or document upload is needed here. HR will review your application. Submitting an application does not reserve a job slot.</p></aside>
      {submitted?<section className="application-instructions" role="status"><h2>Application submitted</h2><p>Your application is saved. The recruitment team can review it even after this post closes. Thank you.</p></section>:closed?<section className="application-instructions" role="status"><h2>Applications closed</h2><p>{post.reason||'This job post has expired.'}</p><p>Previously submitted applications are retained for HR review.</p></section>:<>
        <section className="application-positions"><h2>Available job openings</h2><label className="field-label" htmlFor="publicJobSearch">Search position or location</label><input className="field-input" id="publicJobSearch" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Position, site or address"/><div>{matches.map(job=><button className="public-job-card" type="button" key={job.id} disabled={busy} aria-label={'Apply for '+job.position_title+' at '+job.site} onClick={()=>chooseJob(job.id)}><strong>{job.position_title}</strong><span className="public-job-site">{job.site}</span>{job.address&&<span>{job.address}</span>}<span className="public-job-slots">{job.remaining_slots} available {job.remaining_slots===1?'slot':'slots'}</span><span>{job.description}</span><span className="public-job-apply">Apply for this opening →</span></button>)}</div>{!matches.length&&<p>No matching jobs are currently available.</p>}</section>
      </>}
      {post.contact&&<footer className="application-footer"><strong>Recruitment contact: {post.contact.name||post.company.name}</strong>{post.contact.email&&<p><a href={'mailto:'+post.contact.email}>{post.contact.email}</a></p>}{post.contact.contact&&<p>{post.contact.contact}</p>}<p>{post.company.name} · {post.company.address}</p></footer>}
    </>}
    <dialog ref={applicationDialog} className="public-job-modal" aria-labelledby="publicApplicationTitle" onCancel={event=>{if(busy)event.preventDefault();else setJobId('');}}>
      <div className="public-job-modal-head"><div><h2 id="publicApplicationTitle">Apply for {selected?.position_title}</h2><p>{selected?.site}</p></div><button type="button" className="btn-sm ghost" aria-label="Close application form" disabled={busy} onClick={()=>setJobId('')}>×</button></div>
      {selected&&<form onSubmit={submit} className="public-job-modal-body"><fieldset disabled={busy||Boolean(closed)}><legend>Basic applicant information</legend>
        {error&&<p className="form-error" role="alert">{error}</p>}
        <div className="application-grid">{[['name','Full name','text',120],['email','Email address','email',254],['phone','Contact number','tel',25]].map(([key,label,type,max])=><div key={key}><label className="field-label" htmlFor={'public-'+key}>{label}</label><input className="field-input" id={'public-'+key} type={String(type)} maxLength={Number(max)} minLength={key==='name'?2:undefined} pattern={key==='phone'?'[+()0-9 .-]{7,25}':undefined} value={basic[key as keyof typeof basic]} onChange={e=>setBasic({...basic,[key]:e.target.value})}/></div>)}
        <div><label className="field-label" htmlFor="publicJobChoice">Job applied</label><input className="field-input" id="publicJobChoice" value={selected.position_title+' · '+selected.site} readOnly/></div></div>
        {selected.address&&<p className="public-selected-address">{selected.address}</p>}
        <p className="public-job-modal-note">The selected job and location are filled in automatically. HR will review your application.</p>
        <button className="btn btn-primary" type="submit" disabled={busy||Boolean(closed)}>{busy?'Submitting…':'Submit application'}</button>
      </fieldset></form>}
    </dialog>
  </article></main>;
}
