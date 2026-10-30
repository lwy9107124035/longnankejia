import '../js/content-schema.js';
import { readLimited } from '../functions/_lib/read-limited.js';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream } from 'node:fs';

const schema = globalThis.HeritageContent;
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_MEDIA_BYTES = 250 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const METADATA_WARNING_BYTES = 2 * 1024 * 1024;
const DATABASE_WARNING_BYTES = 350 * 1024 * 1024;
const executeFile = promisify(execFile);
const DEFAULT_ORIGIN = 'https://longnankejia.pages.dev';
const MEDIA_TYPES = new Map([
  ['image/png', 'png'], ['image/jpeg', 'jpeg'], ['image/gif', 'gif'],
  ['image/webp', 'webp'], ['image/avif', 'avif'], ['audio/mpeg', 'mp3'], ['audio/mp4', 'm4a'],
  ['audio/ogg', 'oga'], ['audio/wav', 'wav'], ['audio/webm', 'weba'], ['video/mp4', 'mp4'], ['video/webm', 'webm'], ['video/ogg', 'ogv']
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function readDatabaseCapacity(database, { run = executeFile } = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(database || '')) throw new TypeError('Invalid D1 database name');
  const windows = process.platform === 'win32';
  const command = windows ? 'cmd.exe' : 'wrangler';
  const args = windows ? ['/d', '/s', '/c', `wrangler d1 info ${database} --json`] : ['d1', 'info', database, '--json'];
  let stdout;
  try {
    ({ stdout } = await run(command, args, { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true }));
  } catch {
    throw new Error('D1 capacity unavailable; check Wrangler installation and authorization');
  }
  let info;
  try { info = JSON.parse(stdout); } catch { throw new Error('D1 capacity response is not JSON'); }
  if (info.name !== database || !Number.isSafeInteger(info.database_size) || info.database_size < 0) {
    throw new Error('D1 capacity response has an invalid database or size');
  }
  return { database, sizeBytes: info.database_size, warningBytes: DATABASE_WARNING_BYTES, planLimitBytes: null };
}

function parseBaseline(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.ids)) {
    throw new TypeError('Baseline must contain a non-negative integer revision and an ids array.');
  }
  if (value.ids.some(id => typeof id !== 'string' || !id) || new Set(value.ids).size !== value.ids.length) {
    throw new TypeError('Baseline IDs must be non-empty unique strings.');
  }
  return { revision: value.revision, ids: value.ids };
}

function publicMediaUrls(bundle) {
  const urls = [];
  for (const record of bundle.kepuCustom) {
    for (const field of ['imageUrl', 'image']) {
      const value = record[field];
      const mediaPath = typeof value === 'string' && schema.mediaPath(value);
      if (mediaPath && !urls.includes(mediaPath)) urls.push(mediaPath);
    }
    if (urls.length >= 3) break;
  }
  return urls.slice(0, 3);
}

