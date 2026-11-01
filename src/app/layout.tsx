import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@/styles/globals.css';

export const viewport: Viewport = {width:'device-width',initialScale:1,viewportFit:'cover',interactiveWidget:'resizes-content'};

export const metadata: Metadata = {
  title: { default: 'Applicant Tracking System', template: '%s — Applicant Tracking System' },
  description: 'Recruitment workspace for applicants, manpower requisitions and schedules.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
