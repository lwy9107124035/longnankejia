import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createAdminBackend, captureQueryPlans } from './helpers/admin-harness.mjs';
import { migrateRecordStorage, initialRecordPages } from '../functions/_lib/admin-records.js';

test('one bounded catalog query preserves independent page sizes, continuations and byte limits for every kind',async t=>{
  const backend=createAdminBackend();t.after(()=>backend.close());backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql',import.meta.url),'utf8'));
  const content=structuredClone(globalThis.HeritageContent.defaults);
  content.kbCustom=Array.from({length:70},(_,i)=>({id:'bounded-'+String(i).padStart(3,'0'),title:'知识'+i,answer:'知识正文'}));
  content.kepuCustom=Array.from({length:70},(_,i)=>({id:'bounded-'+String(i).padStart(3,'0'),name:'科普'+i,detail:'科普正文'}));
  const manifest=await migrateRecordStorage(backend.db,{value:content,revision:0}),batch=backend.db.batch.bind(backend.db),sizes=[];
  backend.db.batch=statements=>{sizes.push(statements.length);return batch(statements);};
  const plans=captureQueryPlans(backend,sql=>sql.includes('AS runningBytes'));
  const snapshot=await initialRecordPages(backend.db,manifest);
  assert.deepEqual(sizes,[3],'Catalog, version and redaction metadata must use only three statements');
  for(const field of ['kbCustom','kepuCustom']){
    const page=snapshot.pages[field];assert.equal(page.rows.length,50);assert.ok(page.cursor);assert.equal(snapshot.manifest.counts[field],70);
    assert.equal(page.rows[0].key,field+'/bounded-000');assert.equal(page.rows.at(-1).key,field+'/bounded-049');
    assert.ok(page.rows.every(row=>!Object.hasOwn(row.value,'answer')&&!Object.hasOwn(row.value,'detail')));
  }
  assert.match(plans[0],/SEARCH candidate USING INDEX admin_content_live/);
  assert.match(plans[0],/SEARCH admin_content_items USING INDEX .*generation=\? AND key=\?/);
  const imageUrl='data:image/jpeg;base64,'+Buffer.alloc(700000,1).toString('base64');
  for(const field of ['kbCustom','kepuCustom'])for(let i=0;i<2;i++){
    const value={...content[field][i],imageUrl};backend.sqlite.prepare('UPDATE admin_content_items SET value=? WHERE generation=? AND key=?').run(JSON.stringify(value),manifest.generation,field+'/'+value.id);
  }
  const bounded=await initialRecordPages(backend.db,manifest);
  for(const field of ['kbCustom','kepuCustom']){assert.equal(bounded.pages[field].rows.length,1);assert.ok(bounded.pages[field].cursor);}
});

test('list redaction uses the invitation metadata from the same transaction as its records',async t=>{
  const backend=createAdminBackend();t.after(()=>backend.close());backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql',import.meta.url),'utf8'));
  const oldToken='NFYJ-INV-SYNTHETIC-LIST-OLD',newToken='NFYJ-INV-SYNTHETIC-LIST-NEW';
  backend.sqlite.prepare("UPDATE admin_state SET value=? WHERE key='tokens'").run(JSON.stringify([{id:'list-author-old',token:oldToken}]));
  const content=structuredClone(globalThis.HeritageContent.defaults),card={id:'list-author-card',name:'合成作者资料',detail:'正文',creatorTokenId:oldToken};content.kepuCustom=[card];
  await migrateRecordStorage(backend.db,{value:content,revision:0});
  const batch=backend.db.batch.bind(backend.db);let changed=false;
  backend.db.batch=async statements=>{
    if(!changed){changed=true;const value={...card,creatorTokenId:newToken},digest=await globalThis.HeritageContent.cellHash(value,true);
      backend.sqlite.exec('BEGIN');backend.sqlite.prepare("UPDATE admin_state SET value=?,revision=revision+1 WHERE key='tokens'").run(JSON.stringify([{id:'list-author-new',token:newToken}]));
      backend.sqlite.prepare('UPDATE admin_content_items SET value=?,digest=?,owner=?,revision=2 WHERE key=?').run(JSON.stringify(value),digest,'list-author-new','kepuCustom/list-author-card');backend.sqlite.exec("UPDATE admin_state SET revision=2 WHERE key='content'; COMMIT");}
    return batch(statements);
  };
  const response=await backend.fetchApi('/api/admin/sync?format=records&field=kepuCustom');assert.equal(response.status,200);
  const data=await response.json();assert.equal(data.revision,2);assert.equal(data.rows[0].value.creatorTokenId,'list-author-new');
  assert.equal(JSON.stringify(data).includes(newToken),false);assert.equal(JSON.stringify(data).includes(oldToken),false);
});

