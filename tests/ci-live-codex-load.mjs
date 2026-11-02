import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {githubLoadControl} from './helpers/github-load-control.mjs';

assert.equal(process.env.GITHUB_REF,'refs/heads/codex','Only the codex branch may run cloud acceptance');
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.GITHUB_EVENT_NAME,'workflow_dispatch');
const runs=JSON.parse(await githubLoadControl(['run','list','--repo','lwy9107124035/longnankejia','--workflow','cf-pages.yml','--branch','codex','--limit','20','--json','databaseId,status']));
assert.ok(runs.every(run=>run.status==='completed'||String(run.databaseId)===process.env.GITHUB_RUN_ID),'Another codex workflow is active; do not start overlapping acceptance');
const pending=JSON.parse(fs.readFileSync('docs/maintenance-pending-deletions.json','utf8'));
fs.mkdirSync('.cache/maintenance',{recursive:true});
fs.writeFileSync('.cache/maintenance/notification-state.json',JSON.stringify({pendingDeletionConfirmation:pending.ids}),{flag:'wx'});
const child=spawn(process.execPath,['tests/live-codex-load.mjs','--run'],{stdio:'inherit',windowsHide:true});
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
process.exitCode=code===0?0:1;