function imageData(bytes, mime, encoding) {
  let base64 = Buffer.from(bytes).toString('base64');
  if (encoding) {
    if (!Number.isSafeInteger(encoding.length) || encoding.length < 1 || encoding.length > 5000000 || !/^[a-zA-Z0-9+/=]{1,4}$/.test(encoding.tail || '') || encoding.tail.length > encoding.length) throw new Error('Invalid legacy image encoding');
    base64 = base64.slice(0, encoding.length - encoding.tail.length) + encoding.tail;
  }
  return `data:${mime};base64,${base64}`;
}
async function inspectMedia(url, fetchImpl, origin, directory) {
  const response = await fetchImpl(new URL(url, origin), {
    method: 'GET', cache: 'no-store', headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    signal: AbortSignal.timeout(120000)
  });
  if (response.status !== 200) throw new Error(`media ${url}: HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  const mime = contentType.split(';', 1)[0].trim().toLowerCase();
  if (!MEDIA_TYPES.has(mime)) throw new Error(`media ${url}: unsupported Content-Type`);
  if (mime.startsWith('image/')) {
    const bytes = await readLimited(response, 5 * 1024 * 1024);
    let encoding;
    if (await schema.mediaIdentity(imageData(bytes, mime)) !== url) {
      if (!response.headers.get('x-media-base64-length') || !response.headers.get('x-media-base64-tail')) throw new Error(`media ${url}: content hash mismatch`);
      encoding = { length: Number(response.headers.get('x-media-base64-length')), tail: response.headers.get('x-media-base64-tail') };
      if (await schema.mediaIdentity(imageData(bytes, mime, encoding)) !== url) throw new Error(`media ${url}: content hash mismatch`);
    }
    return { bytes, mime, encoding };
  }
  const file = directory && path.join(directory, url.split('/').at(-1) + '.' + MEDIA_TYPES.get(mime));
  let handle, length = 0; const hash = createHash('sha256');
  try {
    if (file) { await fs.mkdir(directory, { recursive: true }); handle = await fs.open(file, 'wx'); }
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > MAX_MEDIA_BYTES) throw new Error('media exceeds 250 MiB');
      hash.update(chunk); if (handle) await handle.writeFile(chunk);
    }
    if (hash.digest('hex') !== url.split('/').at(-1)) throw new Error(`media ${url}: content hash mismatch`);
    return { bytes: null, mime, file };
  } catch (error) {
    if (handle) { await handle.close(); handle = null; await fs.unlink(file); }
    throw error;
  } finally { if (handle) await handle.close(); }
}

function collectMediaUrls(value, urls = new Set()) {
  if (typeof value === 'string') {
    const mediaPath = schema.mediaPath(value);
    if (mediaPath) urls.add(mediaPath);
  } else if (Array.isArray(value)) {
    for (const item of value) collectMediaUrls(item, urls);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectMediaUrls(item, urls);
  }
  return [...urls];
}

async function validCachedMedia(file, mime, url) {
  if (!mime.startsWith('image/')) {
    const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex') === url.split('/').at(-1);
  }
  let encoding;
  try { encoding = JSON.parse(await fs.readFile(file + '.encoding.json', 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return await schema.mediaIdentity(imageData(await fs.readFile(file), mime, encoding)) === url;
}

async function findCachedMedia(directory, url) {
  const hash = url.split('/').at(-1);
  for (const [mime, extension] of MEDIA_TYPES) {
    const file = path.join(directory, `${hash}.${extension}`);
    try {
      if (await validCachedMedia(file, mime, url)) return file;
      throw new Error(`cached media ${hash}.${extension} failed its content hash`);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return null;
}

async function archiveMedia(url, directory, fetchImpl, origin, fetched) {
  const existing = await findCachedMedia(directory, url);
  if (existing) return { file: existing, reused: true };
  const media = fetched.get(url) || await inspectMedia(url, fetchImpl, origin, directory);
  if (media.file) return { file: media.file, reused: false };
  const extension = MEDIA_TYPES.get(media.mime);
  const hash = url.split('/').at(-1);
  const file = path.join(directory, `${hash}.${extension}`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(file, media.bytes, { flag: 'wx' });
    if (media.encoding) await fs.writeFile(file + '.encoding.json', JSON.stringify(media.encoding), { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!await validCachedMedia(file, media.mime, url)) {
      throw new Error(`existing media ${hash}.${extension} failed its content hash`);
    }
    return { file, reused: true };
  }
  return { file, reused: false };
}

export async function checkHealth({
  origin = DEFAULT_ORIGIN,
  baseline,
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  snapshotDir,
  databaseName,
  readCapacity = readDatabaseCapacity
} = {}) {
  const startedAt = now();
  const result = {
    checkedAt: startedAt,
    httpStatus: null,
    contentType: null,
    cacheControl: null,
    revision: null,
    baselineRevision: baseline?.revision ?? null,
    count: null,
    uniqueIdCount: null,
    missingIds: [],
    addedCount: 0,
    contentHash: null,
    mediaChecked: 0,
    snapshotPath: null,
    snapshotComplete: false,
    mediaArchived: 0,
    mediaReused: 0,
    storage: null,
    databaseStorage: null,
    warnings: [],
    problems: []
  };
  let parsedBaseline;
  try {
    parsedBaseline = parseBaseline(baseline);
  } catch (error) {
    result.problems.push(error.message);
    return result;
  }

  let baseUrl;
  try {
    baseUrl = new URL(origin);
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) throw new TypeError('origin must be an HTTP(S) URL without credentials');
  } catch (error) {
    result.problems.push(error.message);
    return result;
  }
  const endpoint = new URL('/api/admin/sync', baseUrl);
  endpoint.searchParams.set('_health', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  endpoint.searchParams.set('format', 'pages');
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET', cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    result.problems.push(`sync request failed: ${error.name === 'TimeoutError' ? 'timeout' : error.message}`);
    return result;
  }
  result.httpStatus = response.status;
  result.contentType = response.headers.get('content-type');
  result.cacheControl = response.headers.get('cache-control');
  if (response.status !== 200) result.problems.push(`sync endpoint returned HTTP ${response.status}`);
  if (!/^application\/json(?:\s*;|$)/i.test(result.contentType || '')) result.problems.push('sync response is not JSON');
  if (!/(?:^|,)\s*no-store\s*(?:,|$)/i.test(result.cacheControl || '')) result.problems.push('sync response is missing Cache-Control: no-store');

  let payload;
  try {
    const bytes = await readLimited(response, MAX_RESPONSE_BYTES);
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    result.problems.push(error instanceof RangeError && error.message === 'too_large' ? 'sync response exceeds 24 MiB' : `sync response could not be parsed: ${error.message}`);
    return result;
  }
  if (!payload || payload.ok !== true) result.problems.push('sync response ok is not true');
  if (!Number.isSafeInteger(payload?.revision) || payload.revision < 0) result.problems.push('revision is not a non-negative integer');
  if (!Array.isArray(payload?.kepuCustom)) result.problems.push('kepuCustom is not an array');
  if (result.problems.length) return result;

  if (payload.model === 'records-v1') {
    try {
      const complete = structuredClone(schema.defaults);
      for (const field of Object.keys(schema.defaults)) {
        let cursor = ''; const seen = new Set(), cursors = new Set();
        do {
          const url = new URL(endpoint); url.searchParams.set('format', 'records'); url.searchParams.set('field', field); url.searchParams.set('cursor', cursor);
          const response = await fetchImpl(url, { method: 'GET', cache: 'no-store', headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
          if (response.status !== 200 || !/application\/json/i.test(response.headers.get('content-type') || '') || !/no-store/i.test(response.headers.get('cache-control') || '')) throw new Error('record page has an invalid status, type or cache policy');
          const page = JSON.parse(new TextDecoder().decode(await readLimited(response, MAX_RESPONSE_BYTES)));
          if (!page.ok || page.revision !== payload.revision || !Array.isArray(page.rows) || typeof page.cursor !== 'string') throw new Error('record pages changed or are invalid; retry a fresh backup');
          for (const row of page.rows) {
            if (row.summary || (row.key !== field && !row.key.startsWith(field + '/')) || seen.has(row.key)) throw new Error('duplicate, partial or unexpected record in backup');
            seen.add(row.key); schema.setContentCell(complete, row.key, row.value);
          }
          if (page.cursor && cursors.has(page.cursor)) throw new Error('record cursor repeated');
          cursors.add(page.cursor); cursor = page.cursor;
        } while (cursor);
        if (payload.counts && seen.size !== (payload.counts[field] || 0)) throw new Error('record page count differs from the manifest');
      }
      Object.assign(payload, complete);
    } catch (error) { result.problems.push('paged content backup incomplete: ' + error.message); return result; }
  }

  try {
    schema.validateBundle(payload);
  } catch (error) {
    result.problems.push(`content schema invalid: ${error.message}`);
    return result;
  }
  const ids = payload.kepuCustom.map(record => record.id);
  const currentIds = new Set(ids);
  result.count = ids.length;
  result.uniqueIdCount = currentIds.size;
  result.revision = payload.revision;
  if (currentIds.size !== ids.length) result.problems.push('kepuCustom contains duplicate IDs');
  if (payload.revision < parsedBaseline.revision) result.problems.push('revision is below baseline');
  result.missingIds = parsedBaseline.ids.filter(id => !currentIds.has(id));
  if (result.missingIds.length) result.problems.push('baseline IDs are missing');
  result.addedCount = [...currentIds].filter(id => !parsedBaseline.ids.includes(id)).length;
  result.contentHash = sha256(Buffer.from(schema.canonical(payload), 'utf8'));
  if (payload.storage) {
    const { metadataBytes, metadataLimit } = payload.storage;
    if (payload.storage.model === 'records-v1' && Number.isSafeInteger(metadataBytes) && metadataBytes >= 0 && metadataLimit === null) {
      const warningBytes = 50 * 1024 * 1024;
      result.storage = { model: 'records-v1', metadataBytes, metadataLimit: null, warningBytes, usedPercent: null, maxRecordBytes: payload.storage.maxRecordBytes };
      if (metadataBytes >= warningBytes) result.warnings.push('row metadata has reached the 50 MiB maintenance budget');
    } else if (!Number.isSafeInteger(metadataBytes) || metadataBytes < 0 || !Number.isSafeInteger(metadataLimit) || metadataLimit <= 0) result.problems.push('storage metrics are invalid');
    else {
      const warningBytes = Math.min(metadataLimit * 0.85, METADATA_WARNING_BYTES);
      result.storage = { metadataBytes, metadataLimit, warningBytes, usedPercent: metadataBytes * 100 / metadataLimit };
      if (metadataBytes >= warningBytes) result.warnings.push('metadata snapshot has reached its maintenance threshold');
    }
  }

  if (databaseName) {
    try {
      result.databaseStorage = await readCapacity(databaseName);
      if (result.databaseStorage.sizeBytes >= result.databaseStorage.warningBytes) {
        result.warnings.push('D1 database has reached the 350 MiB maintenance budget; review growth and the account quota');
      }
    } catch (error) {
      result.warnings.push(`D1 capacity check incomplete: ${error.message}`);
    }
  }
  const fetchedMedia = new Map();
  try {
    for (const url of publicMediaUrls(payload)) {
      fetchedMedia.set(url, await inspectMedia(url, fetchImpl, baseUrl));
      result.mediaChecked += 1;
    }
  } catch (error) {
    result.problems.push(error.name === 'TimeoutError' ? 'media request timed out' : error.message);
    return result;
  }

  if (snapshotDir) {
    const file = path.join(snapshotDir, `revision-${payload.revision}-${result.contentHash}.json`);
    try {
      const mediaDirectory = path.join(snapshotDir, 'media');
      const mediaUrls = collectMediaUrls(payload);
      for (let offset = 0; offset < mediaUrls.length; offset += 3) {
        const archived = await Promise.all(mediaUrls.slice(offset, offset + 3).map(url => archiveMedia(url, mediaDirectory, fetchImpl, baseUrl, fetchedMedia)));
        result.mediaArchived += archived.filter(item => !item.reused).length;
        result.mediaReused += archived.filter(item => item.reused).length;
      }
      await fs.mkdir(snapshotDir, { recursive: true });
      try {
        await fs.writeFile(file, JSON.stringify(payload, null, 2) + '\n', { flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = JSON.parse(await fs.readFile(file, 'utf8'));
        if (sha256(Buffer.from(schema.canonical(existing), 'utf8')) !== result.contentHash) throw new Error('existing snapshot failed its content hash');
      }
      result.snapshotPath = file;
      result.snapshotComplete = true;
    } catch (error) {
      result.problems.push(`snapshot backup incomplete: ${error.message}`);
    }
  }
  return result;
}

function cliOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (!['--baseline', '--origin', '--report', '--snapshot-dir', '--d1-database'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error(`Invalid or incomplete argument: ${key}`);
    }
    const name = { '--baseline': 'baselinePath', '--origin': 'origin', '--report': 'reportPath', '--snapshot-dir': 'snapshotDir', '--d1-database': 'databaseName' }[key];
    options[name] = args[++i];
  }
  if (!options.baselinePath) throw new Error('--baseline is required');
  return options;
}

async function main() {
  try {
    const options = cliOptions(process.argv.slice(2));
    const baseline = parseBaseline(JSON.parse(await fs.readFile(options.baselinePath, 'utf8')));
    const report = await checkHealth({ origin: options.origin || DEFAULT_ORIGIN, baseline, snapshotDir: options.snapshotDir, databaseName: options.databaseName });
    if (options.reportPath) {
      await fs.mkdir(path.dirname(path.resolve(options.reportPath)), { recursive: true });
      await fs.writeFile(options.reportPath, JSON.stringify(report, null, 2) + '\n');
    }
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (report.problems.length) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