for (const format of ['pages', 'records']) test(`a concurrent save cannot mix ${format} counts and page rows or invalidate an already coherent snapshot`, async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql', import.meta.url), 'utf8'));
  const content = structuredClone(globalThis.HeritageContent.defaults);
  content.kepuCustom = Array.from({ length: 70 }, (_, i) => ({ id: 'snapshot-' + String(i).padStart(3, '0'), name: '快照资料' + i, detail: '完整正文' }));
  await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  const root = (await backend.call({ action: 'login', credential: 'admin123', clientId: 'snapshot-reader' })).data;
  const prepare = backend.db.prepare.bind(backend.db), batch = backend.db.batch.bind(backend.db); let written = false, writes = 0,standaloneTokenReads=0;
  async function writeDuringRead() {
    if (written) return; written = true;
    const id = 'snapshot-new-' + ++writes;
    const saved = await backend.call({ action: 'update_content', changes: [{ key: 'kepuCustom/' + id, baseHash: await globalThis.HeritageContent.cellHash(null), value: { id, name: '并发新增', detail: '新正文' } }] }, root.bearer);
    assert.equal(saved.status, 200); assert.equal(saved.data.accepted.length, 1);
  }
  backend.db.prepare = sql => {
    const statement = prepare(sql), all = statement.all.bind(statement);
    let stateKey;const bind=statement.bind.bind(statement),first=statement.first.bind(statement);
    statement.bind=(...values)=>{stateKey=values[0];return bind(...values);};
    statement.first=async()=>{if(sql==='SELECT value, revision FROM admin_state WHERE key = ?'&&stateKey==='tokens')standaloneTokenReads++;return first();};
    statement.all = async () => { const result = await all(); if (sql.includes('AS runningBytes')) await writeDuringRead(); return result; };
    return statement;
  };
  backend.db.batch = async statements => { await writeDuringRead(); return batch(statements); };
  const response = await backend.fetchApi('/api/admin/sync?format=' + format + '&field=kepuCustom&summary=1');
  assert.equal(response.status, 200);
  assert.equal(standaloneTokenReads,0,'Page rows and their redaction metadata must share one transaction');
  const data = await response.json(); assert.equal(written, true); assert.equal(data.revision, 2);
  const rows = format === 'pages' ? data.kepuCustom : data.rows.map(row => row.value), marker = format === 'pages' ? data.pages.kepuCustom : data.cursor;
  assert.equal(format === 'pages' ? data.counts.kepuCustom : data.total, 71);
  assert.equal(rows.length, 50); assert.ok(marker); assert.ok(rows.every(row => row.detail === undefined));
  const cursor = JSON.parse(Buffer.from(marker.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString());
  assert.equal(cursor.revision, data.revision);
  if (format === 'records') {
    written = false;
    const stale = await backend.fetchApi('/api/admin/sync?format=records&field=kepuCustom&summary=1&cursor=' + encodeURIComponent(marker));
    assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'PAGE_CHANGED');
  }
});

