import { MEDIA_TYPES, mediaKey, mediaDataUrl, storeMedia, storeBinaryMedia, verifiedMedia } from './admin-media.js';

export const UPLOAD_PART_BYTES = 8 * 1024 * 1024;
export const UPLOAD_MAX_BYTES = 250 * 1024 * 1024;
const IMAGE_MAX_BYTES = 3749982;
const ID = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();

export class UploadError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
const fail = (status, code, message) => { throw new UploadError(status, code, message); };
const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
const key = row => 'uploads/' + row.id;
const requireLock = result => { if (result.meta.changes !== 1) fail(409, 'UPLOAD_LOCK_LOST', '上传处理已超时，请查询会话状态后重试。'); };

async function findUpload(db, user, id) {
  if (typeof id !== 'string' || !ID.test(id)) fail(400, 'INVALID_UPLOAD', '上传会话格式不正确。');
  const row = await db.prepare('SELECT * FROM admin_media_uploads WHERE id = ?').bind(id).first();
  if (!row || (user.role !== 'super_admin' && row.owner_session_id !== user.sessionId)) fail(404, 'UPLOAD_NOT_FOUND', '上传会话不存在。');
  return row;
}

async function withUploadLock(db, user, id, run) {
  await findUpload(db, user, id);
  const token = crypto.randomUUID(), now = Date.now();
  const locked = await db.prepare('UPDATE admin_media_uploads SET lock_token = ?, lock_until = ? WHERE id = ? AND lock_until <= ?')
    .bind(token, now + 15 * 60000, id, now).run();
  if (!locked.meta.changes) fail(409, 'UPLOAD_BUSY', '此上传会话正在处理，请稍后重试。');
  try {
    const current = await findUpload(db, user, id);
    const result = await run(current, token);
    const held = await db.prepare('SELECT id FROM admin_media_uploads WHERE id = ? AND lock_token = ? AND lock_until > ?').bind(id, token, Date.now()).first();
    if (!held) fail(409, 'UPLOAD_LOCK_LOST', '上传处理已超时，请查询会话状态后重试。');
    return result;
  } finally {
    await db.prepare('UPDATE admin_media_uploads SET lock_token = NULL, lock_until = 0 WHERE id = ? AND lock_token = ?').bind(id, token).run();
  }
}

function active(row) {
  if (row.status !== 'uploading') fail(409, 'UPLOAD_NOT_ACTIVE', '此上传会话不能继续接收分片。');
  if (row.expires_at <= Date.now()) fail(410, 'UPLOAD_EXPIRED', '上传会话已过期，请重新开始上传。');
}

async function parts(db, id) {
  return (await db.prepare('SELECT part_number, size, sha256, etag FROM admin_media_upload_parts WHERE upload_id = ? ORDER BY part_number').bind(id).all()).results;
}

function summary(row, uploaded) {
  return { ok: true, uploadId: row.id, status: row.expires_at <= Date.now() && ['creating', 'uploading'].includes(row.status) ? 'expired' : row.status,
    type: row.media_type, size: row.size, sha256: row.sha256, partSize: UPLOAD_PART_BYTES,
    partCount: Math.ceil(row.size / UPLOAD_PART_BYTES), expiresAt: row.expires_at,
    parts: uploaded.filter(part => part.etag).map(part => ({ partNumber: part.part_number, size: part.size, sha256: part.sha256 })),
    ...(row.receipt && { receipt: JSON.parse(row.receipt) }) };
}

export async function uploadStatus(db, user, id) {
  const row = await findUpload(db, user, id);
  return summary(row, await parts(db, id));
}

