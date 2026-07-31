import test from "node:test";
import assert from "node:assert/strict";

process.env.DISCORD_BOT_TOKEN||="test-token";
process.env.DISCORD_APP_ID||="test-app";
process.env.DISCORD_GUILD_ID||="guild-1";
process.env.DISCORD_CLUE_WINDOW_MS="20000";
process.env.DISCORD_REACTION_WINDOW_MS="4000";

const {AWAY,MUTED,OPEN,desiredState,openClueWindow,openReactionWindow,closeWindows,voicePlan}=await import("../discord/policy.js");
const rest=await import("../discord/rest.js");
const store=await import("../discord/store.js");
const {syncRoomVoice,releaseRoom}=await import("../discord/voice.js");
const {verifySignature}=rest;

const spymaster={id:"s1",name:"მაკა",role:"spymaster",team:"blue",discordId:"d-s1"};
const enemySpymaster={id:"s2",name:"დათო",role:"spymaster",team:"red",discordId:"d-s2"};
const operative={id:"o1",name:"ნინო",role:"operative",team:"blue",discordId:"d-o1"};
const makeRoom=(mode,game)=>({code:"TEST1",settings:{voiceMode:mode},players:[spymaster,enemySpymaster,operative],game,discord:{guildId:"guild-1",channelId:"voice-main"}});

test("off რეჟიმი არავის ეხება", () => {
  const game={phase:"guess",turn:"blue",voice:{}};
  for(const player of [spymaster,enemySpymaster,operative])
    assert.equal(desiredState(player,{mode:"off",game}),OPEN);
});

test("mute: ორივე ხელმძღვანელი ჩუმდება მსჯელობისას, ოპერატივი არა", () => {
  const game={phase:"guess",turn:"blue",voice:{}};
  assert.equal(desiredState(spymaster,{mode:"mute",game}),MUTED);
  assert.equal(desiredState(enemySpymaster,{mode:"mute",game}),MUTED);
  assert.equal(desiredState(operative,{mode:"mute",game}),OPEN);
});

test("clue ფაზაში ხელმძღვანელი თავისუფალია", () => {
  const game={phase:"clue",turn:"blue",voice:{}};
  assert.equal(desiredState(spymaster,{mode:"mute",game}),OPEN);
  assert.equal(desiredState(spymaster,{mode:"hardcore",game}),OPEN);
});

test("მინიშნების ფანჯარა მხოლოდ მინიშნების ავტორს ეხება და ვადა აქვს", () => {
  const now=1_000_000,game={phase:"guess",turn:"blue",voice:{}};
  openClueWindow(game,spymaster.id,now);
  assert.equal(desiredState(spymaster,{mode:"mute",game,now:now+19_000}),OPEN);
  assert.equal(desiredState(enemySpymaster,{mode:"mute",game,now:now+19_000}),MUTED);
  assert.equal(desiredState(spymaster,{mode:"mute",game,now:now+21_000}),MUTED);
  // ჰარდქორშიც შეუძლია მინიშნება ხმით თქვას
  assert.equal(desiredState(spymaster,{mode:"hardcore",game,now:now+19_000}),OPEN);
  assert.equal(desiredState(spymaster,{mode:"hardcore",game,now:now+21_000}),AWAY);
});

test("რეაქციის ფანჯარა მხოლოდ mute რეჟიმშია და ორივე ხელმძღვანელს ეხება", () => {
  const now=2_000_000,game={phase:"guess",turn:"blue",voice:{}};
  openReactionWindow(game,now);
  assert.equal(desiredState(spymaster,{mode:"mute",game,now:now+3_000}),OPEN);
  assert.equal(desiredState(enemySpymaster,{mode:"mute",game,now:now+3_000}),OPEN);
  assert.equal(desiredState(spymaster,{mode:"mute",game,now:now+5_000}),MUTED);
  assert.equal(desiredState(spymaster,{mode:"hardcore",game,now:now+3_000}),AWAY);
});

test("თამაშის დასრულებისას ყველა თავისუფლდება", () => {
  const game={phase:"guess",turn:"blue",winner:"red",voice:{}};
  assert.equal(desiredState(spymaster,{mode:"mute",game}),OPEN);
  assert.equal(desiredState(spymaster,{mode:"hardcore",game}),OPEN);
});

test("გათიშულ ხელმძღვანელს ხმა უბრუნდება", () => {
  const game={phase:"guess",turn:"blue",voice:{}};
  assert.equal(desiredState({...spymaster,connected:false},{mode:"mute",game}),OPEN);
  assert.equal(desiredState({...spymaster,connected:false},{mode:"hardcore",game}),OPEN);
  assert.equal(desiredState({...spymaster,connected:true},{mode:"mute",game}),MUTED);
});

test("closeWindows ფანჯრებს ხურავს", () => {
  const now=3_000_000,game={phase:"guess",turn:"blue",voice:{}};
  openClueWindow(game,spymaster.id,now);closeWindows(game);
  assert.equal(desiredState(spymaster,{mode:"mute",game,now:now+1_000}),MUTED);
});

