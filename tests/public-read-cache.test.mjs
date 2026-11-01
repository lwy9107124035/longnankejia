import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import {createAdminBackend} from './helpers/admin-harness.mjs';
import {createMediaRuntime} from './helpers/media-r2.mjs';
import {migrateRecordStorage} from '../functions/_lib/admin-records.js';
import {onRequestGet} from '../functions/api/admin/sync.js';
const schema=globalThis.HeritageContent, catalog='/api/admin/sync?format=pages';
function content(name='公开原文') {const value=structuredClone(schema.defaults);value.kepuCustom=Array.from({length:70},(_,i)=>({id:'snapshot-'+i,name:name+i,detail:'完整公开正文'}));return value;}
async function backend(t,name) {const value=createAdminBackend();t.after(()=>value.close());value.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql',import.meta.url),'utf8'));await migrateRecordStorage(value.db,{value:content(name),revision:0});return value;}
function cache(t) {
  const original=globalThis.caches,entries=new Map();let readFailure=false,writeFailure=false;
  t.after(()=>{if(original===undefined)delete globalThis.caches;else globalThis.caches=original;});
  globalThis.caches={open:async()=>({match:async key=>{if(readFailure)throw Error('synthetic cache read failure');return entries.get(key.url)?.clone();},put:async(key,value)=>{if(writeFailure)throw Error('synthetic cache write failure');entries.set(key.url,value.clone());}})};
  return {entries,set readFailure(value){readFailure=value;},set writeFailure(value){writeFailure=value;}};
}
async function request(env,url=catalog,headers={}) {
  const tasks=[],response=await onRequestGet({request:new Request('http://127.0.0.1:8931'+url,{headers}),env,waitUntil:task=>tasks.push(task)});
  await Promise.all(tasks);return response;
}

test('versioned public bodies remain no-store, keep per-request CORS and never cache authenticated responses',async t=>{
  const storage=cache(t),site=await backend(t),root=(await site.call({action:'login',credential:'admin123',clientId:'cached-admin'})).data;
  const invite=(await site.call({action:'create_token',name:'隔离邀请码',days:1},root.bearer)).data.token;
  for(const origin of ['http://127.0.0.1:8931','https://lwy9107124035.github.io']) {
    const response=await request(site.env,catalog,{Origin:origin}),body=await response.json();assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/no-store/);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
    assert.equal(body.counts.kepuCustom,70);for(const field of ['tokens','session','auditLogs','recovery','notifications'])assert.equal(Object.hasOwn(body,field),false);
  }
  assert.equal(storage.entries.size,1);
  const admin=await request(site.env,catalog,{Authorization:'Bearer '+root.bearer});assert.equal((await admin.json()).tokens[0].token,invite.token);
  assert.equal((await request(site.env,catalog,{Authorization:'Bearer invalid'})).status,401);assert.equal(storage.entries.size,1);
  for(const response of storage.entries.values())assert.equal((await response.clone().text()).includes(invite.token),false);
});

test('a write in another isolate immediately selects the new version, and obsolete cursors do not reuse cached pages',async t=>{
  cache(t);const site=await backend(t),before=await (await request(site.env)).json();
  const first=await (await request(site.env,'/api/admin/sync?format=records&field=kepuCustom&summary=1')).json();assert.ok(first.cursor);
  const changed={...content().kepuCustom[0],name:'另一实例新正文'},digest=await schema.cellHash(changed,true);
  site.sqlite.exec('BEGIN');site.sqlite.prepare('UPDATE admin_content_items SET value=?,digest=?,revision=2 WHERE key=?').run(JSON.stringify(changed),digest,'kepuCustom/snapshot-0');site.sqlite.exec("UPDATE admin_state SET revision=2 WHERE key='content'; COMMIT");
  const after=await (await request(site.env)).json();assert.equal(before.revision,1);assert.equal(after.revision,2);assert.equal(after.kepuCustom[0].name,changed.name);
  const conditional=await (await request(site.env,catalog+'&revision=1')).json();assert.equal(conditional.revision,2);assert.equal(conditional.kepuCustom[0].name,changed.name);
  assert.equal((await request(site.env,'/api/admin/sync?format=records&field=kepuCustom&summary=1&cursor='+encodeURIComponent(first.cursor))).status,409);
});

test('cache keys isolate database generations even when hosts and content revisions match',async t=>{
  const storage=cache(t),a=await backend(t,'甲站'),b=await backend(t,'乙站');
  const first=await (await request(a.env)).json(),second=await (await request(b.env)).json();assert.equal(first.revision,second.revision);assert.equal(first.kepuCustom[0].name,'甲站0');assert.equal(second.kepuCustom[0].name,'乙站0');assert.equal(storage.entries.size,2);
});