test('record detail reads its value and revision together while redacting legacy invitation credentials', async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql', import.meta.url), 'utf8'));
  const content = structuredClone(globalThis.HeritageContent.defaults);
  const invite = 'NFYJ-INV-SYNTHETIC-DETAIL-ONLY';
  content.kepuCustom = [{ id: 'detail-snapshot', name: '原名称', detail: '原正文', creatorTokenId: invite }];
  backend.sqlite.prepare("UPDATE admin_state SET value=?,revision=1 WHERE key='tokens'").run(JSON.stringify([{ id: 'detail-author', token: invite }]));
  await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  const root = (await backend.call({ action: 'login', credential: 'admin123', clientId: 'detail-reader' })).data;
  const prepare = backend.db.prepare.bind(backend.db), batch = backend.db.batch.bind(backend.db); let written = false;
  async function writeDuringRead() {
    if (written) return; written = true;
    const row = content.kepuCustom[0];
    const saved = await backend.call({ action: 'update_content', changes: [{ key: 'kepuCustom/' + row.id,
      baseHash: await globalThis.HeritageContent.cellHash({ ...row, creatorTokenId: 'detail-author' }), value: { ...row, name: '新名称', detail: '新正文' } }] }, root.bearer);
    assert.equal(saved.status, 200); assert.equal(saved.data.accepted.length, 1);
  }
  backend.db.prepare = sql => {
    const statement = prepare(sql), all = statement.all.bind(statement);
    statement.all = async () => { const result = await all(); if (sql.startsWith('SELECT key,kind,value') && sql.includes(' FROM admin_content_items')) await writeDuringRead(); return result; };
    return statement;
  };
  backend.db.batch = async statements => { await writeDuringRead(); return batch(statements); };
  const response = await backend.fetchApi('/api/admin/sync?format=record&key=kepuCustom/detail-snapshot');
  assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.revision, 2); assert.equal(data.rows[0].value.detail, '新正文');
  assert.equal(data.rows[0].value.creatorTokenId, 'detail-author'); assert.equal(JSON.stringify(data).includes(invite), false);
  assert.equal(data.rows[0].hash, await globalThis.HeritageContent.cellHash(data.rows[0].value, true));
  assert.equal((await backend.fetchApi('/api/admin/sync?format=record&key=auditLogs/private')).status, 400);
  assert.equal((await backend.fetchApi('/api/admin/sync?format=record&key=_history/private')).status, 400);
});

test('live pages skip retained deletion markers while incremental synchronization still returns deletions', async t => {
  const backend = createAdminBackend(); t.after(() => backend.close());
  backend.sqlite.exec(fs.readFileSync(new URL('../migrations/admin/0002_content_records.sql', import.meta.url), 'utf8'));
  const content = structuredClone(globalThis.HeritageContent.defaults);
  content.kepuCustom = Array.from({ length: 50 }, (_, i) => ({ id: 'z-live-' + i, name: '有效资料' + i, detail: '完整正文' }));
  const manifest = await migrateRecordStorage(backend.db, { value: content, revision: 0 });
  const insert = backend.sqlite.prepare("INSERT INTO admin_content_items(generation,key,kind,value,digest,revision) VALUES(?,?,'kepuCustom','null','synthetic-null',1)");
  backend.sqlite.exec('BEGIN');
  for (let i = 0; i < 2000; i++) insert.run(manifest.generation, 'kepuCustom/a-deleted-' + i);
  backend.sqlite.exec('COMMIT');
  const plans = captureQueryPlans(backend, sql => sql.includes('AS runningBytes'));
  const live = await (await backend.fetchApi('/api/admin/sync?format=records&field=kepuCustom&summary=1')).json();
  assert.equal(live.rows.length, 50); assert.equal(live.total, 50); assert.equal(live.cursor, '');
  assert.match(plans.at(-1), /admin_content_live/);
  const changes = await (await backend.fetchApi('/api/admin/sync?format=records&field=kepuCustom&since=0')).json();
  assert.equal(changes.rows.length, 50); assert.ok(changes.rows.every(row => row.value === null)); assert.ok(changes.cursor);
  assert.doesNotMatch(plans.at(-1), /admin_content_live/);
});