export async function beginUpload(db, bucket, user, input) {
  if (typeof input.clientId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(input.clientId)) fail(400, 'INVALID_CLIENT_ID', '请提供可重复使用的上传标识。');
  if (!MEDIA_TYPES.has(input.type)) fail(415, 'INVALID_MEDIA_TYPE', '此媒体类型不允许上传。');
  if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > (input.type.startsWith('image/') ? IMAGE_MAX_BYTES : UPLOAD_MAX_BYTES))
    fail(413, 'MEDIA_TOO_LARGE', '媒体文件大小超过允许范围。');
  if (typeof input.sha256 !== 'string' || !ID.test(input.sha256)) fail(400, 'INVALID_DIGEST', '请提供文件的 SHA-256 摘要。');
  const id = await sha256(encoder.encode(user.sessionId + ':' + input.clientId)), now = Date.now();
  await db.prepare(`INSERT OR IGNORE INTO admin_media_uploads
    (id, owner_session_id, client_id, media_type, size, sha256, status, created_at, expires_at)
    SELECT ?, ?, ?, ?, ?, ?, 'creating', ?, ? WHERE
    (SELECT count(*) FROM admin_media_uploads WHERE owner_session_id = ? AND status IN ('creating','uploading','aborting') AND expires_at > ?) < 4`)
    .bind(id, user.sessionId, input.clientId, input.type, input.size, input.sha256, now, now + 86400000, user.sessionId, now).run();
  const existing = await db.prepare('SELECT * FROM admin_media_uploads WHERE id = ?').bind(id).first();
  if (!existing) fail(429, 'TOO_MANY_UPLOADS', '同时进行的上传过多，请先完成或取消已有上传。');
  if (existing.media_type !== input.type || existing.size !== input.size || existing.sha256 !== input.sha256) fail(409, 'UPLOAD_ID_REUSED', '此上传标识已用于其他文件。');
  return withUploadLock(db, user, id, async (row, token) => {
    if (row.expires_at <= Date.now() && row.status !== 'completed') fail(410, 'UPLOAD_EXPIRED', '上传会话已过期，请使用新的上传标识。');
    if (row.status === 'creating') {
      const multipart = await bucket.createMultipartUpload(key(row), {
        httpMetadata: { contentType: row.media_type }, customMetadata: { uploadId: row.id, sha256: row.sha256 }
      });
      requireLock(await db.prepare("UPDATE admin_media_uploads SET r2_upload_id = ?, status = 'uploading' WHERE id = ? AND lock_token = ? AND lock_until > ?")
        .bind(multipart.uploadId, id, token, Date.now()).run());
      row.r2_upload_id = multipart.uploadId; row.status = 'uploading';
    }
    return summary(row, await parts(db, id));
  });
}

export async function uploadPart(db, bucket, user, id, partNumber, bytes) {
  return withUploadLock(db, user, id, async (row, token) => {
    active(row);
    const count = Math.ceil(row.size / UPLOAD_PART_BYTES);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > count) fail(400, 'INVALID_PART', '分片序号不正确。');
    const size = Math.min(UPLOAD_PART_BYTES, row.size - (partNumber - 1) * UPLOAD_PART_BYTES);
    if (bytes.byteLength !== size) fail(400, 'INVALID_PART_SIZE', '分片实际字节数与文件信息不一致。');
    const digest = await sha256(bytes);
    const previous = await db.prepare('SELECT * FROM admin_media_upload_parts WHERE upload_id = ? AND part_number = ?').bind(id, partNumber).first();
    if (previous && (previous.sha256 !== digest || previous.size !== size)) fail(409, 'PART_CHANGED', '已接收分片的内容不能更改，请重新开始上传。');
    if (previous?.etag) return { ok: true, uploadId: id, partNumber, size, sha256: digest };
    if (!previous) requireLock(await db.prepare(`INSERT INTO admin_media_upload_parts (upload_id, part_number, size, sha256)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_media_uploads WHERE id = ? AND lock_token = ? AND lock_until > ?)`)
      .bind(id, partNumber, size, digest, id, token, Date.now()).run());
    const uploaded = await bucket.resumeMultipartUpload(key(row), row.r2_upload_id).uploadPart(partNumber, bytes);
    requireLock(await db.prepare(`UPDATE admin_media_upload_parts SET etag = ? WHERE upload_id = ? AND part_number = ?
      AND EXISTS (SELECT 1 FROM admin_media_uploads WHERE id = ? AND lock_token = ? AND lock_until > ?)`)
      .bind(uploaded.etag, id, partNumber, id, token, Date.now()).run());
    return { ok: true, uploadId: id, partNumber, size, sha256: digest };
  });
}