test("voicePlan მხოლოდ Discord-ით დაკავშირებულებს იღებს", () => {
  const room=makeRoom("mute",{phase:"guess",turn:"blue",voice:{}});
  room.players=[...room.players,{id:"o2",name:"უცნობი",role:"operative",team:"red"}];
  const plan=voicePlan(room,Date.now());
  assert.equal(plan.length,3);
  assert.deepEqual(plan.map(entry=>entry.state).sort(),[MUTED,MUTED,OPEN]);
});

// --- Discord REST-ის მოთხოვნების შემოწმება (ნამდვილი ქსელის გარეშე) ---------
function mockDiscord(){
  const calls=[];
  rest.injectFetch(async(url,init)=>{
    calls.push({url:String(url),method:init.method,body:init.body?JSON.parse(init.body):null});
    return {ok:true,status:200,json:async()=>({id:"created-channel"}),text:async()=>""}
  });
  store.injectFetch(async()=>({ok:true,status:204,json:async()=>null,text:async()=>""}));
  store.resetMemory();
  return calls
}
const patches=calls=>calls.filter(call=>call.method==="PATCH").map(call=>({user:call.url.split("/").pop(),...call.body}));

test("mute რეჟიმი: სინქრონიზაცია მხოლოდ ცვლილებისას აგზავნის მოთხოვნას", async () => {
  const calls=mockDiscord();
  const room=makeRoom("mute",{phase:"guess",turn:"blue",voice:{}});
  await syncRoomVoice(room,Date.now());
  assert.deepEqual(patches(calls),[{user:"d-s1",mute:true},{user:"d-s2",mute:true}],"ოპერატივს ხელს არ ვახლებთ");
  calls.length=0;
  await syncRoomVoice(room,Date.now());
  assert.equal(calls.length,0,"მდგომარეობა არ შეცვლილა — ახალი მოთხოვნა არ უნდა წავიდეს");
  room.game.phase="clue";
  await syncRoomVoice(room,Date.now());
  assert.deepEqual(patches(calls),[{user:"d-s1",mute:false},{user:"d-s2",mute:false}]);
});

test("hardcore რეჟიმი: ხელმძღვანელი გადადის ცალკე არხში და ბრუნდება უკან", async () => {
  const calls=mockDiscord();
  const room=makeRoom("hardcore",{phase:"guess",turn:"blue",voice:{}});
  await syncRoomVoice(room,Date.now());
  const created=calls.find(call=>call.method==="POST"&&call.url.endsWith("/channels"));
  assert.ok(created,"დროებითი ხმოვანი არხი უნდა შეიქმნას");
  assert.equal(created.body.type,2);
  const moved=patches(calls).filter(patch=>patch.user.startsWith("d-s"));
  assert.deepEqual(moved,[{user:"d-s1",mute:false,channel_id:"created-channel"},{user:"d-s2",mute:false,channel_id:"created-channel"}]);
  calls.length=0;
  room.game.phase="clue";
  await syncRoomVoice(room,Date.now());
  assert.deepEqual(patches(calls),[{user:"d-s1",mute:false,channel_id:"voice-main"},{user:"d-s2",mute:false,channel_id:"voice-main"}]);
});

test("releaseRoom ყველას ათავისუფლებს და დროებით არხს შლის", async () => {
  const calls=mockDiscord();
  const room=makeRoom("hardcore",{phase:"guess",turn:"blue",voice:{}});
  await syncRoomVoice(room,Date.now());
  calls.length=0;
  await releaseRoom(room);
  assert.deepEqual(patches(calls).filter(patch=>patch.user.startsWith("d-s")),[
    {user:"d-s1",mute:false,channel_id:"voice-main"},
    {user:"d-s2",mute:false,channel_id:"voice-main"}
  ]);
  assert.ok(calls.some(call=>call.method==="DELETE"&&call.url.includes("created-channel")),"დროებითი არხი უნდა წაიშალოს");
});

test("უფლების შეცდომაზე მოთამაშე ერთხელ ცდება და აღარ ვიმეორებთ", async () => {
  const calls=[];
  rest.injectFetch(async(url,init)=>{
    calls.push({url:String(url),method:init.method});
    return {ok:false,status:403,json:async()=>null,text:async()=>"Missing Permissions"}
  });
  store.injectFetch(async()=>({ok:true,status:204,json:async()=>null,text:async()=>""}));
  store.resetMemory();
  const room=makeRoom("mute",{phase:"guess",turn:"blue",voice:{}});
  await syncRoomVoice(room,Date.now());
  const first=calls.length;
  assert.equal(first,2,"მხოლოდ ორი ხელმძღვანელი ცდილობს დამუტებას");
  await syncRoomVoice(room,Date.now());
  assert.equal(calls.length,first,"წარუმატებელი მოთამაშეები აღარ მეორდება");
});

