import {config,discordEnabled,voiceMode} from "./config.js";
import * as rest from "./rest.js";
import * as store from "./store.js";
import {AWAY,MUTED,OPEN,nextWindowExpiry,voicePlan} from "./policy.js";

const log=(...args)=>console.log("[discord]",...args);
const warn=(...args)=>console.warn("[discord]",...args);
const RETRY_MS=8000;// ხმოვან არხში არმყოფს ამდენ ხანში ერთხელ ვცდით ხელახლა

function voiceState(room){
  room.voice||={applied:new Map(),unavailable:new Map(),queue:Promise.resolve()};
  return room.voice
}
export function linkedPlayers(room){return (room.players||[]).filter(p=>p.discordId&&p.connected!==false)}

// ბოტის სერვერების სია — ერთხელ ვიღებთ და ვქეშავთ.
let guildCache=null;
export function resetGuildCache(){guildCache=null}
async function botGuildIds(){
  if(guildCache)return guildCache;
  const guilds=await rest.request("GET","/users/@me/guilds").catch(error=>{warn(`სერვერების სია ვერ წავიკითხე: ${error.message}`);return null});
  guildCache=(guilds||[]).map(guild=>guild.id);
  if(guildCache.length)log(`ბოტი ${guildCache.length} სერვერზეა`);
  return guildCache
}

// რომელ სერვერზე ვმართოთ ხმა: ოთახის მიბმული → .env → ბოტის ერთადერთი →
// ის, სადაც მოთამაშე ნამდვილად ზის ხმოვან არხში.
export async function resolveGuild(room){
  if(room.discord?.guildId)return room.discord.guildId;
  if(config.guildId){room.discord={...room.discord,guildId:config.guildId};return config.guildId}
  const ids=await botGuildIds();
  if(!ids.length)return null;
  if(ids.length===1){
    room.discord={...room.discord,guildId:ids[0]};
    log(`ოთახი ${room.code}: სერვერი ავტომატურად შეირჩა (${ids[0]})`);
    return ids[0]
  }
  for(const guildId of ids)for(const player of linkedPlayers(room)){
    const state=await rest.voiceState(guildId,player.discordId).catch(()=>null);
    if(state?.channel_id){
      room.discord={...room.discord,guildId,channelId:room.discord?.channelId||state.channel_id};
      log(`ოთახი ${room.code}: სერვერი ${guildId} (${player.name} ხმოვან არხშია)`);
      return guildId
    }
  }
  return null
}

// hardcore რეჟიმისთვის საჭირო ცალკე ხმოვანი არხი: ან წინასწარ მითითებული, ან დროებით შექმნილი.
async function spymasterChannel(room,guildId){
  if(config.spymasterChannelId)return config.spymasterChannelId;
  if(room.discord?.spymasterChannelId)return room.discord.spymasterChannelId;
  if(!guildId)return null;
  let parentId=null;
  if(room.discord?.channelId){
    const parent=await rest.channel(room.discord.channelId).catch(()=>null);
    parentId=parent?.parent_id||null
  }
  const created=await rest.createVoiceChannel(guildId,{name:`🕵️ ხელმძღვანელები · ${room.code}`,parentId});
  if(!created?.id)return null;
  room.discord={...room.discord,spymasterChannelId:created.id,spymasterChannelTemporary:true};
  log(`ოთახი ${room.code}: შეიქმნა ხელმძღვანელების არხი ${created.id}`);
  return created.id
}

async function applyOne(room,entry,guildId){
  const state=voiceState(room);
  const previous=state.applied.get(entry.playerId);
  if(previous?.state===entry.state)return false;
  // პირველად ნანახ მოთამაშეს ხელს არ ვახლებთ — ვინც ჩვენ არ დაგვიმუტავს, ჩვენ არ გავათავისუფლებთ.
  if(!previous&&entry.state===OPEN){state.applied.set(entry.playerId,{state:OPEN,discordId:entry.discordId});return false}
  let home=previous?.home||null,payload;
  if(entry.state===MUTED)payload={mute:true};
  else if(entry.state===AWAY){
    if(!home){
      const current=await rest.voiceState(guildId,entry.discordId).catch(()=>null);
      home=current?.channel_id||room.discord?.channelId||null
    }
    const away=await spymasterChannel(room,guildId);
    if(!away){
      warn(`ოთახი ${room.code}: ხელმძღვანელების არხი ვერ შეიქმნა — გადავდივართ mute-ზე`);
      room.settings.voiceMode="mute";payload={mute:true}
    }else payload={mute:false,channelId:away}
  }
  else payload=previous?.state===AWAY&&home?{mute:false,channelId:home}:{mute:false};
  await rest.setMuteAndMove(guildId,entry.discordId,payload);
  state.applied.set(entry.playerId,{state:entry.state,discordId:entry.discordId,home});
  if(entry.state===OPEN)await store.forgetVoice(guildId,entry.discordId).catch(()=>{});
  else await store.rememberVoice({discordId:entry.discordId,guildId,roomCode:room.code,muted:entry.state===MUTED,homeChannelId:home}).catch(()=>{});
  return true
}

