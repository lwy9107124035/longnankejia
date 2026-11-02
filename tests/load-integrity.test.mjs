import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createD1Adapter} from '../scripts/migrate-content-records.mjs';
import {retainedRowsFingerprint,verifyRecordAccounting} from './helpers/load-integrity.mjs';

test('retained-row checks detect edits, deletion and revision changes without exporting private values',async t=>{
  const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
  sql.exec("CREATE TABLE admin_state(key TEXT,value TEXT);INSERT INTO admin_state VALUES('content','{\"generation\":\"current\",\"counts\":{\"items\":2},\"bytes\":13}');CREATE TABLE admin_content_items(generation TEXT,key TEXT,value TEXT,revision INTEGER,kind TEXT);INSERT INTO admin_content_items VALUES('current','a','PRIVATE',1,'items'),('current','b','SECOND',2,'items'),('old','a','OLD',1,'items')");
  const db=createD1Adapter(queries=>queries.map(q=>({success:true,results:sql.prepare(q.sql).all(...q.params)})));
  const before=await retainedRowsFingerprint(db,['b','a']);
  assert.deepEqual(await verifyRecordAccounting(db),{countsMatch:true,bytesMatch:true,logicalBytes:13,noTransientClaim:true});
  assert.deepEqual(await retainedRowsFingerprint(db,['a','b']),before);assert.doesNotMatch(JSON.stringify(before),/PRIVATE|SECOND/);
  sql.exec("UPDATE admin_content_items SET revision=3 WHERE generation='current' AND key='a'");
  assert.notDeepEqual(await retainedRowsFingerprint(db,['a','b']),before);
  sql.exec("UPDATE admin_content_items SET revision=1,value='CHANGED' WHERE generation='current' AND key='a'");
  assert.notDeepEqual(await retainedRowsFingerprint(db,['a','b']),before);
  sql.exec("DELETE FROM admin_content_items WHERE generation='current' AND key='a'");
  await assert.rejects(retainedRowsFingerprint(db,['a','b']),/missing/);
  await assert.rejects(verifyRecordAccounting(db),/counts disagree/);
  await assert.rejects(retainedRowsFingerprint(db,['b','b']));
});
test('the retained fixture contains only the 79 original keys without credential or content values',()=>{
  const keys=JSON.parse(fs.readFileSync(new URL('./fixtures/codex-retained-row-keys.json',import.meta.url)));
  assert.equal(keys.length,79);assert.equal(new Set(keys).size,79);assert.ok(keys.every(key=>typeof key==='string'));
});
