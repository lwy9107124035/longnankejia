import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { createAdminBackend } from './helpers/admin-harness.mjs';
import { createMediaRuntime } from './helpers/media-r2.mjs';
import { storeMedia } from '../functions/_lib/admin-media.js';
import { onRequestGet } from '../functions/api/media/[id].js';
const bytes = fs.readFileSync(new URL('../assets/model-references/hutoumao-211.jpg',import.meta.url));
const image = 'data:image/jpeg;base64,' + bytes.toString('base64');
function database(t, schema='admin') { const backend=createAdminBackend({schema});t.after(()=>backend.close());return backend; }
function reads(db, hold=false) {
  const prepare=db.prepare.bind(db);let calls=0,release,entered;
  const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  db.prepare=sql=>{const statement=prepare(sql),all=statement.all.bind(statement);statement.all=async()=>{
    const value=await all();if(sql.includes('key >= ?')) { calls++;if(hold&&calls===1){entered();await gate;} }return value;
  };return statement;};
  return {started,release,get calls(){return calls;}};
}

test('simultaneous legacy GET, HEAD and Range reads coalesce plain D1 data without sharing response streams',async t=>{
  const primary=database(t),images=database(t,'media'),saved=await storeMedia(primary.db,image);primary.env.ADMIN_MEDIA_DB=images.db;
  const freshReads=reads(images.db,true),oldReads=reads(primary.db);t.after(freshReads.release);
  const pending=Array.from({length:50},(_,i)=>primary.fetchApi(saved.url,i%3===1?{method:'HEAD'}:i%3===2?{headers:{Range:'bytes=5-25'}}:{}));
  await freshReads.started;freshReads.release();const responses=await Promise.all(pending);
  for(const [i,response] of responses.entries()) {
    assert.equal(response.status,i%3===2?206:200);const actual=Buffer.from(await response.arrayBuffer());
    assert.deepEqual(actual,i%3===1?Buffer.alloc(0):i%3===2?bytes.subarray(5,26):bytes);
  }
  assert.equal(freshReads.calls,2);assert.equal(oldReads.calls,2);
  assert.equal((await primary.fetchApi(saved.url)).status,200);assert.equal(freshReads.calls,3,'completed reads are not retained as a hidden in-memory cache');
});

test('different legacy bindings cannot join another database pending media read',async t=>{
  const a=database(t),b=database(t),images=database(t,'media'),saved=await storeMedia(a.db,image);
  a.env.ADMIN_MEDIA_DB=images.db;b.env.ADMIN_MEDIA_DB=images.db;
  const held=reads(images.db,true);t.after(held.release);const pending=a.fetchApi(saved.url);await held.started;
  assert.equal((await b.fetchApi(saved.url)).status,404);held.release();assert.equal((await pending).status,200);
});

test('a failed media read is not retained or cacheable and a later healthy read recovers',async t=>{
  const primary=database(t),saved=await storeMedia(primary.db,image),prepare=primary.db.prepare;
  primary.db.prepare=()=>{throw Error('synthetic D1 unavailable');};
  for(const response of await Promise.all(Array.from({length:20},()=>primary.fetchApi(saved.url)))) {
    assert.equal(response.status,503);assert.equal(response.headers.get('Cache-Control'),'no-store');
  }
  primary.db.prepare=prepare;const recovered=await primary.fetchApi(saved.url);assert.equal(recovered.status,200);assert.deepEqual(Buffer.from(await recovered.arrayBuffer()),bytes);
});

test('edge cache failure does not turn a valid public image into a storage error',async t=>{
  const primary=database(t),saved=await storeMedia(primary.db,image),original=globalThis.caches,warning=console.warn,tasks=[];
  t.after(()=>{if(original===undefined)delete globalThis.caches;else globalThis.caches=original;console.warn=warning;});
  let reads=0,writes=0;console.warn=()=>{};
  globalThis.caches={default:{match:async()=>{reads++;throw Error('synthetic cache unavailable');},put:async()=>{writes++;throw Error('synthetic cache full');}}};
  const response=await onRequestGet({request:new Request('http://localhost'+saved.url),env:primary.env,waitUntil:task=>tasks.push(task)});
  assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);await Promise.all(tasks);assert.equal(reads,1);assert.equal(writes,1);
});

test('real Worker cache keeps exact bytes and legacy encoding, leaves HEAD and Range uncached, and never stores misses', {timeout:30000}, async t=>{
  const runtime=await createMediaRuntime(t,{api:true,r2:false}),saved=await storeMedia(runtime.db,image);
  const coldHead=await runtime.fetch('http://localhost'+saved.url,{method:'HEAD'});assert.equal(Number(coldHead.headers.get('Content-Length')),bytes.length);assert.equal((await coldHead.arrayBuffer()).byteLength,0);
  const responses=await Promise.all(Array.from({length:50},()=>runtime.fetch('http://localhost'+saved.url)));
  for(const response of responses){assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);}
  let cached;
  for(let i=0;i<20;i++) {cached=await runtime.fetch('http://localhost'+saved.url+'?ignored=1');await cached.arrayBuffer();if(cached.headers.get('X-Media-Cache')==='HIT')break;await sleep(10);}
  assert.equal(cached.headers.get('X-Media-Cache'),'HIT');assert.ok(cached.headers.get('X-Media-Base64-Length'));
  const head=await runtime.fetch('http://localhost'+saved.url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('X-Media-Cache'),'BYPASS');assert.equal((await head.arrayBuffer()).byteLength,0);
  assert.equal(Number(head.headers.get('Content-Length')),bytes.length);
  const range=await runtime.fetch('http://localhost'+saved.url,{headers:{Range:'bytes=5-25'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(5,26));
  const invalid=await runtime.fetch('http://localhost'+saved.url,{headers:{Range:'bytes=bad'}});assert.equal(invalid.status,416);assert.equal(invalid.headers.get('Cache-Control'),'no-store');
  const other='data:image/jpeg;base64,'+Buffer.concat([bytes,Buffer.from('synthetic trailing bytes')]).toString('base64'),url=await globalThis.HeritageContent.mediaIdentity(other);
  assert.equal((await runtime.fetch('http://localhost'+url)).status,404);await storeMedia(runtime.db,other);assert.equal((await runtime.fetch('http://localhost'+url)).status,200);
  await runtime.db.prepare('DROP TABLE admin_state').run();
  const retained=await runtime.fetch('http://localhost'+saved.url);assert.equal(retained.status,200);assert.equal(retained.headers.get('X-Media-Cache'),'HIT');assert.deepEqual(Buffer.from(await retained.arrayBuffer()),bytes);
  assert.equal((await runtime.fetch('http://another-host'+saved.url)).status,503,'cache keys stay within their original hostname');
});
