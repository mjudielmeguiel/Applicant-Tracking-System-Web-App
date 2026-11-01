'use client';
import { useEffect, useRef, useState } from 'react';
import { publicRpc } from '@/lib/public-rpc';
import '@/styles/application.css';

type Draft = Record<string, string>;
type Inviter = { name?: string; photo?: string; role?: string; email?: string; contact?: string };
type Document = { id: string; type: string; filename: string; size: number; mime_type?: string; review_status?: string; review_comment?: string; automated?: boolean; latest?: boolean; file_available?: boolean };
type Job = {id: string; position_title: string; site: string; address?: string; description: string; remaining_slots: number; required_documents: string[]};
type Context = { closed?: boolean; expired?: boolean; companyInfo?: {name?: string; logo?: string; address?: string}; jobs?: Job[]; job?: Partial<Job>; fixedJob?: string; requirementsDays?: number; requirementsDeadline?: string; serverNow?: string; phase: 'application' | 'requirements'; status?: string; company: string; draft?: Draft; revision?: number; required?: string[]; instructions?: string; choices?: Record<string, string[]>; positions?: { name: string; remaining_slots: number }[]; inviter?: Inviter; requiredDocuments?: string[]; documents?: Document[] };
type Saved = { closed?: boolean; expired?: boolean; phase?: string; revision: number; issues?: string[]; status?: string };
const definitions = [
  ['Name', 'Full name', 'text', 120], ['Email Address', 'Email address', 'email', 254],
  ['Contact Number', 'Contact number', 'tel', 25], ['Current Address', 'Current address', 'textarea', 2000],
  ['Gender', 'Gender', 'select', 120], ['JobOpeningID', 'Job opening and location', 'select', 120],
  ['Source', 'How did you hear about us?', 'select', 120],
] as const;

