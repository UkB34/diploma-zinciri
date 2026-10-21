import {env} from 'cloudflare:workers';
import {initialState,migrateState} from './workflow.mjs';
// New synthetic meeting dataset. Existing private v0.1 workspaces are never exposed.
export const MEETING='meeting-prototype-v2';
export async function readState():Promise<{revision:number,data:any}>{
 let row=await env.DB!.prepare('SELECT revision,payload FROM workspaces WHERE owner=?').bind(MEETING).first<{revision:number,payload:string}>();
 if(!row){const seed=await initialState();await env.DB!.prepare('INSERT OR IGNORE INTO workspaces (owner,revision,payload) VALUES (?,0,?)').bind(MEETING,JSON.stringify(seed)).run();row=await env.DB!.prepare('SELECT revision,payload FROM workspaces WHERE owner=?').bind(MEETING).first<{revision:number,payload:string}>();}
 const data=JSON.parse(row!.payload);
 if(await migrateState(data)){const result=await env.DB!.prepare('UPDATE workspaces SET payload=?, revision=revision+1 WHERE owner=? AND revision=?').bind(JSON.stringify(data),MEETING,row!.revision).run();if(result.meta.changes!==1)return readState();row!.revision++;}
 return {revision:row!.revision,data};
}
