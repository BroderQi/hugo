import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { URL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const postsDir = '/opt/ai-blog/content/news';
const uploadsDir = '/opt/ai-blog/static/uploads';
const publicDir = '/opt/ai-blog-admin/public';
const buildScript = '/opt/ai-blog/build.sh';
const port = 8790;
const nl = String.fromCharCode(10);
const allowedUploadTypes = new Map([
  ['image/apng', '.apng'],
  ['image/avif', '.avif'],
  ['image/gif', '.gif'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/svg+xml', '.svg'],
  ['image/webp', '.webp'],
]);

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function slugify(input = '') {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

function slugOrFallback(slug, title) {
  const v = slugify(slug || title || '');
  if (v) {
    return v;
  }
  return `post-${Date.now()}`;
}

function decodeValue(raw = '') {
  const v = raw.trim();
  if (v === 'true') {
    return true;
  }
  if (v === 'false') {
    return false;
  }
  if (v.startsWith('"') && v.endsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  return v;
}

function encodeValue(v) {
  if (typeof v === 'boolean') {
    return v ? 'true' : 'false';
  }
  return JSON.stringify(v || '');
}

function parsePost(raw) {
  const data = { title: '', description: '', date: '', draft: false, pinned: false, body: raw };
  if (!raw.startsWith('+++' + nl)) {
    return data;
  }

  const endMarker = nl + '+++' + nl;
  const end = raw.indexOf(endMarker, 4);
  if (end === -1) {
    return data;
  }

  const frontMatter = raw.slice(4, end);
  for (const line of frontMatter.split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = decodeValue(line.slice(idx + 1));
    data[key] = value;
  }

  data.body = raw.slice(end + endMarker.length).replace(/^\n+/, '');
  return data;
}

function renderPost(data) {
  return [
    '+++',
    `title = ${encodeValue(data.title)}`,
    `description = ${encodeValue(data.description)}`,
    `date = ${encodeValue(data.date)}`,
    `pinned = ${encodeValue(Boolean(data.pinned))}`,
    'draft = false',
    '+++',
    '',
    (data.body || '').trim(),
    '',
  ].join(nl);
}

async function rebuild() {
  const { stdout, stderr } = await execFileAsync(buildScript, { timeout: 120000 });
  return `${stdout}${stderr}`.trim() || 'Site rebuilt.';
}

async function listPosts() {
  const names = await fs.readdir(postsDir);
  const posts = [];
  for (const name of names) {
    if (!name.endsWith('.md') || name === '_index.md') {
      continue;
    }
    const slug = name.slice(0, -3);
    const raw = await fs.readFile(path.join(postsDir, name), 'utf8');
    const parsed = parsePost(raw);
    posts.push({
      slug,
      title: parsed.title || slug,
      date: parsed.date || '',
      description: parsed.description || '',
      pinned: Boolean(parsed.pinned),
    });
  }
  posts.sort((a, b) =>
    Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
    (b.date || '').localeCompare(a.date || '') ||
    a.slug.localeCompare(b.slug),
  );
  return posts;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  return JSON.parse(raw);
}

function sanitizeName(name = '') {
  return path
    .basename(name)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function baseNameWithoutExt(name) {
  const ext = path.extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}

function fileExt(name, contentType) {
  const ext = path.extname(name || '').toLowerCase();
  if (allowedUploadTypes.get(contentType) === ext) {
    return ext;
  }
  return allowedUploadTypes.get(contentType) || '';
}

function decodeUpload(data = '') {
  const raw = String(data);
  const marker = ';base64,';
  const idx = raw.indexOf(marker);
  const payload = idx === -1 ? raw : raw.slice(idx + marker.length);
  return Buffer.from(payload, 'base64');
}

async function saveUpload(data) {
  const contentType = String(data.contentType || '').toLowerCase();
  const ext = fileExt(data.name, contentType);
  if (!ext) {
    throw new Error('Only common image formats are supported.');
  }

  const body = decodeUpload(data.data);
  if (!body.length) {
    throw new Error('Upload body is empty.');
  }

  const sourceName = sanitizeName(data.name || '') || `image-${randomUUID()}`;
  const stem = slugify(baseNameWithoutExt(sourceName)) || `image-${Date.now()}`;
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const fileName = `${stem}-${Date.now()}${ext}`;
  const absDir = path.join(uploadsDir, year, month);
  const relPath = path.posix.join('uploads', year, month, fileName);
  await fs.mkdir(absDir, { recursive: true });
  await fs.writeFile(path.join(absDir, fileName), body);
  return {
    url: `/${relPath}`,
    markdown: `![](/${relPath})`,
  };
}

async function serveStatic(res, filePath) {
  const body = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/api/posts') {
      return json(res, 200, { posts: await listPosts() });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/posts/')) {
      const slug = slugify(decodeURIComponent(url.pathname.slice('/api/posts/'.length)));
      if (!slug) {
        return json(res, 400, { error: 'Invalid slug.' });
      }
      const raw = await fs.readFile(path.join(postsDir, `${slug}.md`), 'utf8');
      const parsed = parsePost(raw);
      return json(res, 200, { slug, ...parsed });
    }

    if (req.method === 'POST' && url.pathname === '/api/posts') {
      const data = await readJson(req);
      const slug = slugOrFallback(data.slug, data.title);
      if (!(data.title || '').trim()) {
        return json(res, 400, { error: 'Title is required.' });
      }
      const post = {
        title: (data.title || '').trim(),
        description: (data.description || '').trim(),
        date: (data.date || '').trim() || new Date().toISOString(),
        pinned: Boolean(data.pinned),
        body: data.body || '',
      };
      await fs.writeFile(path.join(postsDir, `${slug}.md`), renderPost(post), 'utf8');
      const buildLog = await rebuild();
      return json(res, 200, { ok: true, slug, buildLog });
    }

    if (req.method === 'POST' && url.pathname === '/api/uploads') {
      const data = await readJson(req);
      const upload = await saveUpload(data);
      const buildLog = await rebuild();
      return json(res, 200, { ok: true, ...upload, buildLog });
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/posts/')) {
      const slug = slugify(decodeURIComponent(url.pathname.slice('/api/posts/'.length)));
      if (!slug) {
        return json(res, 400, { error: 'Invalid slug.' });
      }
      await fs.unlink(path.join(postsDir, `${slug}.md`));
      const buildLog = await rebuild();
      return json(res, 200, { ok: true, slug, buildLog });
    }

    const target = url.pathname === '/' ? '/index.html' : url.pathname;
    await serveStatic(res, path.join(publicDir, target));
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return json(res, 404, { error: 'Not found.' });
    }
    return json(res, 500, { error: err.message || 'Server error.' });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`ai-bkgf-admin listening on ${port}`);
});
