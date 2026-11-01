import {spawnSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';

export async function githubLoadControl(args,{execute=spawnSync,delay=sleep}={}) {
  const readOnly=args[0]==='run'&&['view','list','download'].includes(args[1]);
  const timeout=args[0]==='run'&&args[1]==='view'?10000:30000;
  for(let attempt=0;;attempt++) {
    const response=execute('gh',args,{encoding:'utf8',windowsHide:true,timeout,maxBuffer:10*1024*1024});
    if(response.status===0)return response.stdout;
    const transient=response.error?.code==='ETIMEDOUT'||/connection|timed?\s*out|timeout|tls|eof|lookup|network|\b50[234]\b/i.test(response.stderr||'');
    if(!readOnly||!transient||attempt>=1)throw Error('GitHub control request failed: '+args[0]+'/'+args[1]);
    await delay(1000);
  }
}
