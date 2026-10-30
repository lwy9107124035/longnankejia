import './vendor/sha256.min.js';

const PART_BYTES = 8 * 1024 * 1024;
const MAX_BYTES = 250 * 1024 * 1024;
const TYPES = new Set(['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'video/mp4', 'video/webm', 'video/ogg']);
const aliases = { 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav', 'audio/x-m4a': 'audio/mp4', 'video/x-m4v': 'video/mp4' };
const bindings = new WeakMap();

function checkSignal(signal) {
  if (signal.aborted) throw new DOMException('上传已暂停', 'AbortError');
}

async function fileDigest(file, signal, progress) {
  const hash = window.sha256.create(), chunk = 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += chunk) {
    checkSignal(signal);
    hash.update(await file.slice(offset, offset + chunk).arrayBuffer());
    progress(Math.min(offset + chunk, file.size) / file.size);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  checkSignal(signal);
  return hash.hex();
}

function savedUpload(key) {
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    sessionStorage.removeItem(key);
    return null;
  }
}

function mount(form, input, mediaUploads) {
  const videoOnly = input.id === 'kpVideo', wrap = document.createElement('div');
  wrap.className = 'admin-media-upload';
  wrap.dataset.mediaUpload = input.id;
  wrap.style.cssText = 'margin:8px 0 14px;display:flex;flex-wrap:wrap;align-items:center;gap:8px';
  wrap.innerHTML = '<input type="file" hidden><button type="button" class="admin-btn-sm" data-media-choose>选择本地' + (videoOnly ? '视频' : '音视频') + '</button>' +
    '<button type="button" class="admin-btn-sm" data-media-retry hidden>继续上传</button>' +
    '<button type="button" class="admin-btn-sm" data-media-pause hidden>暂停</button>' +
    '<button type="button" class="admin-btn-sm" data-media-abort hidden>取消上传</button>' +
    '<progress max="100" value="0" hidden style="width:140px"></progress><span class="admin-hint" role="status" aria-live="polite"></span>';
  input.insertAdjacentElement('afterend', wrap);
  const picker = wrap.querySelector('input'), choose = wrap.querySelector('[data-media-choose]'), retry = wrap.querySelector('[data-media-retry]');
  const pause = wrap.querySelector('[data-media-pause]'), abort = wrap.querySelector('[data-media-abort]'), bar = wrap.querySelector('progress'), status = wrap.querySelector('[role="status"]');
  const save = form.querySelector('#kpSaveBtn, #dlSaveBtn');
  picker.accept = [...TYPES].filter(type => !videoOnly || type.startsWith('video/')).join(',');
  status.textContent = '最大250 MiB；刷新后重新选择同一文件可续传。';
  if (mediaUploads === false) {
    choose.disabled = true; picker.disabled = true; choose.textContent = '文件上传待启用';
    status.textContent = '服务器尚未启用文件上传，可继续填写已有音视频链接。';
    return () => wrap.remove();
  }
  let file = null, digest = '', record = null, storageKey = '', controller = null, busy = false, previousDisabled = false, applyingReceipt = false;
  const attached = () => input.isConnected && form.contains(input);
  function setBusy(value) {
    if (value && !busy && save) previousDisabled = save.disabled;
    busy = value; choose.disabled = value; retry.hidden = value || !file; pause.hidden = !value; abort.hidden = value || !file;
    if (save && attached()) save.disabled = value || previousDisabled;
  }
  function progress(label, percent) {
    if (!attached()) return;
    bar.hidden = false; bar.value = percent; status.textContent = label;
  }
  function saveRecord() { sessionStorage.setItem(storageKey, JSON.stringify(record)); }
  function guardSave(event) {
    if (busy && attached() && event.target.closest('#kpSaveBtn, #dlSaveBtn')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }
  form.addEventListener('click', guardSave, true);
  function manualLink() { if (busy && !applyingReceipt) controller.abort(); }
  input.addEventListener('input', manualLink);

  async function api(payload, session, signal, partNumber) {
    const current = window.Store.getSession();
    if (!current || current.bearer !== session.bearer) throw new Error('登录已变更，请重新选择文件后续传。');
    const url = new URL('/api/admin/uploads', location.hostname === 'lwy9107124035.github.io' ? 'https://longnankejia.pages.dev' : location.origin), headers = { Authorization: 'Bearer ' + current.bearer };
    let method = 'POST', body;
    if (partNumber) {
      url.searchParams.set('action', 'part'); url.searchParams.set('uploadId', record.uploadId); url.searchParams.set('partNumber', partNumber);
      headers['Content-Type'] = 'application/octet-stream'; body = payload;
    } else if (payload.action === 'status') {
      method = 'GET'; url.searchParams.set('uploadId', record.uploadId);
    } else { headers['Content-Type'] = 'application/json'; body = JSON.stringify(payload); }
    const response = await fetch(url, { method, body, headers, signal, cache: 'no-store', credentials: 'same-origin' });
    let result;
    try { result = await response.json(); }
    catch (error) { if (error.name === 'AbortError') throw error; throw new Error('媒体上传接口暂时不可用，请保留原文件并重试。'); }
    if (!response.ok || !result.ok) throw Object.assign(new Error(result.error || '上传未确认，请重试。'), { status: response.status, code: result.code });
    return result;
  }

  function applyReceipt(receipt, type) {
    if (receipt.uploadId !== record.uploadId || receipt.sha256 !== digest || receipt.size !== file.size || receipt.type !== type || !/^\/api\/media\/[a-f0-9]{64}$/.test(receipt.url))
      throw new Error('服务器回执与当前文件不一致，请保留原文件并重试。');
    if (!attached() || form.style.display === 'none') return;
    input.value = receipt.url;
    const mediaType = form.querySelector('#dlMediaType');
    if (mediaType) { mediaType.value = type.startsWith('video/') ? 'video' : 'audio'; mediaType.dispatchEvent(new Event('input', { bubbles: true })); }
    applyingReceipt = true;
    try { input.dispatchEvent(new Event('input', { bubbles: true })); }
    finally { applyingReceipt = false; }
    progress('媒体已上传并确认；点击保存，将链接保存到当前资料。', 100);
    retry.hidden = true; abort.hidden = true;
  }

  async function start() {
    if (!file || busy) return;
    controller = new AbortController(); const signal = controller.signal;
    setBusy(true);
    let completed = false;
    try {
      const type = aliases[file.type] || file.type;
      if (!TYPES.has(type) || (videoOnly && !type.startsWith('video/'))) throw new Error('请选择支持的音视频文件：MP4、WebM、OGG、MP3、M4A或WAV。');
      if (!file.size || file.size > MAX_BYTES) throw new Error('文件需大于0字节，且不能超过250 MiB。');
      const session = window.Store.getSession();
      if (!session) throw new Error('请先登录，再选择文件上传。');
      if (!digest) digest = await fileDigest(file, signal, ratio => progress('正在核对文件 ' + Math.round(ratio * 100) + '%', ratio * 10));
      storageKey = 'heritage-media-upload:' + input.id + ':' + window.sha256(session.bearer) + ':' + type + ':' + digest;
      record = savedUpload(storageKey);
      if (!record || record.sha256 !== digest || record.type !== type || record.size !== file.size || record.expiresAt <= Date.now()) {
        record = { clientId: crypto.randomUUID(), sha256: digest, type, size: file.size, expiresAt: Date.now() + 86400000 };
        saveRecord();
      }
      let state;
      if (record.uploadId) state = await api({ action: 'status' }, session, signal);
      if (state && ['expired', 'aborted'].includes(state.status)) {
        record = { clientId: crypto.randomUUID(), sha256: digest, type, size: file.size, expiresAt: Date.now() + 86400000 };
        saveRecord(); state = null;
      }
      if (!state || state.status === 'creating') {
        state = await api({ action: 'begin', clientId: record.clientId, type, size: file.size, sha256: digest }, session, signal);
        record.uploadId = state.uploadId; record.expiresAt = state.expiresAt; saveRecord();
      }
      checkSignal(signal);
      if (state.status === 'completed') { applyReceipt(state.receipt, type); completed = true; return; }
      if (state.status !== 'uploading' || state.partSize !== PART_BYTES) throw new Error('上传会话暂时不可继续，请取消后重试。');
      const confirmed = new Set(state.parts.map(part => part.partNumber)), count = Math.ceil(file.size / PART_BYTES);
      for (let part = 1; part <= count; part++) {
        checkSignal(signal);
        if (!attached()) throw new DOMException('编辑表单已关闭', 'AbortError');
        progress('上传分片 ' + part + '/' + count + '；已确认 ' + confirmed.size + ' 片', 10 + confirmed.size / count * 80);
        if (!confirmed.has(part)) {
          await api(file.slice((part - 1) * PART_BYTES, Math.min(part * PART_BYTES, file.size)), session, signal, part);
          confirmed.add(part);
        }
      }
      progress('分片已确认，正在校验服务器文件…', 95);
      const receipt = await api({ action: 'complete', uploadId: record.uploadId }, session, signal);
      checkSignal(signal); applyReceipt(receipt, type); completed = true;
    } catch (error) {
      if (attached()) status.textContent = error.name === 'AbortError' ? '上传已暂停；原文件和已确认分片可继续使用。' : error.message + ' 当前资料链接尚未更改。';
    } finally {
      setBusy(false);
      if (completed) { retry.hidden = true; abort.hidden = true; }
    }
  }
  choose.addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    if (!picker.files[0]) return;
    controller?.abort(); file = picker.files[0]; digest = ''; record = null; storageKey = ''; start();
  });
  retry.addEventListener('click', start);
  pause.addEventListener('click', () => controller?.abort());
  abort.addEventListener('click', async () => {
    if (busy) { controller?.abort(); return; }
    controller = new AbortController(); setBusy(true);
    try {
      if (record?.uploadId) {
        const session = window.Store.getSession();
        if (!session) throw new Error('请先登录，再取消上传。');
        await api({ action: 'abort', uploadId: record.uploadId }, session, controller.signal);
      }
      if (storageKey) sessionStorage.removeItem(storageKey);
      record = null; file = null; digest = ''; picker.value = ''; bar.hidden = true; status.textContent = '上传已取消。';
    } catch (error) { status.textContent = error.message; }
    finally { setBusy(false); }
  });
  return () => { controller?.abort(); form.removeEventListener('click', guardSave, true); input.removeEventListener('input', manualLink); wrap.remove(); };
}

export function bind(form) {
  const inputs = [...form.querySelectorAll('#kpVideo, #dlUrl')], previous = bindings.get(form);
  const mediaUploads = window.Store.getCatalog?.().capabilities?.mediaUploads;
  if (previous && previous.mediaUploads === mediaUploads && inputs.length === previous.inputs.length && inputs.every((input, i) => previous.inputs[i] === input)) return;
  previous?.dispose();
  const cleanups = inputs.map(input => mount(form, input, mediaUploads));
  bindings.set(form, { inputs, mediaUploads, dispose() { cleanups.forEach(cleanup => cleanup()); } });
}

window.MediaUpload = { bind };
