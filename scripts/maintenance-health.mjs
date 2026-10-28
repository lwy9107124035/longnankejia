import '../js/content-schema.js';
import { readLimited } from '../functions/_lib/read-limited.js';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const schema = globalThis.HeritageContent;
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_MEDIA_BYTES = 24 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const METADATA_WARNING_BYTES = 2 * 1024 * 1024;
const DEFAULT_ORIGIN = 'https://longnankejia.pages.dev';
const MEDIA_TYPES = new Map([
  ['image/png', 'png'], ['image/jpeg', 'jpeg'], ['image/gif', 'gif'],
  ['image/webp', 'webp'], ['image/avif', 'avif']
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
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

async function inspectMedia(url, fetchImpl, origin) {
  const response = await fetchImpl(new URL(url, origin), {
    method: 'GET', cache: 'no-store', headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (response.status !== 200) throw new Error(`media ${url}: HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  const mime = contentType.split(';', 1)[0].trim().toLowerCase();
  if (!/^image\/(?:png|jpeg|gif|webp|avif)$/.test(mime)) throw new Error(`media ${url}: non-image Content-Type`);
  const bytes = await readLimited(response, MAX_MEDIA_BYTES);
  const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  const expected = await schema.mediaIdentity(dataUrl);
  if (expected !== url) throw new Error(`media ${url}: content hash mismatch`);
  return { bytes, mime };
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

function validCachedImage(bytes, mime, url) {
  return schema.mediaIdentity(`data:${mime};base64,${Buffer.from(bytes).toString('base64')}`).then(identity => identity === url);
}

async function findCachedImage(directory, url) {
  const hash = url.split('/').at(-1);
  for (const [mime, extension] of MEDIA_TYPES) {
    const file = path.join(directory, `${hash}.${extension}`);
    try {
      const bytes = await fs.readFile(file);
      if (await validCachedImage(bytes, mime, url)) return file;
      throw new Error(`cached media ${hash}.${extension} failed its content hash`);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return null;
}

async function archiveMedia(url, directory, fetchImpl, origin, fetched) {
  const existing = await findCachedImage(directory, url);
  if (existing) return { file: existing, reused: true };
  const media = fetched.get(url) || await inspectMedia(url, fetchImpl, origin);
  const extension = MEDIA_TYPES.get(media.mime);
  const hash = url.split('/').at(-1);
  const file = path.join(directory, `${hash}.${extension}`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(file, media.bytes, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!await validCachedImage(await fs.readFile(file), media.mime, url)) {
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
  snapshotDir
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
    if (!Number.isSafeInteger(metadataBytes) || metadataBytes < 0 || !Number.isSafeInteger(metadataLimit) || metadataLimit <= 0) result.problems.push('storage metrics are invalid');
    else {
      const warningBytes = Math.min(metadataLimit * 0.85, METADATA_WARNING_BYTES);
      result.storage = { metadataBytes, metadataLimit, warningBytes, usedPercent: metadataBytes * 100 / metadataLimit };
      if (metadataBytes >= warningBytes) result.warnings.push('metadata snapshot has reached its maintenance threshold');
    }
  }

  if (result.problems.length) return result;
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
    if (!['--baseline', '--origin', '--report', '--snapshot-dir'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error(`Invalid or incomplete argument: ${key}`);
    }
    const name = { '--baseline': 'baselinePath', '--origin': 'origin', '--report': 'reportPath', '--snapshot-dir': 'snapshotDir' }[key];
    options[name] = args[++i];
  }
  if (!options.baselinePath) throw new Error('--baseline is required');
  return options;
}

async function main() {
  try {
    const options = cliOptions(process.argv.slice(2));
    const baseline = parseBaseline(JSON.parse(await fs.readFile(options.baselinePath, 'utf8')));
    const report = await checkHealth({ origin: options.origin || DEFAULT_ORIGIN, baseline, snapshotDir: options.snapshotDir });
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
