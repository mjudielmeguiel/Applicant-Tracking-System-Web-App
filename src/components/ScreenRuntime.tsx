'use client';

import { useEffect, useState } from 'react';

// The existing controllers attach document listeners and timers. Each route uses
// a full document navigation so those controllers always have a fresh lifecycle.
const boots = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Unable to load ' + src));
    document.body.append(script);
  });
}

export default function ScreenRuntime({ name, scripts, bodyClass }: {
  name: string; scripts: string[]; bodyClass: string;
}) {
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    document.body.className = bodyClass;
    let boot = boots.get(name);
    if (!boot) {
      boot = (async () => { for (const src of scripts) await loadScript(src); })();
      boots.set(name, boot);
    }
    boot.catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [name, scripts, bodyClass]);
  return error ? <aside className="runtime-error" role="alert">
    <p>The page could not finish loading. Check your connection and reload.</p>
    <button type="button" onClick={() => location.reload()}>Reload page</button>
  </aside> : null;
}
