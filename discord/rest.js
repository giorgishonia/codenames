import crypto from "node:crypto";
import {config,discordEnabled} from "./config.js";

const API="https://discord.com/api/v10";
// ტესტებში fetch იცვლება injectFetch-ით, რომ ნამდვილი მოთხოვნები არ წავიდეს.
let doFetch=(...args)=>globalThis.fetch(...args);
export function injectFetch(fn){doFetch=fn}

export class DiscordError extends Error{
  constructor(status,body,route){super(`Discord ${status} ${route}: ${body}`);this.status=status;this.body=body;this.route=route}
}

export async function request(method,route,body){
  if(!discordEnabled())return null;
  const response=await doFetch(`${API}${route}`,{
    method,
    headers:{authorization:`Bot ${config.token}`,"content-type":"application/json","user-agent":"SaidumloSitqva (https://github.com/, 1.0)"},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  if(response.status===429){
    const retry=Number(response.headers?.get?.("retry-after"))||1;
    await new Promise(resolve=>setTimeout(resolve,Math.min(5,retry)*1000));
    return request(method,route,body)
  }
  if(!response.ok)throw new DiscordError(response.status,await response.text().catch(()=>""),route);
  if(response.status===204)return null;
  return response.json().catch(()=>null)
}

export const setMute=(guildId,userId,mute)=>request("PATCH",`/guilds/${guildId}/members/${userId}`,{mute});
export const moveMember=(guildId,userId,channelId)=>request("PATCH",`/guilds/${guildId}/members/${userId}`,{channel_id:channelId});
export const setMuteAndMove=(guildId,userId,{mute,channelId})=>request("PATCH",`/guilds/${guildId}/members/${userId}`,channelId===undefined?{mute}:{mute,channel_id:channelId});
export const voiceState=(guildId,userId)=>request("GET",`/guilds/${guildId}/voice-states/${userId}`).catch(error=>{if(error.status===404)return null;throw error});
export const channel=channelId=>request("GET",`/channels/${channelId}`);
export const createVoiceChannel=(guildId,{name,parentId,userLimit})=>request("POST",`/guilds/${guildId}/channels`,{name,type:2,parent_id:parentId||null,user_limit:userLimit||0});
export const deleteChannel=channelId=>request("DELETE",`/channels/${channelId}`);
export const postMessage=(channelId,payload)=>request("POST",`/channels/${channelId}/messages`,payload);
export const registerGuildCommands=(appId,guildId,commands)=>request("PUT",`/applications/${appId}/guilds/${guildId}/commands`,commands);
export const registerGlobalCommands=(appId,commands)=>request("PUT",`/applications/${appId}/commands`,commands);

// Ed25519 ხელმოწერის შემოწმება — Discord ამას ყოველ interaction-ზე ითხოვს.
const SPKI_PREFIX=Buffer.from("302a300506032b6570032100","hex");
export function verifySignature(rawBody,signature,timestamp){
  if(!config.publicKey||!signature||!timestamp)return false;
  try{
    const key=crypto.createPublicKey({key:Buffer.concat([SPKI_PREFIX,Buffer.from(config.publicKey,"hex")]),format:"der",type:"spki"});
    const message=Buffer.concat([Buffer.from(String(timestamp)),Buffer.isBuffer(rawBody)?rawBody:Buffer.from(rawBody)]);
    return crypto.verify(null,message,key,Buffer.from(signature,"hex"))
  }catch{return false}
}
