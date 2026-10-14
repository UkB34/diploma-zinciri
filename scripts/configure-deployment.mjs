import {readFileSync,writeFileSync} from 'node:fs';
const id=process.env.DATABASE_ID;
if(!/^[0-9a-f-]{36}$/i.test(id||'')||!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID)throw new Error('Cloudflare account, API token and database ID must be configured first. See README.');
const config=JSON.parse(readFileSync('wrangler.json','utf8'));
config.d1_databases[0].database_id=id;
writeFileSync('wrangler.json',JSON.stringify(config,null,2)+'\n');
