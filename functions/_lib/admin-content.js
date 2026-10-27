import '../../js/content-schema.js';

export const DEFAULTS = { ...globalThis.HeritageContent.defaults, auditLogs: [] };
export function validateContent(body) { return globalThis.HeritageContent.validateBundle(body); }
const clone = value => JSON.parse(JSON.stringify(value));
const stable = globalThis.HeritageContent.canonical;
const equal = (a, b) => a === b || (a && b && typeof a === 'object' && typeof b === 'object'
  && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => a[key] === b[key])) || stable(a) === stable(b);
async function fingerprint(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
function undoData(previous, value) {
  if (!previous || typeof previous !== 'object' || !value || typeof value !== 'object') return { before: previous, undoPatch: false };
  const before = {}, remove = [];
  for (const key of new Set([...Object.keys(previous), ...Object.keys(value)])) {
    if (equal(previous[key], value[key])) continue;
    if (Object.hasOwn(previous, key)) before[key] = previous[key]; else remove.push(key);
  }
  return { before, remove, undoPatch: true };
}
const groups = ['kb', 'kepu', 'dialect'];

function cells(content) {
  return new Map([...globalThis.HeritageContent.contentCells(content)].filter(([key]) => key.includes('/')));
}
function setCell(content, key, value) {
  globalThis.HeritageContent.setContentCell(content, key, clone(value));
}
export async function applyChanges(current, changes, user, tokens) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 10000) throw new Error('请选择需要保存的内容');
  const next = safeContent(current, tokens), before = globalThis.HeritageContent.contentCells(next);
  const conflicts = [], accepted = [], seen = new Set();
  let changed = false;
  for (const change of changes) {
    if (!change || typeof change.key !== 'string' || seen.has(change.key) || !/^[a-f0-9]{64}$/.test(change.baseHash) || !Object.hasOwn(change, 'value')) throw new Error('保存内容格式不正确');
    seen.add(change.key);
    if (!change.key.includes('/') && user.role !== 'super_admin') throw new Error('仅管理员可修改设置');
    // Validate the cell key and candidate even when its precondition will conflict.
    const candidate = clone(DEFAULTS);
    globalThis.HeritageContent.setContentCell(candidate, change.key, change.value);
    validateContent(candidate);
    const actual = before.get(change.key) ?? null;
    if (globalThis.HeritageContent.comparable(actual) !== globalThis.HeritageContent.comparable(change.value) && await globalThis.HeritageContent.cellHash(actual) !== change.baseHash) {
      conflicts.push(change.key); continue;
    }
    globalThis.HeritageContent.setContentCell(next, change.key, change.value);
    if (globalThis.HeritageContent.comparable(actual) !== globalThis.HeritageContent.comparable(change.value)) changed = true;
    accepted.push(change.key);
  }
  validateContent(next);
  return { next: changed ? await updatedContent(current, next, user, tokens) : current, conflicts, accepted, changed };
}
function label(value, key) { return value?.title || value?.name || value?.item?.name || key.split('/')[1]; }
export function redact(value, tokens) {
  let text = String(value || '').replace(/NFYJ-INV-[A-Z0-9-]+/gi, '[邀请凭据已隐藏]');
  for (const token of tokens) if (token.token) text = text.split(token.token).join('[邀请凭据已隐藏]');
  return text;
}
export function safeContent(content, tokens) {
  // Images and text are immutable strings. Copy containers and record metadata without re-encoding the whole library.
  const copyRecord = record => record && typeof record === 'object' && !Array.isArray(record) ? { ...record } : record;
  const result = Object.fromEntries(Object.keys(DEFAULTS).filter(key => key !== 'auditLogs').map(key => {
    const value = content[key] ?? DEFAULTS[key];
    return [key, Array.isArray(value) ? value.map(copyRecord) : Object.fromEntries(Object.entries(value).map(([id, record]) => [id, copyRecord(record)]))];
  }));
  const records = groups.flatMap(group => [...(Array.isArray(result[group + 'Custom']) ? result[group + 'Custom'] : []), ...Object.values(result[group + 'Edited'] || {})]);
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    if (record.creatorName) record.creatorName = redact(record.creatorName, tokens);
    if (record.creatorTokenId) {
      const token = tokens.find(t => t.token === record.creatorTokenId);
      if (token) record.creatorTokenId = token.id;
      else if (/NFYJ-INV-/i.test(record.creatorTokenId)) record.creatorTokenId = '';
    }
  }
  return result;
}
export function safeAudit(content, tokens) {
  return (content.auditLogs || []).filter(log => log && typeof log === 'object').map(log => ({
    id: String(log.id || ''), time: Number(log.time) || 0,
    actor: redact(log.actor, tokens), action: redact(log.action, tokens), detail: redact(log.detail, tokens)
  }));
}
export function audit(content, user, action, detail, tokens) {
  const logs = safeAudit(content, tokens);
  logs.unshift({ id: crypto.randomUUID(), time: Date.now(), actor: redact(user.name, tokens), tokenId: user.tokenId, action, detail: redact(detail, tokens) });
  content.auditLogs = logs.slice(0, 200);
}
export async function updatedContent(current, submitted, user, tokens) {
  const next = { ...submitted, auditLogs: current.auditLogs || [], _history: (current._history || []).slice(), _notifications: (current._notifications || []).slice() };
  const before = cells(safeContent(current, tokens)), after = cells(next);
  let changes = 0;
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const previous = before.get(key) ?? null;
    let value = after.get(key) ?? null;
    const submittedValue = value;
    if (value && typeof value === 'object') {
      value = { ...value };
      // Creation provenance is assigned by the authenticated server, and never transferred by a client edit.
      for (const prop of ['creatorName', 'creatorTokenId', 'createdAt']) {
        if (previous && Object.hasOwn(previous, prop)) value[prop] = previous[prop];
        else delete value[prop];
      }
      if (!previous) Object.assign(value, { creatorName: user.name, creatorTokenId: user.tokenId, createdAt: Date.now() });
    }
    if (equal(previous, value)) {
      if (!equal(submittedValue, value)) globalThis.HeritageContent.setContentCell(next, key, value);
      continue;
    }
    setCell(next, key, value);
    changes++;
    // Store only the old changed fields and a digest, so changing a title never duplicates its image.
    next._history.push({ id: crypto.randomUUID(), key, tokenId: user.tokenId, actor: user.name, time: Date.now(),
      ...undoData(previous, value), afterHash: await fingerprint(value), title: label(value || previous, key),
      kind: key.includes('Deleted/') ? '删除内置内容' : previous === null ? '新增内容' : value === null ? '删除内容' : '编辑内容' });
  }
  const configChanged = !equal(current.apiConfig, next.apiConfig) || !equal(current.workflowConfig, next.workflowConfig);
  if (changes || configChanged) audit(next, user, '保存内容', '保存 ' + changes + ' 项内容修改' + (configChanged ? '，更新 AI 配置' : ''), tokens);
  return next;
}
export function contributions(content, tokens) {
  const rows = new Map();
  for (const op of content._history || []) {
    if (op.undone || !op.tokenId) continue;
    const [field, id] = op.key.split('/');
    const type = field.startsWith('kepu') ? 'kepu' : field.startsWith('dialect') ? 'dialect' : 'kb';
    rows.set(op.tokenId + ':' + type + ':' + id, { id, type, tokenId: op.tokenId,
      title: op.title, preview: op.kind, createdAt: op.time });
  }
  for (const [key, entry] of cells(safeContent(content, tokens))) {
    if (!key.includes('Custom/') || !entry.creatorTokenId) continue;
    const [field, id] = key.split('/'), type = field.replace('Custom', '');
    const rowKey = entry.creatorTokenId + ':' + type + ':' + id;
    if (!rows.has(rowKey)) rows.set(rowKey, { id, type, tokenId: entry.creatorTokenId, title: label(entry, key), preview: '历史新增内容', createdAt: entry.createdAt || 0 });
  }
  return [...rows.values()];
}
export async function rollback(content, token, user, tokens, item, reason) {
  const next = { ...safeContent(content, tokens), auditLogs: (content.auditLogs || []).slice(),
    _history: (content._history || []).map(op => ({ ...op })), _notifications: (content._notifications || []).map(n => ({ ...n })) };
  const selected = op => op.tokenId === token.id && (!item || (op.key === item.type + 'Custom/' + item.id || op.key === item.type + 'Edited/' + item.id || op.key === item.type + 'Deleted/' + item.id));
  const restored = new Set(), skipped = new Set();
  const history = next._history;
  for (let i = history.length - 1; i >= 0; i--) {
    const op = history[i];
    if (op.undone || !selected(op)) continue;
    const laterOther = history.slice(i + 1).some(later => !later.undone && later.key === op.key && later.tokenId !== token.id);
    const current = cells(next).get(op.key) ?? null;
    if (laterOther || await fingerprint(current) !== op.afterHash) { skipped.add(op.key); continue; }
    const previous = op.undoPatch ? { ...current, ...op.before } : op.before;
    if (op.undoPatch) for (const key of op.remove) delete previous[key];
    setCell(next, op.key, previous);
    op.undone = Date.now(); restored.add(op.key);
  }
  // Old custom records can be withdrawn; pre-upgrade edits have no trustworthy before-version.
  for (const [key, entry] of cells(next)) {
    if (!key.includes('Custom/') || entry.creatorTokenId !== token.id || (item && key !== item.type + 'Custom/' + item.id)) continue;
    if (history.some(op => op.key === key)) continue;
    setCell(next, key, null); restored.add(key);
  }
  if (restored.size) next._notifications.unshift({ id: crypto.randomUUID(), tokenId: token.id, time: Date.now(), read: false,
    targetType: item?.type || 'all', targetTypeName: item ? '内容审核' : '修改回滚', targetTitle: redact(item?.title || '已撤回 ' + restored.size + ' 项修改', tokens), reason: redact(reason, tokens) });
  audit(next, user, item ? '剔除修改' : '撤销修改', '受邀人员「' + token.name + '」（ID ' + token.id + '）：撤回 ' + restored.size + ' 项，保留后续修改 ' + skipped.size + ' 项；原因：' + reason, tokens);
  return { next, totalRemoved: restored.size, skipped: skipped.size };
}
