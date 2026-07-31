import crypto from "node:crypto";
import {config,supabaseEnabled} from "./config.js";

// Supabase-ის PostgREST-თან პირდაპირი მუშაობა — დამატებითი დამოკიდებულება არ სჭირდება.
// თუ გასაღებები არ არის, ყველაფერი მეხსიერებაში ინახება (ლოკალური განვითარება/ტესტები).
const memory={links:new Map(),voice:new Map()};
const voiceKey=(guildId,discordId)=>`${guildId}:${discordId}`;
let doFetch=(...args)=>globalThis.fetch(...args);
export function injectFetch(fn){doFetch=fn}
export function resetMemory(){memory.links.clear();memory.voice.clear()}

async function rest(method,path,{body,headers}={}){
  const response=await doFetch(`${config.supabaseUrl}/rest/v1/${path}`,{
    method,
    headers:{apikey:config.supabaseKey,authorization:`Bearer ${config.supabaseKey}`,"content-type":"application/json",...headers},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  if(!response.ok)throw new Error(`Supabase ${response.status} ${path}: ${await response.text().catch(()=>"")}`);
  return response.status===204?null:response.json().catch(()=>null)
}

export const linkToken=()=>crypto.randomBytes(24).toString("base64url");

export async function saveLink(link){
  const row={token:link.token,discord_id:link.discordId,guild_id:link.guildId,room_code:link.roomCode,player_id:link.playerId||null,created_at:new Date().toISOString()};
  if(!supabaseEnabled()){memory.links.set(row.token,row);return row}
  await rest("POST","discord_links",{body:row,headers:{prefer:"resolution=merge-duplicates,return=minimal"}});
  return row
}

export async function takeLink(token){
  if(!token)return null;
  if(!supabaseEnabled()){
    const row=memory.links.get(token);if(!row)return null;memory.links.delete(token);
    return {discordId:row.discord_id,guildId:row.guild_id,roomCode:row.room_code}
  }
  const rows=await rest("GET",`discord_links?token=eq.${encodeURIComponent(token)}&select=*&limit=1`);
  const row=rows?.[0];if(!row)return null;
  await rest("DELETE",`discord_links?token=eq.${encodeURIComponent(token)}`,{headers:{prefer:"return=minimal"}}).catch(()=>{});
  return {discordId:row.discord_id,guildId:row.guild_id,roomCode:row.room_code}
}

// რომელ მოთამაშეს რა შევუცვალეთ — რომ ავარიის შემდეგაც შევძლოთ დაბრუნება.
export async function rememberVoice(entry){
  const row={discord_id:entry.discordId,guild_id:entry.guildId,room_code:entry.roomCode||null,muted:!!entry.muted,home_channel_id:entry.homeChannelId||null,updated_at:new Date().toISOString()};
  if(!supabaseEnabled()){memory.voice.set(voiceKey(row.guild_id,row.discord_id),row);return row}
  await rest("POST","discord_voice_state",{body:row,headers:{prefer:"resolution=merge-duplicates,return=minimal"}});
  return row
}

export async function forgetVoice(guildId,discordId){
  if(!supabaseEnabled()){memory.voice.delete(voiceKey(guildId,discordId));return}
  await rest("DELETE",`discord_voice_state?guild_id=eq.${encodeURIComponent(guildId)}&discord_id=eq.${encodeURIComponent(discordId)}`,{headers:{prefer:"return=minimal"}})
}

export async function pendingVoice(){
  if(!supabaseEnabled())return [...memory.voice.values()].map(fromVoiceRow);
  const rows=await rest("GET","discord_voice_state?select=*");
  return (rows||[]).map(fromVoiceRow)
}
const fromVoiceRow=row=>({discordId:row.discord_id,guildId:row.guild_id,roomCode:row.room_code,muted:!!row.muted,homeChannelId:row.home_channel_id});
