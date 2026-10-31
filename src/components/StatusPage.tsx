import type { ReactNode } from 'react';

export default function StatusPage({ title, children }: { title: string; children: ReactNode }) {
  return <main className="system-status"><h1>{title}</h1>{children}</main>;
}
