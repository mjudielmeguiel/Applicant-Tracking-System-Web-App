// Keep the original filenames as the source for the compatibility controllers.
// Only explicitly listed frontend assets are published; SQL and work files are excluded.
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const pages = {
  login: 'index.html', dashboard: 'dashboard.html', applicants: 'applicant-masterlist.html',
  mrf: 'mrf-monitoring.html', users: 'users.html', calendar: 'calendar.html', invite: 'invite.html'
};
async function prepare() {
  await fs.mkdir(path.join(root, 'public', 'scripts'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'lib', 'generated'), { recursive: true });
  const screens = {};
  for (const [key, filename] of Object.entries(pages)) {
    const source = await fs.readFile(path.join(root, filename), 'utf8');
    const body = source.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
    if (!body) throw new Error('Missing body in ' + filename);
    const scripts = [];
    let inline = 0;
    for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const src = match[1].match(/\bsrc=["']([^"']+)["']/i)?.[1];
      if (src) scripts.push(/^https?:/.test(src) ? src : '/' + src);
      else if (match[2].trim()) {
        const file = key + '-inline-' + (++inline) + '.js';
        await fs.writeFile(path.join(root, 'public', 'scripts', file), match[2]);
        scripts.push('/scripts/' + file);
      }
    }
    const styles = [...source.matchAll(/<link\b([^>]+)>/gi)]
      .filter(match => /rel=["']stylesheet["']/.test(match[1]))
      .map(match => match[1].match(/href=["']([^"']+)["']/)?.[1])
      .filter(Boolean).filter(href => href !== 'styles.css')
      .map(href => /^https?:/.test(href) ? href : '/' + href);
    screens[key] = {
      title: source.match(/<title>(.*?)<\/title>/i)?.[1] || 'Applicant Tracking System',
      bodyClass: body[1].match(/class=["']([^"']*)["']/)?.[1] || '',
      html: body[2].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''),
      styles, scripts
    };
  }
  // Remove retired published MRF controllers from earlier builds.
  for (const file of ['mrf.js','mrf-store.js','mrf.css']) await fs.rm(path.join(root,'public',file),{force:true});
  const assets = [
    'app.js', 'applicant-fields.js', 'applicant-status-tools.js', 'applicant-workflow.js',
    'applicants.js', 'calendar.js', 'company.js', 'dashboard.js', 'jobs.js', 'jobs.css', 'job-posts.js', 'invite.js',
    'notifications.js', 'profile-images.js', 'profile.js',
    'settings.js', 'user-invitations.js', 'users.js', 'invitation-admin.js',
    'app.css', 'responsive.css', 'status-colors.css', 'applicants.css', 'calendar.css', 'company.css', 'invitation.css',
    'notifications.css', 'profile.css', 'settings.css', 'styles.css', 'users.css'
  ];
  for (const file of assets) await fs.copyFile(path.join(root, file), path.join(root, 'public', file));
  await fs.cp(path.join(root, 'assets'), path.join(root, 'public', 'assets'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'lib', 'generated', 'screens.json'), JSON.stringify(screens));
  console.log('Prepared all seven Next.js screens and frontend assets.');
}
prepare().catch(error => { console.error(error); process.exitCode = 1; });