function temporaryMatches(object, row) {
  return object && object.size === row.size && object.httpMetadata.contentType === row.media_type &&
    object.customMetadata.uploadId === row.id && object.customMetadata.sha256 === row.sha256;
}

async function publishUpload(db, bucket, row) {
  const object = await bucket.get(key(row));
  if (!temporaryMatches(object, row)) throw new Error('Completed multipart object is missing or invalid');
  if (row.media_type.startsWith('image/')) {
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (await sha256(bytes) !== row.sha256) fail(422, 'DIGEST_MISMATCH', '文件摘要不一致，请重新上传。');
    return storeMedia(db, mediaDataUrl(row.media_type, bytes), bucket);
  }
  const media = await storeBinaryMedia(bucket, row.sha256, object.body, row.media_type, row.sha256);
  if (!verifiedMedia(media, row.media_type, row.size, row.sha256)) throw new Error('Published media verification failed');
  return { id: row.sha256, url: '/api/media/' + row.sha256 };
}

export async function completeUpload(db, bucket, user, id) {
  return withUploadLock(db, user, id, async (row, token) => {
    if (row.status === 'completed') {
      const receipt = JSON.parse(row.receipt), object = await bucket.head(mediaKey(receipt.id));
      if (!verifiedMedia(object, row.media_type, row.size, row.sha256)) throw new Error('Published media is no longer available');
      await bucket.delete(key(row));
      return { ok: true, ...receipt };
    }
    active(row);
    const uploaded = await parts(db, id), count = Math.ceil(row.size / UPLOAD_PART_BYTES);
    if (uploaded.length !== count || uploaded.some((part, i) => part.part_number !== i + 1 || !part.etag))
      fail(409, 'PARTS_MISSING', '文件分片尚未全部确认，请继续上传。');
    // A complete() reply can be lost after R2 commits the object. Recover only from its exact session metadata.
    const temporary = await bucket.head(key(row));
    if (!temporaryMatches(temporary, row)) await bucket.resumeMultipartUpload(key(row), row.r2_upload_id)
      .complete(uploaded.map(part => ({ partNumber: part.part_number, etag: part.etag })));
    const media = await publishUpload(db, bucket, row);
    const receipt = { uploadId: id, ...media, type: row.media_type, size: row.size, sha256: row.sha256, completedAt: Date.now() };
    requireLock(await db.prepare("UPDATE admin_media_uploads SET status = 'completed', receipt = ? WHERE id = ? AND lock_token = ? AND lock_until > ?")
      .bind(JSON.stringify(receipt), id, token, Date.now()).run());
    await bucket.delete(key(row));
    return { ok: true, ...receipt };
  });
}

export async function abortUpload(db, bucket, user, id) {
  return withUploadLock(db, user, id, async (row, token) => {
    if (row.status === 'completed') fail(409, 'UPLOAD_COMPLETED', '已完成上传的媒体不能通过取消会话删除。');
    if (row.status !== 'aborted') {
      requireLock(await db.prepare("UPDATE admin_media_uploads SET status = 'aborting' WHERE id = ? AND lock_token = ? AND lock_until > ?").bind(id, token, Date.now()).run());
      if (row.r2_upload_id) await bucket.resumeMultipartUpload(key(row), row.r2_upload_id).abort();
      await bucket.delete(key(row));
      requireLock(await db.prepare("UPDATE admin_media_uploads SET status = 'aborted' WHERE id = ? AND lock_token = ? AND lock_until > ?").bind(id, token, Date.now()).run());
    }
    return { ok: true, uploadId: id, status: 'aborted' };
  });
}
