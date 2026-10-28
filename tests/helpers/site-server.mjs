import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createAdminBackend } from './admin-harness.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.npy': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4',
};

export function startSiteServer({ root: ROOT, port: PORT, base: BASE, backend = createAdminBackend() }) {
  const server = http.createServer(async (req, res) => {
    const pathname = decodeURIComponent(req.url.split('?')[0]);
    if (pathname === '/api/admin/sync' || pathname.startsWith('/api/media/')) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const response = await backend.fetchApi(BASE + req.url, {
        method: req.method, headers: req.headers,
        body: req.method === 'POST' ? Buffer.concat(chunks) : undefined
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const rel = pathname.replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    // refuse to serve anything outside the project
    if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      const headers = { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'accept-ranges': 'bytes' };
      headers['content-security-policy'] = fs.readFileSync(path.join(ROOT,'_headers'),'utf8').split('\n').find(line=>line.trim().startsWith('Content-Security-Policy:')).trim().slice('Content-Security-Policy:'.length).trim();
      if (req.headers.range) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        const start = range?.[1] ? Number(range[1]) : Math.max(0, buf.length-Number(range?.[2]));
        const end = range?.[1] && range[2] ? Math.min(Number(range[2]),buf.length-1) : buf.length-1;
        if (!range || start>end || start>=buf.length) {
          res.writeHead(416, { 'content-range': 'bytes */'+buf.length }).end(); return;
        }
        headers['content-range'] = `bytes ${start}-${end}/${buf.length}`;
        res.writeHead(206, { ...headers, 'content-length': end-start+1 });
        res.end(buf.subarray(start,end+1));
      } else {
        res.writeHead(200, { ...headers, 'content-length': buf.length });
        res.end(buf);
      }
    });
  });
  server.on('close', () => backend.close());
  return new Promise((resolve, reject) => {
    server.once('error', (e) => reject(new Error(
      e.code === 'EADDRINUSE'
        ? `端口 ${PORT} 已被占用，可能有上一轮的测试进程没退干净`
        : e.message)));
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}
