import {spawnSync} from 'node:child_process';
const value=process.env.TEST_ACCOUNTS_JSON;
const accounts=JSON.parse(value||'null');
if(!Array.isArray(accounts)||accounts.length!==5||accounts.some(a=>!a.username||!a.role||!a.salt||!/^[a-f0-9]{64}$/.test(a.hash)))throw new Error('Set TEST_ACCOUNTS_JSON repository secret using the generated account hashes.');
const result=spawnSync('pnpm',['exec','wrangler','secret','put','TEST_ACCOUNTS_JSON','--config','dist/server/wrangler.json'],{input:value+'\n',stdio:['pipe','inherit','inherit'],env:process.env});
if(result.error)throw result.error;
process.exit(result.status??1);
