'use client';
import { useEffect } from 'react';
export default function ApplicationLanguageSwitch({language,onLanguage}: {language:'en'|'tl';onLanguage:(value:'en'|'tl')=>void}) {
  useEffect(()=>{try{const saved=localStorage.getItem('ats_applicant_language');if(saved==='en'||saved==='tl')onLanguage(saved);}catch{}},[onLanguage]);
  function choose(value:'en'|'tl'){onLanguage(value);try{localStorage.setItem('ats_applicant_language',value);}catch{}}
  return <div className="application-language-bar"><span>{language==='tl'?'Piliin ang wika':'Choose your language'}</span><div className="application-language-switch" role="group" aria-label="Application language">{(['en','tl'] as const).map(value=><button key={value} type="button" lang={value==='tl'?'fil':'en'} aria-pressed={language===value} onClick={()=>choose(value)}>{value==='en'?'English':'Tagalog'}</button>)}</div></div>;
}
