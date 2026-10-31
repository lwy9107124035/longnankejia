import { spawn } from 'node:child_process';
import { curlConfiguration, readWranglerToken, TARGETS } from '../migrate-content-records.mjs';
import { readDatabaseCapacity } from '../maintenance-health.mjs';

export async function cloudflareRead(apiPath, body) {
  if (!apiPath.startsWith('/') || body && (apiPath !== '/graphql' || !/^query\b/.test(body.query || ''))) throw Error('Only Cloudflare metadata GETs and analytics queries are allowed');
  const token = readWranglerToken();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--config', '-'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); let output = '', length = 0;
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { length += Buffer.byteLength(chunk); if (length > 8 * 1024 * 1024) child.kill(); else output += chunk; });
    child.stderr.resume(); child.on('error', () => reject(Error('Cloudflare read connection unavailable')));
    child.stdin.on('error', () => reject(Error('Cloudflare read input failed')));
    child.on('close', code => {
      if (length > 8 * 1024 * 1024 || code && code !== 22) return reject(Error('Cloudflare read transport was not confirmed'));
      try { resolve(JSON.parse(output)); } catch { reject(Error('Cloudflare read response is invalid')); }
    });
    child.stdin.end(curlConfiguration('https://api.cloudflare.com/client/v4' + apiPath, token, body, body ? 'POST' : 'GET'));
  });
  if (result.errors?.length || !body && result.success !== true) throw Error('Cloudflare read rejected: ' + (result.errors || []).map(error => error.code).filter(Number.isFinite).join(','));
  return body ? result : result.result;
}

export async function getProjectAccount({ accountId = process.env.CLOUDFLARE_ACCOUNT_ID, read = cloudflareRead, refresh = readDatabaseCapacity } = {}) {
  async function locate() {
    const accounts = accountId ? [{ id: accountId }] : await read('/accounts');
    for (const account of accounts) {
      if (!/^[a-f0-9]{32}$/i.test(account.id || '')) throw Error('Cloudflare account identifier is invalid');
      try { const database = await read('/accounts/' + account.id + '/d1/database/' + TARGETS.codex.id); if (database.uuid === TARGETS.codex.id) return account.id; }
      catch (error) { if (!/10000|7404/.test(error.message)) throw error; }
    }
    throw Error('Cloudflare authorization for the codex database is unavailable');
  }
  try { return await locate(); }
  catch (error) {
    if (!/^Cloudflare read rejected: (?:\d+,)*9109(?:,\d+)*$/.test(error.message)) throw error;
    // Wrangler can refresh existing OAuth in CI mode; it must never start a browser login.
    await refresh(TARGETS.codex.id);
    return locate();
  }
}
