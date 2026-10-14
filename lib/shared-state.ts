import {env} from 'cloudflare:workers';
import {initialState} from './workflow.mjs';
// New synthetic meeting dataset. Existing private v0.1 workspaces are never exposed.
export const MEETING='meeting-prototype-v2';
export async function readState(){
 let row=await env.DB!.prepare('SELECT revision,payload FROM workspaces WHERE owner=?').bind(MEETING).first<{revision:number,payload:string}>();
 if(!row){const seed=await initialState();await env.DB!.prepare('INSERT OR IGNORE INTO workspaces (owner,revision,payload) VALUES (?,0,?)').bind(MEETING,JSON.stringify(seed)).run();row=await env.DB!.prepare('SELECT revision,payload FROM workspaces WHERE owner=?').bind(MEETING).first<{revision:number,payload:string}>();}
 return {revision:row!.revision,data:JSON.parse(row!.payload)};
}
