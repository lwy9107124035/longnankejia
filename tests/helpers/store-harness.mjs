import fs from 'node:fs';
import vm from 'node:vm';

export function setupEnvironment(backend, { local = new Map(), tab = new Map(), blocked = false, windowProperties = {}, globals = {} } = {}) {
  const storage = map => ({
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] || null; },
    getItem(key) { if (blocked) throw new Error('Storage denied'); return map.get(key) || null; },
    setItem(key, value) { if (blocked) throw new Error('Storage denied'); map.set(key, String(value)); },
    removeItem(key) { if (blocked) throw new Error('Storage denied'); map.delete(key); }
  });
  const window = Object.assign({ location: new URL('http://127.0.0.1:8931'), KNOWLEDGE_BASE: [{ id: 'base', title: '客家蓝染', answer: '传统工艺' }] }, windowProperties);
  const sandbox = { window, localStorage: storage(local), sessionStorage: storage(tab), navigator: { userAgent: 'iPhone Safari' },
    fetch: (...args) => backend.fetchApi(...args), AbortController, setTimeout, clearTimeout, console, Date, Math, JSON, Promise, crypto: globalThis.crypto, TextEncoder, btoa: globalThis.btoa };
  Object.assign(sandbox, globals);
  vm.createContext(sandbox);
  for (const file of ['content-schema.js', 'store.js']) vm.runInContext(fs.readFileSync(new URL('../../js/' + file, import.meta.url), 'utf8'), sandbox);
  return { window, store: window.Store, sandbox, local, tab };
}
