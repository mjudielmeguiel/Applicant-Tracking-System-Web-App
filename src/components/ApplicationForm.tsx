'use client';
import { useEffect, useRef, useState } from 'react';
import { publicRpc } from '@/lib/public-rpc';
import '@/styles/application.css';

type Draft = Record<string, string>;
type Context = { closed?: boolean; status?: string; company: string; deadline: string; serverNow: string; draft: Draft; revision: number; required: string[]; instructions: string; choices: Record<string, string[]> };
type Saved = { closed?: boolean; status?: string; revision: number; issues?: string[]; serverNow: string };
const definitions = [
  ['Name', 'Full name', 'text', 120], ['Email Address', 'Email address', 'email', 254],
  ['Contact Number', 'Contact number', 'tel', 25], ['Current Address', 'Current address', 'textarea', 2000],
  ['Gender', 'Gender (optional unless marked required)', 'text', 120],
  ['Position', 'Job position', 'select', 120], ['Site', 'Location / site', 'select', 120],
  ['Source', 'How did you hear about us?', 'select', 120], ['Notes', 'Additional information', 'textarea', 2000],
] as const;

export default function ApplicationForm() {
  const [context, setContext] = useState<Context | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [message, setMessage] = useState('Opening your invitation…');
  const [error, setError] = useState('');
  const [closed, setClosed] = useState(false);
  const [expired, setExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const token = useRef('');
  const current = useRef<Draft>({});
  const revision = useRef(0);
  const changed = useRef(0);
  const savedChange = useRef(0);
  const clockOffset = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const initial = useRef<Promise<Context> | null>(null);
  const completed = useRef(false);
  const timedOut = useRef(false);
  const issues = useRef<string[]>([]);

  function finish(status?: string) {
    completed.current = true;
    setClosed(true);
    setContext(null);
    current.current = {};
    setDraft({});
    history.replaceState(null, '', location.pathname);
    setError('');
    setMessage(status === 'Rejected' ? 'Your saved application was submitted and marked Rejected because required information was missing or invalid. Contact the recruitment team for assistance.' : status ? 'Your application has been submitted. Thank you. This invitation is now closed.' : 'This application invitation has already been submitted and is closed.');
  }
  function flush(submit = false) {
    queue.current = queue.current.catch(() => {}).then(async () => {
      if (completed.current || (!submit && savedChange.current === changed.current)) return;
      const version = changed.current;
      const result = await publicRpc<Saved>('ats_application_save', { p_token: token.current, p_draft: current.current, p_revision: revision.current, p_submit: submit });
      if (result.closed) { finish(result.status); return; }
      revision.current = result.revision;
      savedChange.current = version;
      issues.current = result.issues || [];
      setError(issues.current.length ? 'Please correct: ' + issues.current.join('; ') : '');
      setMessage('Draft saved to the recruitment team. ' + new Date().toLocaleTimeString());
    }).catch(reason => {
      setError(reason.message + ' Only the last successfully saved draft can be submitted automatically. Keep this page open and reconnect.');
      throw reason;
    });
    return queue.current;
  }
  async function expire() {
    if (completed.current) return;
    timedOut.current = true;
    setExpired(true);
    setMessage('The deadline has passed. Your last saved draft is being submitted.');
    try {
      await queue.current.catch(() => {});
      const result = await publicRpc<Context>('ats_application_open', { p_token: token.current });
      if (result.closed) finish(result.status);
    } catch (reason) {
      setError((reason as Error).message + ' The server will submit your last saved draft. Reconnect to see confirmation.');
    }
  }
  useEffect(() => {
    let active = true;
    token.current = new URLSearchParams(location.hash.slice(1)).get('token') || '';
    if (!/^[a-f0-9]{64}$/.test(token.current)) { setClosed(true); setMessage('This invitation link is unavailable. Ask the recruitment team for a new link.'); return; }
    if (!initial.current) initial.current = publicRpc<Context>('ats_application_open', { p_token: token.current });
    initial.current.then(value => {
      if (!active) return;
      if (value.closed) { finish(value.status); return; }
      current.current = value.draft;
      revision.current = value.revision;
      clockOffset.current = Date.now() - Date.parse(value.serverNow);
      setDraft(value.draft);
      setContext(value);
      setMessage('Your countdown has started. Changes save automatically while you are online.');
    }).catch(reason => { if (active) { setClosed(true); setMessage(reason.message); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!context || closed) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((Date.parse(context.deadline) - (Date.now() - clockOffset.current)) / 1000));
      setRemaining(seconds);
      if (!seconds && !timedOut.current) void expire();
    };
    tick();
    const timer = setInterval(tick, 1000);
    const saver = setInterval(() => { if (!timedOut.current) void flush().catch(() => {}); }, 5000);
    const online = () => { if (timedOut.current) void expire(); else void flush().catch(() => {}); };
    const leaving = () => { if (!timedOut.current) void flush().catch(() => {}); };
    const visibility = () => { if (document.hidden) leaving(); };
    window.addEventListener('online', online);
    window.addEventListener('pagehide', leaving);
    document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(timer); clearInterval(saver); window.removeEventListener('online', online); window.removeEventListener('pagehide', leaving); document.removeEventListener('visibilitychange', visibility); };
  }, [context, closed]);
  useEffect(() => {
    if (!changed.current || closed || expired || submitting) return;
    const timeout = setTimeout(() => { void flush().catch(() => {}); }, 800);
    return () => clearTimeout(timeout);
  }, [draft, closed, expired, submitting]);
  function update(field: string, value: string) {
    current.current = { ...current.current, [field]: value };
    changed.current += 1;
    setDraft(current.current);
    setMessage('Saving changes…');
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || expired) return;
    setSubmitting(true);
    try {
      savedChange.current = -1;
      await flush();
      if (completed.current) return;
      const missing = context?.required.filter(field => !current.current[field]?.trim()) || [];
      const problems = [...new Set([...missing, ...issues.current])];
      if (!confirm(problems.length ? 'Required or valid information is missing: ' + problems.join(', ') + '. Submitting now will reject this application. Continue?' : 'Submit your application? You cannot use this link again after submission.')) return;
      await flush(true);
    } catch (_) {} finally { setSubmitting(false); }
  }
  const countdown = Math.floor(remaining / 86400) + 'd ' + String(Math.floor(remaining % 86400 / 3600)).padStart(2, '0') + ':' + String(Math.floor(remaining % 3600 / 60)).padStart(2, '0') + ':' + String(remaining % 60).padStart(2, '0');
  return <main className="application-page"><article className="application-card">
    <p className="eyebrow">RECRUITMENT APPLICATION</p><h1>{context?.company || 'Applicant application'}</h1>
    <p role="status" className="application-save">{message}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {context && !closed && <>
      <div className="application-clock" aria-live="off"><strong>Time remaining: {countdown}</strong><span>Deadline: {new Date(context.deadline).toLocaleString()}</span></div>
      <section className="application-instructions"><h2>Instructions</h2><p>{context.instructions}</p><p>Fields marked * are required. Complete applications go to recruitment review. Missing or invalid information results in rejection. Your last saved draft is submitted at the deadline, even if this page is closed. Unsaved offline changes cannot be received by the recruitment team.</p></section>
      <form noValidate onSubmit={submit}><fieldset disabled={expired || submitting}><legend>Your information</legend><div className="application-grid">
        {definitions.map(([key, label, type, max]) => <div key={key} className={type === 'textarea' ? 'application-wide' : ''}>
          <label className="field-label" htmlFor={'apply-' + key}>{label}{context.required.includes(key) ? ' *' : ''}</label>
          {type === 'select' ? <select className="field-input" id={'apply-' + key} value={draft[key] || ''} onChange={e => update(key, e.target.value)}><option value="">Select an option</option>{(context.choices[key] || []).map(option => <option key={option}>{option}</option>)}</select>
            : type === 'textarea' ? <textarea className="field-input" id={'apply-' + key} maxLength={max} value={draft[key] || ''} onChange={e => update(key, e.target.value)} />
              : <input className="field-input" id={'apply-' + key} type={type} maxLength={max} value={draft[key] || ''} onChange={e => update(key, e.target.value)} />}
        </div>)}
      </div><button className="btn btn-primary" type="submit">{submitting ? 'Submitting…' : 'Submit application'}</button></fieldset></form>
    </>}
  </article></main>;
}
