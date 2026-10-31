'use client';
import { useEffect, useRef, useState } from 'react';
import { publicRpc } from '@/lib/public-rpc';
import '@/styles/application.css';

type Draft = Record<string, string>;
type Inviter = { name?: string; photo?: string; role?: string; email?: string; contact?: string };
type Document = { id: string; type: string; filename: string; size: number };
type Context = { closed?: boolean; phase: 'application' | 'requirements'; status?: string; company: string; draft?: Draft; revision?: number; required?: string[]; instructions?: string; choices?: Record<string, string[]>; positions?: { name: string; remaining_slots: number }[]; inviter?: Inviter; requiredDocuments?: string[]; documents?: Document[] };
type Saved = { closed?: boolean; phase?: string; revision: number; issues?: string[]; status?: string };
const definitions = [
  ['Name', 'Full name', 'text', 120], ['Email Address', 'Email address', 'email', 254],
  ['Contact Number', 'Contact number', 'tel', 25], ['Current Address', 'Current address', 'textarea', 2000],
  ['Gender', 'Gender', 'select', 120], ['Position', 'Job position', 'select', 120],
  ['Site', 'Location / site', 'select', 120], ['Source', 'How did you hear about us?', 'select', 120],
  ['Notes', 'Additional information', 'textarea', 2000],
] as const;

