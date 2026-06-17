import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './worker.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const ENV_FILE = join(ROOT, '.env.local');

const mimeTypes = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.mjs', 'text/javascript; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.md', 'text/markdown; charset=utf-8'],
    ['.svg', 'image/svg+xml'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.webp', 'image/webp'],
    ['.pdf', 'application/pdf']
]);

const apiPrefixes = [
    '/voice/',
    '/assistant'
];

const env = {
    ...process.env,
    ...loadLocalEnv(ENV_FILE)
};

const ctx = {
    waitUntil(promise) {
        Promise.resolve(promise).catch((err) => {
            console.error('[local-worker] background task failed:', err?.message || err);
        });
    }
};

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
        if (req.method === 'OPTIONS' || req.method === 'POST' || isApiPath(url.pathname)) {
            await handleWorkerRequest(req, res, url);
            return;
        }
        await serveStaticFile(res, url.pathname);
    } catch (err) {
        console.error('[local-dev] request failed:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Local dev server failed' }));
    }
});

server.listen(PORT, HOST, () => {
    console.log(`Ask Abhishek local dev running at http://${HOST}:${PORT}/index.html`);
    console.log(`Worker API is available on the same origin, including /voice/config and /voice/sarvam/turn.`);
    console.log(`Loaded env from ${ENV_FILE}${existsSync(ENV_FILE) ? '' : ' (file not found; create it from .env.local.example)'}`);
});

async function handleWorkerRequest(req, res, url) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) {
            value.forEach((item) => headers.append(key, item));
        } else if (value !== undefined) {
            headers.set(key, value);
        }
    }
    headers.set('Origin', headers.get('Origin') || `http://${HOST}:${PORT}`);
    headers.set('CF-Connecting-IP', headers.get('CF-Connecting-IP') || '127.0.0.1');

    const request = new Request(url.toString(), {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body
    });

    const response = await worker.fetch(request, env, ctx);
    const responseHeaders = Object.fromEntries(response.headers.entries());
    res.writeHead(response.status, responseHeaders);
    if (response.body) {
        const buffer = Buffer.from(await response.arrayBuffer());
        res.end(buffer);
    } else {
        res.end();
    }
}

async function serveStaticFile(res, pathname) {
    const safePath = pathname === '/' ? '/index.html' : pathname;
    const decoded = decodeURIComponent(safePath);
    const filePath = normalize(join(ROOT, decoded));
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }
    try {
        const data = await readFile(filePath);
        res.writeHead(200, {
            'Content-Type': mimeTypes.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
            'Cache-Control': 'no-store'
        });
        res.end(data);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
    }
}

function isApiPath(pathname) {
    return apiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function loadLocalEnv(path) {
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, 'utf8');
    const parsed = {};
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const equalsAt = trimmed.indexOf('=');
        if (equalsAt < 1) continue;
        const key = trimmed.slice(0, equalsAt).trim();
        let value = trimmed.slice(equalsAt + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        parsed[key] = value;
    }
    return parsed;
}
