import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { onRequestGet, onRequestPost, onRequestOptions } from '../../functions/api/admin/sync.js';

// Executes the actual migration and handler SQL, rather than replacing SQL with canned results.
export function createAdminBackend({ password = 'admin123', filename = ':memory:', maxRowBytes = 2000000 } = {}) {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec(fs.readFileSync(new URL('../../migrations/admin/0001_admin.sql', import.meta.url), 'utf8'));
  const db = {
    prepare(sql) {
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async first() { return sqlite.prepare(sql).get(...params) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
        async run() {
          if (params.some(value => typeof value === 'string' && Buffer.byteLength(value) > maxRowBytes)) throw new Error('D1 row limit exceeded');
          const result = sqlite.prepare(sql).run(...params); return { meta: { changes: Number(result.changes) } };
        }
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
  const env = { ADMIN_DB: db, ADMIN_BOOTSTRAP_PASSWORD: password };
  async function fetchApi(url, options = {}) {
    const request = new Request(new URL(url, 'http://127.0.0.1:8931'), options);
    const handler = { GET: onRequestGet, POST: onRequestPost, OPTIONS: onRequestOptions }[request.method];
    return handler({ request, env });
  }
  async function call(body, bearer, headers = {}) {
    const response = await fetchApi('/api/admin/sync', {
      method: body ? 'POST' : 'GET', headers: { ...headers, ...(body && { 'Content-Type': 'application/json' }), ...(bearer && { Authorization: 'Bearer ' + bearer }) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, data: await response.json(), response };
  }
  return { sqlite, db, env, fetchApi, call, close: () => sqlite.close() };
}
