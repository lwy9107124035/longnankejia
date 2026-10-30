import { authorizeAdmin } from './sync.js';
import { readLimited } from '../../_lib/read-limited.js';
import { UploadError, UPLOAD_PART_BYTES, beginUpload, uploadStatus, uploadPart, completeUpload, abortUpload } from '../../_lib/admin-uploads.js';

function reply(request, status, value) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
  const origin = request.headers.get('Origin');
  if (origin && (origin === new URL(request.url).origin || origin === 'https://lwy9107124035.github.io')) Object.assign(headers, {
    'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  return new Response(status === 204 ? null : JSON.stringify(value), { status, headers });
}

async function readUpload(request, limit) {
  try { return await readLimited(request, limit); }
  catch (error) {
    if (error instanceof RangeError) throw new UploadError(413, 'PAYLOAD_TOO_LARGE', '请求实际字节数超过允许大小。');
    throw error;
  }
}

async function handle({ request, env = {} }) {
  try {
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin');
      if (!origin || (origin !== new URL(request.url).origin && origin !== 'https://lwy9107124035.github.io'))
        throw new UploadError(403, 'ORIGIN_DENIED', '此网址不允许访问管理接口。');
      return reply(request, 204, null);
    }
    const user = await authorizeAdmin(request, env);
    if (!env.ADMIN_MEDIA) throw new UploadError(503, 'MEDIA_NOT_CONFIGURED', '对象存储尚未配置，暂时不能上传音视频。');
    const url = new URL(request.url);
    let result;
    if (request.method === 'GET') result = await uploadStatus(env.ADMIN_DB, user, url.searchParams.get('uploadId'));
    else if (request.method === 'POST' && url.searchParams.get('action') === 'part') {
      if (request.headers.get('Content-Type') !== 'application/octet-stream') throw new UploadError(415, 'INVALID_TYPE', '分片需要使用二进制格式。');
      const bytes = await readUpload(request, UPLOAD_PART_BYTES);
      result = await uploadPart(env.ADMIN_DB, env.ADMIN_MEDIA, user, url.searchParams.get('uploadId'), Number(url.searchParams.get('partNumber')), bytes);
    } else if (request.method === 'POST') {
      if (!request.headers.get('Content-Type')?.includes('application/json')) throw new UploadError(415, 'INVALID_TYPE', '请求需要使用 JSON。');
      let input;
      const bytes = await readUpload(request, 8192);
      try { input = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw new UploadError(400, 'INVALID_JSON', '请求内容格式不正确。'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new UploadError(400, 'INVALID_JSON', '请求内容格式不正确。');
      if (input.action === 'begin') result = await beginUpload(env.ADMIN_DB, env.ADMIN_MEDIA, user, input);
      else if (input.action === 'status') result = await uploadStatus(env.ADMIN_DB, user, input.uploadId);
      else if (input.action === 'complete') result = await completeUpload(env.ADMIN_DB, env.ADMIN_MEDIA, user, input.uploadId);
      else if (input.action === 'abort') result = await abortUpload(env.ADMIN_DB, env.ADMIN_MEDIA, user, input.uploadId);
      else throw new UploadError(400, 'UNKNOWN_ACTION', '不支持的上传操作。');
    } else throw new UploadError(405, 'METHOD_NOT_ALLOWED', '不支持的请求方法。');
    return reply(request, 200, result);
  } catch (error) {
    if (error instanceof UploadError || (Number.isInteger(error.status) && typeof error.code === 'string'))
      return reply(request, error.status, { ok: false, code: error.code, error: error.message });
    console.error('Admin media upload failed:', error.name);
    return reply(request, 503, { ok: false, code: 'MEDIA_UNAVAILABLE', error: '媒体存储暂时不可用，请保留原文件并重试。' });
  }
}
export const onRequestGet = handle;
export const onRequestPost = handle;
export const onRequestOptions = handle;
