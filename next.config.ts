import type { NextConfig } from 'next';
const config: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
  async redirects() {
    return [
      { source: '/index.html', destination: '/', permanent: false },
      { source: '/dashboard.html', destination: '/dashboard', permanent: false },
      { source: '/applicant-masterlist.html', destination: '/applicants', permanent: false },
      { source: '/mrf-monitoring.html', destination: '/mrf', permanent: false },
      { source: '/users.html', destination: '/users', permanent: false },
      { source: '/calendar.html', destination: '/calendar', permanent: false },
      { source: '/invite.html', destination: '/invite', permanent: false },
    ];
  }
};
export default config;
