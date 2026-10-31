const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };

function createServer() {
  return http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      const relative = path.relative(root, target);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !types[path.extname(target)]) {
        response.writeHead(404).end('Not found');
        return;
      }
      const data = await fs.readFile(target);
      response.writeHead(200, { 'Content-Type': types[path.extname(target)] + '; charset=utf-8', 'Cache-Control': 'no-store' }).end(data);
    } catch (error) {
      response.writeHead(404).end('Not found');
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, '127.0.0.1', () => console.log(`Applicant Tracking System: http://127.0.0.1:${port}`));
}
module.exports = { createServer };