export default function ApplicationForm() {
  const [context, setContext] = useState<Context | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [message, setMessage] = useState('Opening your invitation…');
  const [error, setError] = useState('');
  const [jobSearch, setJobSearch] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const serverOffset = useRef(0);
  const expiryRefresh = useRef(false);
  const deadlineReached = useRef(false);
  const [closed, setClosed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState('');
  const [preview, setPreview] = useState<{url:string;name:string;mime:string}|null>(null);
  const previewDialog = useRef<HTMLDialogElement>(null);
  const token = useRef('');
  const current = useRef<Draft>({});
  const revision = useRef(0);
  const changed = useRef(0);
  const savedChange = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const initial = useRef<Promise<Context> | null>(null);
  const completed = useRef(false);
  const phase = useRef('application');
  const issues = useRef<string[]>([]);

  function finish() {
    completed.current = true;
    setClosed(true); setDraft({}); current.current = {};
    history.replaceState(null, '', location.pathname);
    setError('');
    setPreview(null);
    setMessage('All required documents have been submitted. Thank you. Your recruitment team will review them. This invitation is now complete and closed.');
  }
  function applyContext(value: Context, preserveDraft = false) {
    if (value.serverNow) serverOffset.current = Date.parse(value.serverNow) - Date.now();
    if (value.closed && value.expired) {
      setContext(value); setClosed(true); deadlineReached.current = true; setRemaining(0);
      setPreview(null); setError(''); setMessage('Requirements overdue — HR review. The time limit has ended and uploads are closed. Contact your recruiter to request a new submission window.'); return;
    }
    if (value.closed) { setContext(value); finish(); return; }
    setClosed(false); deadlineReached.current = false; expiryRefresh.current = false;
    phase.current = value.phase || 'application';
    setContext(value);
    if (phase.current === 'requirements') {
      current.current = {}; setDraft({});
      setMessage('Your application form is submitted. This page is now for requirements only. Reopen this same link whenever you need to upload the remaining documents.');
    } else if (!preserveDraft) {
      current.current = {...(value.draft || {}), ...(!value.draft?.JobOpeningID && value.fixedJob ? {JobOpeningID:value.fixedJob} : {})}; revision.current = value.revision || 0;
      setDraft(current.current);
      setMessage('Your information saves automatically while online. Upload all required documents before the deadline shown below.');
    }
  }
  async function reload(preserveDraft = false) {
    const value = await publicRpc<Context>('ats_application_open', { p_token: token.current });
    applyContext(value, preserveDraft);
  }
  function flush(submit = false) {
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (completed.current || deadlineReached.current || phase.current !== 'application' || (!submit && savedChange.current === changed.current)) return;
      const version = changed.current;
      const result = await publicRpc<Saved>('ats_application_save', { p_token: token.current, p_draft: current.current, p_revision: revision.current, p_submit: submit });
      if (result.closed) { await reload(); return; }
      if (result.phase === 'requirements') { await reload(); return; }
      revision.current = result.revision; savedChange.current = version;
      issues.current = result.issues || [];
      setError(issues.current.length ? 'Please correct: ' + issues.current.join('; ') : '');
      setMessage('Draft saved. ' + new Date().toLocaleTimeString());
    }).catch(reason => { setError(reason.message + ' Your last successfully saved information remains available.'); throw reason; });
    return queue.current;
  }
  useEffect(() => {
    let active = true;
    token.current = new URLSearchParams(location.hash.slice(1)).get('token') || '';
    if (!/^[a-f0-9]{64}$/.test(token.current)) { setClosed(true); setMessage('This invitation link is unavailable. Ask the recruitment team for a new link.'); return; }
    if (!initial.current) initial.current = publicRpc<Context>('ats_application_open', { p_token: token.current });
    initial.current.then(value => { if (active) applyContext(value); }).catch(reason => { if (active) { setClosed(true); setMessage(reason.message); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!context || closed) return;
    const saver = setInterval(() => { void flush().catch(() => {}); }, 5000);
    const resume = () => { if (phase.current === 'application') void flush().catch(() => {}); else void reload().catch(reason => setError(reason.message)); };
    const leaving = () => { void flush().catch(() => {}); };
    const visibility = () => { if (document.hidden) leaving(); else void reload(true).catch(() => {}); };
    window.addEventListener('online', resume); window.addEventListener('pagehide', leaving); document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(saver); window.removeEventListener('online', resume); window.removeEventListener('pagehide', leaving); document.removeEventListener('visibilitychange', visibility); };
  }, [context, closed]);
  useEffect(() => {
    if (!changed.current || closed || submitting || phase.current !== 'application') return;
    const timeout = setTimeout(() => { void flush().catch(() => {}); }, 800);
    return () => clearTimeout(timeout);
  }, [draft, closed, submitting]);
  function update(field: string, value: string) {
    current.current = { ...current.current, [field]: value }; changed.current += 1;
    setDraft(current.current); setMessage('Saving changes…');
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (submitting) return;
    setSubmitting(true);
    try {
      savedChange.current = -1; await flush();
      if (completed.current || phase.current !== 'application') return;
      if (issues.current.length) { setError('Please complete or correct these fields: ' + issues.current.join('; ')); return; }
      if (!confirm('Submit your application information? After submission you can use this link to upload requirements only.')) return;
      await flush(true);
    } catch (_) {} finally { setSubmitting(false); }
  }
  async function upload(kind: string, input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file || uploading || deadlineReached.current) return;
    if (file.size < 1 || file.size > 10485760 || !/\.(pdf|jpe?g|png|docx?)$/i.test(file.name) || kind === 'ID PHOTO' && !/\.(jpe?g|png)$/i.test(file.name)) {
      setError('Choose a PDF, JPG, PNG, DOC or DOCX file between 1 byte and 10 MB.'); return;
    }
    setUploading(kind); setError('');
    try {
      const data = new FormData(); data.append('invitationToken', token.current); data.append('documentType', kind); data.append('file', file);
      const response = await fetch('https://wqshrjlcjqbjqcophvfv.supabase.co/functions/v1/application-requirements', {
        method: 'POST', headers: { apikey: 'sb_publishable_2QWxapvC5t_KHq-0u35d1w_kK-ah1eN' }, body: data, referrerPolicy: 'no-referrer',
      });
      const result = await response.json();
      if (result.expired) { await reload(); return; }
      if (!response.ok || !result.saved) throw Error(result.error || 'The document could not be saved. Please retry.');
      input.value = '';
      if (result.closed) await reload(); else {
        await reload();
        if (result.review_status === 'Rejected') setError(kind + ' automatically rejected: ' + result.review_comment);
      }
    } catch (reason) { setError((reason as Error).message); } finally { setUploading(''); }
  }
  async function previewDocument(document: Document) {
    setError('');
    try {
      const response = await fetch('https://wqshrjlcjqbjqcophvfv.supabase.co/functions/v1/application-requirements', {
        method:'POST',headers:{apikey:'sb_publishable_2QWxapvC5t_KHq-0u35d1w_kK-ah1eN','Content-Type':'application/json'},
        body:JSON.stringify({action:'preview',invitationToken:token.current,documentId:document.id}),referrerPolicy:'no-referrer',
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Preview is unavailable.');
      const url = new URL(result.url);
      if (url.origin !== 'https://wqshrjlcjqbjqcophvfv.supabase.co') throw Error('Invalid private preview URL.');
      const file = await fetch(url); if (!file.ok) throw Error('Preview could not be loaded. Please retry.');
      setPreview({url:URL.createObjectURL(await file.blob()),name:document.filename,mime:result.mime_type});
    } catch(reason) { setError((reason as Error).message); }
  }
  useEffect(() => {
    if (preview) { if (!previewDialog.current?.open) previewDialog.current?.showModal(); }
    else previewDialog.current?.close();
    return () => { if (preview) URL.revokeObjectURL(preview.url); };
  }, [preview]);
  useEffect(() => {
    if (!context?.requirementsDeadline || closed) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((Date.parse(context.requirementsDeadline!) - Date.now() - serverOffset.current) / 1000));
      setRemaining(seconds); deadlineReached.current = seconds === 0;
      if (!seconds && !expiryRefresh.current) { expiryRefresh.current = true; void reload().catch(reason => { setError(reason.message); expiryRefresh.current = false; }); }
    };
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [context?.requirementsDeadline, closed]);
  const inviter = context?.inviter;
  const safePhoto = inviter?.photo && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(inviter.photo) && inviter.photo.length < 360000 ? inviter.photo : '';
  const available = (context?.jobs || []).filter(job => job.remaining_slots > 0);
  const matches = available.filter(job => [job.position_title,job.site,job.address,job.description].join(' ').toLowerCase().includes(jobSearch.trim().toLowerCase()));
  const selectedJob = available.find(job => job.id === draft.JobOpeningID);
  const safeLogo = context?.companyInfo?.logo && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(context.companyInfo.logo) && context.companyInfo.logo.length < 900000 ? context.companyInfo.logo : '';
  const clock = remaining === null ? 'Loading…' : Math.floor(remaining/86400)+'d '+[Math.floor(remaining%86400/3600),Math.floor(remaining%3600/60),remaining%60].map(n=>String(n).padStart(2,'0')).join(':');
  const submittedTypes = new Set((context?.documents || []).filter(document => document.latest !== false && document.review_status !== 'Rejected' && document.file_available !== false).map(document => document.type));
  return <main className="application-page"><article className="application-card">
    <header className="application-brand">{safeLogo && <img src={safeLogo} alt="Company logo" />}<div><p className="eyebrow">RECRUITMENT APPLICATION</p><h1>{context?.companyInfo?.name || context?.company || 'Applicant application'}</h1>{context?.companyInfo?.address && <p>{context.companyInfo.address}</p>}</div></header>
    <p role="status" className="application-save">{message}</p>
    {context?.requirementsDeadline && <aside className="application-clock" aria-label="Requirements deadline"><div><strong>{context.expired ? 'Requirements overdue' : 'Requirements time remaining: '+clock}</strong><p>{context.requirementsDays} day limit · Starts on your first visit</p></div><span>Due {new Date(context.requirementsDeadline).toLocaleString()}<br />Uploads close at the deadline for HR review.</span></aside>}
    {context?.expired && <button type="button" className="btn-sm ghost" onClick={() => void reload().catch(reason => setError(reason.message))}>Check for renewed access</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {inviter && <section className="application-recruiter" aria-label="Your recruitment contact">
      {safePhoto ? <img src={safePhoto} alt={(inviter.name || 'Recruiter') + ' profile'} /> : <span className="recruiter-initials">{(inviter.name || 'Recruitment team').split(/\s+/).map(word => word[0]).slice(0, 2).join('')}</span>}
      <div><p>Invited by</p><strong>{inviter.name || 'Recruitment team'}</strong><p>{inviter.role}</p>
        <p>Email: {inviter.email ? <a href={'mailto:' + inviter.email}>{inviter.email}</a> : 'Not provided'}</p>
        <p>Contact: {inviter.contact ? <a href={'tel:' + inviter.contact.replace(/[^+0-9]/g, '')}>{inviter.contact}</a> : 'Not provided—use email to contact your recruiter'}</p></div>
    </section>}
    {context && !closed && context.phase !== 'requirements' && <>
      <section className="application-instructions"><h2>Instructions</h2><p>{context.instructions}</p><p>Personal details are optional. Choose an available job opening, submit your application information, then upload your requirements using this same link. Your time limit starts when you first open this link. Submit your information and all checked requirements before the displayed deadline. On expiry, uploads close and HR reviews the overdue requirements. This does not automatically reject your application.</p></section>
      <section className="application-positions"><h2>Available job openings</h2><label className="field-label" htmlFor="search-jobs">Search position or location</label><input className="field-input" id="search-jobs" type="search" value={jobSearch} onChange={e=>setJobSearch(e.target.value)} placeholder="Position, location or description" /><div>{matches.map(job => <article key={job.id}><strong>{job.position_title}</strong><p>{job.site}</p>{job.address && <p>{job.address}</p>}<span>{job.remaining_slots} available {job.remaining_slots === 1 ? 'slot' : 'slots'}</span><p className="job-description">{job.description}</p><p>Required: {job.required_documents.join(' · ')}</p><button type="button" className="btn-sm ghost" disabled={submitting || remaining===0} onClick={()=>update('JobOpeningID',job.id)}>{draft.JobOpeningID===job.id?'Selected':'Select opening'}</button></article>)}</div>{!matches.length && <p>No matching available openings. Contact your recruiter or try another search.</p>}<p className="section-subtitle">Availability is checked again on submission. Selecting a job does not reserve a slot.</p></section>
      {selectedJob && <section className="application-instructions"><h2>Selected: {selectedJob.position_title} · {selectedJob.site}</h2>{selectedJob.address && <p>{selectedJob.address}</p>}<p>{selectedJob.description}</p><p>Documents you must submit: {selectedJob.required_documents.join(' · ')}</p></section>}
      <form noValidate onSubmit={submit}><fieldset disabled={submitting || remaining===0}><legend>Your information</legend><div className="application-grid">
        {definitions.map(([key, label, type, max]) => <div key={key} className={type === 'textarea' ? 'application-wide' : ''}>
          <label className="field-label" htmlFor={'apply-' + key}>{label}{(key==='JobOpeningID' || context.required?.includes(key)) ? ' *' : ''}</label>
          {type === 'select' ? <select className="field-input" id={'apply-' + key} value={draft[key] || ''} onChange={e => update(key, e.target.value)}>
            <option value="">Select an option</option>{(key === 'Gender' ? ['Male', 'Female'] : key === 'JobOpeningID' ? available.filter(job=>matches.some(match=>match.id===job.id)||job.id===draft.JobOpeningID).map(job => job.id) : context.choices?.[key] || []).map(option => <option key={option} value={option}>{key==='JobOpeningID' ? (()=>{const job=available.find(j=>j.id===option);return job?.position_title+' · '+job?.site+' · '+job?.remaining_slots+' slots';})() : option}</option>)}
          </select> : type === 'textarea' ? <textarea className="field-input" id={'apply-' + key} maxLength={max} value={draft[key] || ''} onChange={e => update(key, e.target.value)} /> : <input className="field-input" id={'apply-' + key} type={type} maxLength={max} value={draft[key] || ''} onChange={e => update(key, e.target.value)} />}
        </div>)}
      </div><button className="btn btn-primary" type="submit">{submitting ? 'Submitting…' : 'Submit application and continue to requirements'}</button></fieldset></form>
    </>}
    {context && !closed && context.phase === 'requirements' && <section className="application-requirements">
      {context.job && <section className="application-instructions"><h2>{context.job.position_title} · {context.job.site}</h2>{context.job.address && <p>{context.job.address}</p>}<p>{context.job.description}</p></section>}
      <h2>Applicant requirements</h2><p>{submittedTypes.size} of {context.requiredDocuments?.length || 0} requirement categories submitted. Rejected files require a replacement. Documents remain subject to recruiter review.</p>
      <p>Upload PDF, JPG, PNG, DOC or DOCX files up to 10 MB each. Blurred or unclear JPG/PNG images are automatically rejected with instructions. Your personal information is already submitted; use this link for requirements only.</p>
      {(context.requiredDocuments || []).map(kind => <article key={kind}><h3>{kind === 'ID PHOTO' ? '1×1 ID picture' : kind} <span>{(context.documents || []).find(document => document.type === kind && document.latest !== false)?.review_status || (submittedTypes.has(kind) ? 'Submitted' : 'Required')}</span></h3>
        {kind === 'ID PHOTO' && <p>Upload a square JPG/PNG picture, at least 300×300 pixels, suitable for a 1×1 ID photo.</p>}
        {(context.documents || []).filter(document => document.type === kind).map(document => <div key={document.id} className={'application-document ' + (document.review_status === 'Rejected' ? 'document-rejected' : '')}>
          <p>{document.filename} · {Math.ceil(document.size / 1024)} KB · {document.review_status || 'Submitted'}{document.latest === false ? ' · Previous upload' : ''}{document.automated ? ' · Automatic quality check' : ''}</p>
          {document.review_comment && <p className="requirement-comment"><strong>Comment:</strong> {document.review_comment}</p>}
          {['application/pdf','image/png','image/jpeg'].includes(document.mime_type || '') && <button className="btn-sm ghost" type="button" onClick={() => void previewDocument(document)}>Preview {document.filename}</button>}
        </div>)}
        <label className="field-label" htmlFor={'upload-' + kind}>{uploading === kind ? 'Uploading…' : 'Upload ' + kind}</label>
        <input className="field-input" id={'upload-' + kind} type="file" accept={kind === 'ID PHOTO' ? '.jpg,.jpeg,.png' : '.pdf,.jpg,.jpeg,.png,.doc,.docx'} disabled={Boolean(uploading) || submittedTypes.has(kind) || remaining===0} onChange={e => void upload(kind, e.currentTarget)} />
        {submittedTypes.has(kind) && <p>This requirement is submitted. If a recruiter rejects it, this upload field will reopen with their comments.</p>}
      </article>)}
    </section>}
    {context?.companyInfo && <footer className="application-footer"><strong>{context.companyInfo.name}</strong><p>{context.companyInfo.address}</p></footer>}
    <dialog ref={previewDialog} className="application-preview" onClose={() => setPreview(null)}>
      <div className="application-preview-head"><h2>{preview?.name || 'Document preview'}</h2><button type="button" className="btn-sm ghost" onClick={() => setPreview(null)}>Close preview</button></div>
      {preview && (preview.mime === 'application/pdf' ? <iframe title={preview.name} src={preview.url} /> : <img alt={preview.name} src={preview.url} />)}
    </dialog>
  </article></main>;
}