test("ხელმოწერის შემოწმება ყალბ ხელმოწერას ჭრის", () => {
  assert.equal(verifySignature(Buffer.from("{}"),"deadbeef","123"),false);
  assert.equal(verifySignature(Buffer.from("{}"),"","123"),false);
});

test("store: ბმულის token ერთჯერადია", async () => {
  store.resetMemory();
  const token=store.linkToken();
  await store.saveLink({token,discordId:"d-1",guildId:"g-1",roomCode:"ABCDE"});
  assert.deepEqual(await store.takeLink(token),{discordId:"d-1",guildId:"g-1",roomCode:"ABCDE"});
  assert.equal(await store.takeLink(token),null,"მეორედ იგივე token აღარ უნდა მუშაობდეს");
});

// --- სერვერის ავტომატური აღმოჩენა ------------------------------------------
const {resolveGuild,resetGuildCache}=await import("../discord/voice.js");
const {config:discordConfig}=await import("../discord/config.js");
// ავტომატური აღმოჩენა მაშინ მუშაობს, როცა .env-ში სერვერი მითითებული არ არის
const withoutConfiguredGuild=async run=>{const saved=discordConfig.guildId;discordConfig.guildId="";try{return await run()}finally{discordConfig.guildId=saved}};
const bareRoom=()=>({code:"AUTO1",settings:{voiceMode:"mute"},players:[{id:"s1",name:"მაკა",role:"spymaster",team:"blue",discordId:"d-s1",connected:true}]});

test("ოთახზე მიბმული სერვერი პრიორიტეტულია", async () => {
  const room={...bareRoom(),discord:{guildId:"bound-guild"}};
  assert.equal(await resolveGuild(room),"bound-guild");
});

test("თუ ბოტი ერთ სერვერზეა, ის ავტომატურად შეირჩევა", async () => {
  resetGuildCache();
  rest.injectFetch(async url=>{
    assert.ok(String(url).endsWith("/users/@me/guilds"));
    return {ok:true,status:200,json:async()=>[{id:"only-guild",name:"LOL"}],text:async()=>""}
  });
  await withoutConfiguredGuild(async()=>{
    const room=bareRoom();
    assert.equal(await resolveGuild(room),"only-guild");
    assert.equal(room.discord.guildId,"only-guild","ოთახს ემახსოვრება, რომ ხელახლა არ ვეძებოთ")
  });
});

test("რამდენიმე სერვერზე — ვირჩევთ იმას, სადაც მოთამაშე ხმოვან არხშია", async () => {
  resetGuildCache();
  rest.injectFetch(async url=>{
    const target=String(url);
    if(target.endsWith("/users/@me/guilds"))return {ok:true,status:200,json:async()=>[{id:"guild-a"},{id:"guild-b"}],text:async()=>""};
    if(target.includes("/guilds/guild-a/voice-states/"))return {ok:false,status:404,json:async()=>null,text:async()=>""};
    if(target.includes("/guilds/guild-b/voice-states/"))return {ok:true,status:200,json:async()=>({channel_id:"voice-b"}),text:async()=>""};
    return {ok:true,status:200,json:async()=>({}),text:async()=>""}
  });
  await withoutConfiguredGuild(async()=>{
    const room=bareRoom();
    assert.equal(await resolveGuild(room),"guild-b");
    assert.equal(room.discord.channelId,"voice-b","მოთამაშის არხიც ემახსოვრება")
  });
});

test("ხმოვან არხში არმყოფს ცოტა ხანში ისევ ვცდით", async () => {
  resetGuildCache();
  let attempts=0;
  rest.injectFetch(async(url,init)=>{
    if(String(url).endsWith("/users/@me/guilds"))return {ok:true,status:200,json:async()=>[{id:"g1"}],text:async()=>""};
    if(init.method==="PATCH"){attempts++;return {ok:false,status:400,json:async()=>null,text:async()=>"Target user is not connected to voice"}}
    return {ok:true,status:200,json:async()=>({}),text:async()=>""}
  });
  store.injectFetch(async()=>({ok:true,status:204,json:async()=>null,text:async()=>""}));
  const room={...bareRoom(),discord:{guildId:"g1"},game:{phase:"guess",turn:"blue",voice:{}}};
  await syncRoomVoice(room,Date.now());
  assert.equal(attempts,1);
  await syncRoomVoice(room,Date.now()+1000);
  assert.equal(attempts,1,"1 წამში თავიდან არ ვცდით");
  await syncRoomVoice(room,Date.now()+9000);
  assert.equal(attempts,1,"ცდის დრო რეალურ საათზეა მიბმული, არა now-არგუმენტზე");
  room.voice.unavailable.set("d-s1",Date.now()-1);// ვადა გავიდა
  await syncRoomVoice(room,Date.now());
  assert.equal(attempts,2,"ვადის შემდეგ ისევ ვცდილობთ");
});
