import {assertLoadPermit} from './load-budget.mjs';
import {cloudflareRead} from '../../scripts/_lib/cloudflare-read.mjs';
import {readWranglerToken,TARGETS} from '../../scripts/migrate-content-records.mjs';
import {readLimited} from '../../functions/_lib/read-limited.js';

export async function ensureCodexReadReplication(account,permit,{read=cloudflareRead,request=fetch,token=readWranglerToken}={}) {
  assertLoadPermit(permit,15000);
  if(!/^[a-f0-9]{32}$/i.test(account))throw Error('Invalid account identifier');
  const path='/accounts/'+account+'/d1/database/'+TARGETS.codex.id;
  const current=await read(path);
  if(current.uuid!==TARGETS.codex.id)throw Error('Preview database identity mismatch');
  if(current.read_replication?.mode==='auto')return {mode:'auto',changed:false};
  if(current.read_replication?.mode!=='disabled')throw Error('Preview read replication setting unknown');
  assertLoadPermit(permit,15000);
  let response;
  try {response=await request('https://api.cloudflare.com/client/v4'+path,{method:'PUT',redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},body:JSON.stringify({read_replication:{mode:'auto'}})});}
  catch {throw Error('Preview read replication update was not confirmed');}
  let result;
  try {result=JSON.parse(new TextDecoder().decode(await readLimited(response,1024*1024)));}
  catch {throw Error('Preview read replication response was invalid');}
  if(!response.ok||result.success!==true||result.errors?.length)throw Error('Preview read replication update rejected');
  const verified=await read(path);
  if(verified.uuid!==TARGETS.codex.id||verified.read_replication?.mode!=='auto')throw Error('Preview read replication update not verified');
  return {mode:'auto',changed:true};
}
