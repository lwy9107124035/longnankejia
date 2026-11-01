import { readWranglerToken, TARGETS } from '../migrate-content-records.mjs';
import { readDatabaseCapacity } from '../maintenance-health.mjs';
import {readLimited} from '../../functions/_lib/read-limited.js';

export async function cloudflareRead(apiPath, body, {token,request=fetch}={}) {
  if (!apiPath.startsWith('/') || body && (apiPath !== '/graphql' || !/^query\b/.test(body.query || ''))) throw Error('Only Cloudflare metadata GETs and analytics queries are allowed');
  const bearer=token ?? readWranglerToken();
  let response, bytes;
  try {
    response=await request('https://api.cloudflare.com/client/v4'+apiPath,{method:body?'POST':'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000),
      headers:{Authorization:'Bearer '+bearer,...(body&&{'Content-Type':'application/json'})},...(body&&{body:JSON.stringify(body)})});
    bytes=await readLimited(response,8*1024*1024);
  } catch { throw Error('Cloudflare read transport was not confirmed'); }
  let result;
  try { result=JSON.parse(new TextDecoder().decode(bytes)); } catch { throw Error('Cloudflare read response is invalid'); }
  if (!response.ok || result.errors?.length || !body && result.success !== true) throw Error('Cloudflare read rejected: ' + (result.errors || []).map(error => error.code).filter(Number.isFinite).join(','));
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
