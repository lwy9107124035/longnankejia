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

test('a snapshot that advances during a concurrent save is published under its actual revision',async t=>{
  const storage=cache(t),site=await backend(t),batch=site.db.batch.bind(site.db),prepare=site.db.prepare.bind(site.db);let changed=false;
  site.db.batch=async statements=>{
    if(!changed){changed=true;const row={...content().kepuCustom[0],name:'读取中已保存的新名称'},digest=await schema.cellHash(row,true);
      site.sqlite.exec('BEGIN');site.sqlite.prepare('UPDATE admin_content_items SET value=?,digest=?,revision=2 WHERE key=?').run(JSON.stringify(row),digest,'kepuCustom/snapshot-0');site.sqlite.exec("UPDATE admin_state SET revision=2 WHERE key='content'; COMMIT");}
    return batch(statements);
  };
  const url='/api/admin/sync?format=record&key=kepuCustom/snapshot-0',first=await(await request(site.env,url)).json();
  assert.equal(first.revision,2);assert.equal(first.rows[0].value.name,'读取中已保存的新名称');
  assert.equal(storage.entries.size,1);assert.equal(new URL([...storage.entries.keys()][0]).searchParams.get('_revision'),'2');
  site.db.prepare=sql=>{if(sql!=="SELECT value, revision FROM admin_state WHERE key='content'")throw Error('The snapshot was unnecessarily rebuilt');return prepare(sql);};
  const second=await request(site.env,url);assert.equal(second.status,200);assert.equal((await second.json()).revision,2);
});

test('cold snapshot publication stays shared through cache writes and unrelated administrator requests',async t=>{
  cache(t);const site=await backend(t),root=(await site.call({action:'login',credential:'admin123',clientId:'cold-publication'})).data;
  const open=globalThis.caches.open.bind(globalThis.caches);let release,started;
  const publication=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
  globalThis.caches.open=async name=>{const value=await open(name);return {...value,put:async(...args)=>{started();await publication;return value.put(...args);}};};
  const prepare=site.db.prepare.bind(site.db);let dataReads=0,versions=0,nextVersion,afterVersion;
  site.db.prepare=sql=>{
    if(sql.startsWith('SELECT key,kind,value FROM admin_content_items WHERE generation=? AND key=?'))dataReads++;
    const statement=prepare(sql);
    if(sql==="SELECT value, revision FROM admin_state WHERE key='content'") {
      const first=statement.first.bind(statement);statement.first=async()=>{const row=await first();versions++;if(versions===nextVersion)afterVersion();return row;};
    }
    return statement;
  };
  const url='/api/admin/sync?format=record&key=kepuCustom/snapshot-0',first=request(site.env,url),waiting=[];
  try {
    await entered;assert.equal((await site.call({action:'storage_info'},root.bearer)).status,200);
    const dispatched=new Promise(resolve=>{afterVersion=resolve;});nextVersion=versions+1;
    waiting.push(...Array.from({length:50},()=>request(site.env,url)));await dispatched;await sleep(20);
    assert.equal(dataReads,1,'A not-yet-published snapshot must not be rebuilt');
  } finally {release();await Promise.allSettled([first,...waiting]);}
  for(const response of await Promise.all([first,...waiting]))assert.equal(response.status,200);
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
  release();const previous=await Promise.all(waiting.map(async response=>{const reply=await response;assert.equal(reply.headers.get('X-Read-Version-Batch'),'50');return (await reply.json()).revision;}));assert.ok(previous.every(revision=>revision===1));
});

test('a short staggered burst shares bounded fresh-version batches instead of one database read per arrival',async t=>{
  cache(t);const site=await backend(t);await request(site.env);
  const prepare=site.db.prepare.bind(site.db);let calls=0;
  site.db.prepare=sql=>{if(sql==="SELECT value, revision FROM admin_state WHERE key='content'")calls++;return prepare(sql);};
  const bodies=await Promise.all(Array.from({length:100},(_,i)=>sleep(i).then(async()=>{const response=await request(site.env);assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/no-store/);return response.json();})));
  assert.ok(calls<=4,'100 staggered arrivals must use at most four version queries, observed '+calls);assert.ok(bodies.every(body=>body.revision===1));
  const response=await request(site.env,catalog,{'cf-placement':'remote-ICN'});assert.equal(response.headers.get('X-Function-Placement'),'remote-ICN');
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

test('public snapshots hand a fresh primary bookmark to a separate read session and never use an unconstrained replica',async t=>{
  cache(t);const site=await backend(t),constraints=[],db=site.db;
  db.withSession=constraint=>{constraints.push(constraint);assert.ok(['first-primary','synthetic-current-bookmark'].includes(constraint));
    return {prepare:db.prepare.bind(db),batch:db.batch.bind(db),getBookmark:()=>constraint==='first-primary'?'synthetic-current-bookmark':'synthetic-later-bookmark'};
  };
  const response=await request(site.env,'/api/admin/sync?format=record&key=kepuCustom/snapshot-0'),value=await response.json();
  assert.equal(response.status,200);assert.equal(value.rows[0].value.name,'公开原文0');
  assert.deepEqual(constraints,['first-primary','synthetic-current-bookmark']);
  constraints.length=0;
  assert.equal((await request(site.env,catalog+'&revision=1')).status,200);assert.deepEqual(constraints,[]);
  db.withSession=()=>{throw Error('Synthetic primary unavailable');};
  assert.equal((await request(site.env,catalog)).status,503,'An unavailable fresh primary must not silently use an older replica or cached body');
});

for(const primary of [true,false])test(`public read diagnostics distinguish ${primary?'primary':'replica'} snapshots from cached bodies without exposing bookmarks`,async t=>{
  cache(t);const site=await backend(t),batch=site.db.batch.bind(site.db);
  const root=(await site.call({action:'login',credential:'admin123',clientId:'read-diagnostics'})).data.bearer;
  site.db.batch=async statements=>(await batch(statements)).map(result=>({...result,meta:{...result.meta,served_by_primary:primary}}));
  const first=await request(site.env);
  assert.equal(first.status,200);assert.equal(first.headers.get('X-Public-Snapshot-Route'),primary?'primary':'replica');
  for(const name of ['X-Public-Version-Ms','X-Public-Snapshot-Ms'])assert.match(first.headers.get(name),/^\d+\.\d$/);
  const body=await first.json();assert.equal(Object.hasOwn(body,'route'),false);assert.equal(Object.hasOwn(body,'bookmark'),false);
  const second=await request(site.env);assert.equal(second.status,200);assert.equal(second.headers.get('X-Public-Snapshot-Route'),'edge-cache');
  const admin=await request(site.env,catalog,{Authorization:'Bearer '+root});assert.equal(admin.status,200);assert.equal(admin.headers.has('X-Public-Snapshot-Route'),false);assert.equal(admin.headers.has('X-Public-Version-Ms'),false);
});