test('arrivals batch before version-query dispatch while requests after another-isolate save obtain a new query', {timeout:10000},async t=>{
  cache(t);const site=await backend(t);await request(site.env);
  const prepare=site.db.prepare.bind(site.db);let calls=0,started,release;
  const firstStarted=new Promise(resolve=>{started=resolve;}),blocked=new Promise(resolve=>{release=resolve;});
  t.after(()=>release());
  site.db.prepare=sql=>{
    const statement=prepare(sql);
    if(sql==="SELECT value, revision FROM admin_state WHERE key='content'") {
      const first=statement.first.bind(statement);
      statement.first=async()=>{const number=++calls,value=await first();if(number===1){started();await blocked;}return value;};
    }
    return statement;
  };
  const waiting=Array.from({length:50},()=>request(site.env));await firstStarted;assert.equal(calls,1);
  const changed={...content().kepuCustom[0],name:'查询发出后另一个实例保存'},digest=await schema.cellHash(changed,true);
  site.sqlite.exec('BEGIN');site.sqlite.prepare('UPDATE admin_content_items SET value=?,digest=?,revision=2 WHERE key=?').run(JSON.stringify(changed),digest,'kepuCustom/snapshot-0');site.sqlite.exec("UPDATE admin_state SET revision=2 WHERE key='content'; COMMIT");
  const fresh=await (await request(site.env)).json();assert.equal(fresh.revision,2);assert.equal(fresh.kepuCustom[0].name,changed.name);assert.equal(calls,2);
  release();const previous=await Promise.all(waiting.map(async response=>(await (await response).json()).revision));assert.ok(previous.every(revision=>revision===1));
});

test('cache failures fall back to real data, and unavailable current-version reads never serve an old snapshot',async t=>{
  const storage=cache(t),site=await backend(t),warn=console.warn,error=console.error;t.after(()=>{console.warn=warn;console.error=error;});console.warn=()=>{};console.error=()=>{};
  storage.readFailure=true;storage.writeFailure=true;assert.equal((await request(site.env)).status,200);assert.equal(storage.entries.size,0);
  storage.readFailure=false;storage.writeFailure=false;assert.equal((await request(site.env)).status,200);assert.equal(storage.entries.size,1);
  site.db.prepare=()=>{throw Error('synthetic D1 unavailable');};assert.equal((await request(site.env)).status,503);
});

test('real Worker cache avoids detail-table reads but still requires a fresh version and bypasses admin and conditional refresh', {timeout:30000},async t=>{
  const runtime=await createMediaRuntime(t,{api:true,r2:false});await migrateRecordStorage(runtime.db,{value:content(),revision:0});
  const login=await runtime.fetch('http://localhost/api/admin/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',credential:'admin123',clientId:'worker-cache-root'})});const root=await login.json();assert.ok(root.bearer);
  const response=await runtime.fetch('http://localhost'+catalog);assert.equal(response.status,200);assert.equal((await response.json()).counts.kepuCustom,70);
  await runtime.db.prepare('DROP TABLE admin_content_items').run();
  let cached;
  for(let i=0;i<20;i++) {cached=await runtime.fetch('http://localhost'+catalog);if(cached.status===200)break;await cached.arrayBuffer();await sleep(10);}
  assert.equal(cached.status,200);const body=await cached.json();assert.equal(body.kepuCustom[0].name,'公开原文0');assert.match(cached.headers.get('Cache-Control'),/no-store/);assert.equal(Object.hasOwn(body,'tokens'),false);
  const simultaneous=await Promise.all(Array.from({length:50},async()=>{const reply=await runtime.fetch('http://localhost'+catalog);assert.equal(reply.status,200);return (await reply.json()).revision;}));assert.ok(simultaneous.every(revision=>revision===1));
  const unchanged=await (await runtime.fetch('http://localhost'+catalog+'&revision=1')).json();assert.equal(unchanged.unchanged,true);
  assert.equal((await runtime.fetch('http://localhost'+catalog+'&revision=0')).status,503);
  assert.equal((await runtime.fetch('http://localhost'+catalog,{headers:{Authorization:'Bearer '+root.bearer}})).status,503);
  await runtime.db.prepare("UPDATE admin_state SET revision=2 WHERE key='content'").run();assert.equal((await runtime.fetch('http://localhost'+catalog)).status,503);
});