// ერთი ოთახის სინქრონიზაცია. გამოძახებები რიგში დგება, რომ ერთმანეთს არ გადაეფაროს.
export function syncRoomVoice(room,now=Date.now()){
  if(!discordEnabled()||!room)return Promise.resolve();
  const state=voiceState(room);
  if(voiceMode(room.settings?.voiceMode)==="off"&&!state.applied.size)return Promise.resolve();
  state.queue=state.queue.then(async()=>{
    const plan=voicePlan(room,now);
    if(!plan.length){
      // ხშირი შემთხვევა: ბოტი სერვერზეა, მაგრამ მოთამაშეს Discord ანგარიში მიბმული არ აქვს.
      if(!state.warnedLink){state.warnedLink=true;warn(`ოთახი ${room.code}: ვერცერთ მოთამაშეს Discord არ აქვს მიბმული — საიტზე „Discord-ით შესვლა“ ან Discord-ში /saidumlo join`)}
      return
    }
    state.warnedLink=false;
    const guildId=await resolveGuild(room);
    if(!guildId){
      if(!state.warnedGuild){state.warnedGuild=true;warn(`ოთახი ${room.code}: სერვერი ვერ დავადგინე — ბოტი დამატებულია? (DISCORD_GUILD_ID არასავალდებულოა)`)}
      return
    }
    for(const entry of plan){
      const retryAt=state.unavailable.get(entry.discordId);
      if(retryAt&&retryAt>Date.now()&&entry.state!==OPEN)continue;
      try{
        if(await applyOne(room,entry,guildId)){
          if(state.unavailable.delete(entry.discordId))log(`ოთახი ${room.code}: ${entry.name} — კონტროლი აღდგა`)
        }
      }catch(error){
        // ხმოვან არხში არ არის / უფლება არ გვაქვს — ცოტა ხანში ისევ ვცდით.
        if([400,403,404].includes(error.status)){
          const first=!state.unavailable.has(entry.discordId);
          state.unavailable.set(entry.discordId,Date.now()+RETRY_MS);
          state.applied.delete(entry.playerId);
          // 403 თითქმის ყოველთვის ორია: სერვერის მფლობელი (Discord-ის მკაცრი წესი — ვერავინ დაამუტებს) ან ბოტის როლი დაბლაა.
          if(first)warn(`ოთახი ${room.code}: ${entry.name} — ${error.status===400?"ხმოვან არხში არ არის":error.status===403?"უფლება არ მაქვს — თუ ის სერვერის მფლობელია, Discord ბოტს არ ანებებს; სხვა შემთხვევაში შეამოწმე Mute Members და ბოტის როლის პოზიცია":"ვერ ვიპოვე სერვერზე"}; ვცდი ყოველ ${RETRY_MS/1000} წამში`)
        }else warn(`ოთახი ${room.code}: ${entry.name} — ${error.message}`)
      }
    }
  }).catch(error=>warn(error.message));
  return state.queue
}

// თამაშის დასრულება/ოთახის დახურვა — ყველას ვუბრუნებთ ხმას და ვასუფთავებთ დროებით არხს.
export function releaseRoom(room,{deleteChannel=true}={}){
  if(!discordEnabled()||!room)return Promise.resolve();
  const state=voiceState(room),guildId=room.discord?.guildId||config.guildId;
  if(!guildId)return Promise.resolve();
  state.queue=state.queue.then(async()=>{
    for(const [playerId,applied] of state.applied){
      if(applied.state===OPEN){state.applied.delete(playerId);continue}
      try{
        await rest.setMuteAndMove(guildId,applied.discordId,applied.state===AWAY&&applied.home?{mute:false,channelId:applied.home}:{mute:false});
        await store.forgetVoice(guildId,applied.discordId).catch(()=>{})
      }catch(error){warn(`გათავისუფლება ვერ მოხერხდა (${applied.discordId}): ${error.message}`)}
      state.applied.delete(playerId)
    }
    state.unavailable.clear();
    if(deleteChannel&&room.discord?.spymasterChannelTemporary&&room.discord.spymasterChannelId){
      await rest.deleteChannel(room.discord.spymasterChannelId).catch(()=>{});
      room.discord={...room.discord,spymasterChannelId:null,spymasterChannelTemporary:false}
    }
  }).catch(error=>warn(error.message));
  return state.queue
}

// გაშვებისას ვასწორებთ იმას, რაც წინა პროცესმა დატოვა (ავარიის შემდეგ).
export async function restoreAfterRestart(){
  if(!discordEnabled())return 0;
  const rows=await store.pendingVoice().catch(()=>[]);
  let restored=0;
  for(const row of rows){
    try{
      await rest.setMuteAndMove(row.guildId,row.discordId,row.homeChannelId?{mute:false,channelId:row.homeChannelId}:{mute:false});
      await store.forgetVoice(row.guildId,row.discordId);restored++
    }catch(error){warn(`restore ${row.discordId}: ${error.message}`)}
  }
  if(restored)log(`გაშვებისას ${restored} მოთამაშეს დაუბრუნდა ხმა`);
  return restored
}

// ტიკერი: ვადაგასული ფანჯრები + ხელახალი ცდები მათზე, ვინც მაშინ ხმოვან არხში არ იყო.
export function tickRoomVoice(room,now=Date.now()){
  const expiry=nextWindowExpiry(room.game);
  const expired=expiry&&now>=expiry;
  if(expired){
    const voice=room.game.voice||{};
    room.game.voice={...voice,...(now>=(voice.clueUntil||0)?{clueUntil:0,cluePlayerId:null}:{}),...(now>=(voice.reactUntil||0)?{reactUntil:0}:{})}
  }
  const pending=[...(room.voice?.unavailable?.values()||[])].some(retryAt=>retryAt<=now);
  return expired||pending?syncRoomVoice(room,now):null
}

// დიაგნოსტიკა /api/discord/health-ისთვის.
export function voiceDiagnostics(room){
  const state=room.voice;
  return{
    code:room.code,guild:room.discord?.guildId||null,mode:voiceMode(room.settings?.voiceMode),
    linked:linkedPlayers(room).map(p=>p.name),
    applied:[...(state?.applied?.entries()||[])].map(([playerId,item])=>({playerId,state:item.state})),
    unavailable:[...(state?.unavailable?.keys()||[])]
  }
}
