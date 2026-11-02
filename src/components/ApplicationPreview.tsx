'use client';
import { useId, useRef } from 'react';

export default function ApplicationPreview({entries,disabled=false,language='en'}: {entries: [string,string][];disabled?:boolean;language?:'en'|'tl'}) {
  const modal=useRef<HTMLDialogElement>(null),title=useId();
  return <><button type="button" className="btn-sm ghost application-preview-button" disabled={disabled} onClick={()=>modal.current?.showModal()}>{language==='tl'?'Suriin ang aplikasyon':'Preview application'}</button>
    <dialog ref={modal} className="application-review" aria-labelledby={title} onCancel={event=>event.stopPropagation()}>
      <header><div><h2 id={title}>{language==='tl'?'Suriin ang aplikasyon':'Preview application'}</h2><p>{language==='tl'?'Suriin ang iyong impormasyon bago magsumite. Maaari kang bumalik upang baguhin ito.':'Review your details before submitting. You can return to the form to make changes.'}</p></div><button type="button" className="btn-sm ghost" aria-label="Close application preview" onClick={()=>modal.current?.close()}>×</button></header>
      <dl>{entries.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value.trim()||(language==='tl'?'Hindi ibinigay':'Not provided')}</dd></div>)}</dl>
      <footer><p>{language==='tl'?'Hindi pa naipapasa ang aplikasyon sa pagbukas ng preview.':'Your application has not been submitted by opening this preview.'}</p><button type="button" className="btn-sm primary" onClick={()=>modal.current?.close()}>{language==='tl'?'Bumalik sa form':'Back to form'}</button></footer>
    </dialog>
  </>;
}