export default function ApplicationForm() {
  const [context, setContext] = useState<Context | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [message, setMessage] = useState('Opening your invitation…');
  const [error, setError] = useState('');
  const [closed, setClosed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState('');
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
    setClosed(true); setContext(null); setDraft({}); current.current = {};
    history.replaceState(null, '', location.pathname);
    setError('');
    setMessage('All required documents have been submitted. Thank you. Your recruitment team will review them. This invitation is now complete and closed.');
  }
  function applyContext(value: Context, preserveDraft = false) {
    if (value.closed) { finish(); return; }
    phase.current = value.phase || 'application';
    setContext(value);
    if (phase.current === 'requirements') {
      current.current = {}; setDraft({});
      setMessage('Your application form is submitted. This page is now for requirements only. Reopen this same link whenever you need to upload the remaining documents.');
    } else if (!preserveDraft) {
      current.current = value.draft || {}; revision.current = value.revision || 0;
      setDraft(current.current);
      setMessage('Your information saves automatically while online. This link stays available until all required documents are uploaded.');
    }
  }
  async function reload(preserveDraft = false) {
    const value = await publicRpc<Context>('ats_application_open', { p_token: token.current });
    applyContext(value, preserveDraft);
  }
  function flush(submit = false) {
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (completed.current || phase.current !== 'application' || (!submit && savedChange.current === changed.current)) return;
      const version = changed.current;
      const result = await publicRpc<Saved>('ats_application_save', { p_token: token.current, p_draft: current.current, p_revision: revision.current, p_submit: submit });
      if (result.closed) { finish(); return; }
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
    if (!file || uploading) return;
    if (file.size < 1 || file.size > 10485760 || !/\.(pdf|jpe?g|png|docx?)$/i.test(file.name)) {
      setError('Choose a PDF, JPG, PNG, DOC or DOCX file between 1 byte and 10 MB.'); return;
    }
    setUploading(kind); setError('');
    try {
      const data = new FormData(); data.append('invitationToken', token.current); data.append('documentType', kind); data.append('file', file);
      const response = await fetch('https://wqshrjlcjqbjqcophvfv.supabase.co/functions/v1/application-requirements', {
        method: 'POST', headers: { apikey: 'sb_publishable_2QWxapvC5t_KHq-0u35d1w_kK-ah1eN' }, body: data, referrerPolicy: 'no-referrer',
      });
      const result = await response.json();
      if (!response.ok || !result.saved) throw Error(result.error || 'The document could not be saved. Please retry.');
      input.value = '';
      if (result.closed) finish(); else await reload();
    } catch (reason) { setError((reason as Error).message); } finally { setUploading(''); }
  }
  const inviter = context?.inviter;
  const safePhoto = inviter?.photo && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(inviter.photo) && inviter.photo.length < 360000 ? inviter.photo : '';
  const available = (context?.positions || []).filter(position => position.remaining_slots > 0);
  const submittedTypes = new Set((context?.documents || []).map(document => document.type));
  return <main className="application-page"><article className="application-card">
    <p className="eyebrow">RECRUITMENT APPLICATION</p><h1>{context?.company || 'Applicant application'}</h1>
    <p role="status" className="application-save">{message}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {inviter && !closed && <section className="application-recruiter" aria-label="Your recruitment contact">
      {safePhoto ? <img src={safePhoto} alt={(inviter.name || 'Recruiter') + ' profile'} /> : <span className="recruiter-initials">{(inviter.name || 'Recruitment team').split(/\s+/).map(word => word[0]).slice(0, 2).join('')}</span>}
      <div><p>Invited by</p><strong>{inviter.name || 'Recruitment team'}</strong><p>{inviter.role}</p>
        <p>Email: {inviter.email ? <a href={'mailto:' + inviter.email}>{inviter.email}</a> : 'Not provided'}</p>
        <p>Contact: {inviter.contact ? <a href={'tel:' + inviter.contact.replace(/[^+0-9]/g, '')}>{inviter.contact}</a> : 'Not provided—use email to contact your recruiter'}</p></div>
    </section>}
    {context && !closed && context.phase !== 'requirements' && <>
      <section className="application-instructions"><h2>Instructions</h2><p>{context.instructions}</p><p>Complete the fields marked *. Submit your application information, then upload your requirements using this same link. There is no countdown or automatic rejection for taking longer. The link closes only after every required document is uploaded, or if your recruiter revokes it.</p></section>
      <section className="application-positions"><h2>Available job slots</h2><div>{available.map(position => <article key={position.name}><strong>{position.name}</strong><span>{position.remaining_slots} available {position.remaining_slots === 1 ? 'slot' : 'slots'}</span></article>)}</div>{!available.length && <p>No positions currently have open slots. Contact your recruiter before submitting.</p>}<p className="section-subtitle">Availability is checked again when you submit. Selecting a job does not reserve a slot.</p></section>
      <form noValidate onSubmit={submit}><fieldset disabled={submitting}><legend>Your information</legend><div className="application-grid">
        {definitions.map(([key, label, type, max]) => <div key={key} className={type === 'textarea' ? 'application-wide' : ''}>
          <label className="field-label" htmlFor={'apply-' + key}>{label}{context.required?.includes(key) ? ' *' : ''}</label>
          {type === 'select' ? <select className="field-input" id={'apply-' + key} value={draft[key] || ''} onChange={e => update(key, e.target.value)}>
            <option value="">Select an option</option>{(key === 'Gender' ? ['Male', 'Female'] : key === 'Position' ? available.map(p => p.name) : context.choices?.[key] || []).map(option => <option key={option} value={option}>{option}{key === 'Position' ? ' — ' + available.find(p => p.name === option)?.remaining_slots + ' slots available' : ''}</option>)}
          </select> : type === 'textarea' ? <textarea className="field-input" id={'apply-' + key} maxLength={max} value={draft[key] || ''} onChange={e => update(key, e.target.value)} /> : <input className="field-input" id={'apply-' + key} type={type} maxLength={max} value={draft[key] || ''} onChange={e => update(key, e.target.value)} />}
        </div>)}
      </div><button className="btn btn-primary" type="submit">{submitting ? 'Submitting…' : 'Submit application and continue to requirements'}</button></fieldset></form>
    </>}
    {context && !closed && context.phase === 'requirements' && <section className="application-requirements">
      <h2>Applicant requirements</h2><p>{submittedTypes.size} of {context.requiredDocuments?.length || 0} requirement categories submitted. Documents are marked submitted and remain subject to recruiter review.</p>
      <p>Upload PDF, JPG, PNG, DOC or DOCX files up to 10 MB each. Your personal/application information is already submitted. Return to this same link for the remaining uploads.</p>
      {(context.requiredDocuments || []).map(kind => <article key={kind}><h3>{kind} <span>{submittedTypes.has(kind) ? 'Submitted' : 'Required'}</span></h3>
        {(context.documents || []).filter(document => document.type === kind).map(document => <p key={document.id}>{document.filename} · {Math.ceil(document.size / 1024)} KB</p>)}
        <label className="field-label" htmlFor={'upload-' + kind}>{uploading === kind ? 'Uploading…' : 'Upload ' + kind}</label>
        <input className="field-input" id={'upload-' + kind} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" disabled={Boolean(uploading)} onChange={e => void upload(kind, e.currentTarget)} />
      </article>)}
    </section>}
  </article></main>;
}
