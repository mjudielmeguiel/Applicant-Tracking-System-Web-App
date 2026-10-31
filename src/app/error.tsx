'use client';
import StatusPage from '@/components/StatusPage';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <StatusPage title="Unable to open this page"><p>Please try loading the page again.</p><button onClick={reset}>Try again</button></StatusPage>;
}
