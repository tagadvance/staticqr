/**
 * Serve dist/ for local development and for the browser tests. Deliberately
 * minimal: the real thing is static files on a CDN, so there is nothing here
 * worth reproducing.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

async function resolve(root, pathname) {
  // normalize collapses any .. before it can escape the root.
  const candidate = join(root, normalize(decodeURIComponent(pathname)));
  if (!candidate.startsWith(root)) {
    return null;
  }
  try {
    const info = await stat(candidate);
    if (info.isDirectory()) {
      const index = join(candidate, 'index.html');
      await stat(index);
      return index;
    }
    return candidate;
  } catch {
    return null;
  }
}

export function createServer(root = DIST) {
  return createHttpServer(async (request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    const file = await resolve(root, pathname);
    if (file === null) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found\n');
      return;
    }
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(response);
  });
}

/** Listen on an ephemeral port and resolve with the origin and a stop function. */
export function listen(root = DIST) {
  const server = createServer(root);
  return new Promise((resolve_) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve_({
        origin: `http://127.0.0.1:${port}`,
        stop: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8080);
  createServer().listen(port, () => {
    console.log(`serving dist/ on http://localhost:${port}`);
  });
}
