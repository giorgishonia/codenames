// სრული ინტეგრაცია: ნამდვილი სერვერი + ნამდვილი socket.io კლიენტები,
// მხოლოდ Discord-ის HTTP ფენაა შენაცვლებული, რომ ვნახოთ რა მოთხოვნები იგზავნება.
import test from "node:test";
import assert from "node:assert/strict";
import {io} from "socket.io-client";

process.env.PORT="3987";
process.env.DISCORD_BOT_TOKEN="test-token";
process.env.DISCORD_APP_ID="test-app";
process.env.DISCORD_GUILD_ID="guild-1";
process.env.DISCORD_CLUE_WINDOW_MS="200";
process.env.DISCORD_REACTION_WINDOW_MS="200";
process.env.SUPABASE_URL="https://example.supabase.co";
process.env.SUPABASE_ANON_KEY="anon-key";

const rest=await import("../discord/rest.js");
const store=await import("../discord/store.js");
const auth=await import("../discord/auth.js");
// Supabase Auth-ს ვანაცვლებთ: ერთი ვალიდური token, დანარჩენი უარყოფილი.
auth.injectFetch(async(url,init)=>{
  const token=String(init.headers.authorization||"").replace("Bearer ","");
  if(token!=="good-token")return {ok:false,status:401,json:async()=>({})};
  return {ok:true,status:200,json:async()=>({
    id:"user-uuid-1",
    user_metadata:{provider_id:"555000111",full_name:"ლოგინი",avatar_url:"https://cdn.discordapp.com/avatars/555000111/hash.png"},
    identities:[{provider:"discord",id:"555000111",identity_data:{}}]
  })}
});
const calls=[];
rest.injectFetch(async(url,init)=>{
  calls.push({url:String(url),method:init.method,body:init.body?JSON.parse(init.body):null});
  return {ok:true,status:200,json:async()=>({id:"spy-channel"}),text:async()=>""}
});
const {server,io:serverIo,rooms}=await import("../server.js");
test.after(()=>{
  // გათიშული მოთამაშეების 5-წუთიანი ტაიმერები რომ არ აკავებდეს პროცესს
  for(const room of rooms.values())for(const player of room.players)clearTimeout(player.removeTimer);
  serverIo.close();server.close()
});

const URL="http://localhost:3987";
const wait=(socket,event,predicate=()=>true)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.off(event,on);reject(new Error(`timeout ${event}`))},4000);
  const on=data=>{if(predicate(data)){clearTimeout(timer);socket.off(event,on);resolve(data)}};
  socket.on(event,on)
});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const settle=()=>sleep(80);
// ტიკერი წამში ერთხელ ამოწმებს ვადაგასულ ფანჯრებს
const afterTick=()=>sleep(1300);
const patches=()=>calls.filter(call=>call.method==="PATCH"&&call.url.includes("/members/")).map(call=>({user:call.url.split("/").pop(),...call.body}));

// მასპინძელი (sockets[0]) ოთახს ქმნის, ამიტომ Discord ბმულს ვერ იღებს — ის ოპერატივია.
// ორივე ხელმძღვანელი დაკავშირებულია, რომ ყველა შემოწმება მათზე გავიდეს.
const SEATS=[["blue","operative",null],["blue","spymaster","d-blue-spy"],["red","spymaster","d-red-spy"],["red","operative","d-red-op"]];
async function seat(mode){
  calls.length=0;store.resetMemory();
  const sockets=SEATS.map(()=>io(URL,{transports:["websocket"],forceNew:true}));
  await Promise.all(sockets.map(socket=>wait(socket,"connect")));
  const state=new Map();
  sockets.forEach(socket=>socket.on("room-state",room=>state.set(socket,room)));
  sockets[0].emit("create-room",{name:"მასპინძელი",roomName:"ხმოვანი ტესტი"});
  const created=await wait(sockets[0],"room-joined");
  const code=created.room.code;
  state.set(sockets[0],created.room);
  for(let i=1;i<sockets.length;i++){
    const token=store.linkToken();
    await store.saveLink({token,discordId:SEATS[i][2],guildId:"guild-1",roomCode:code});
    sockets[i].emit("join-room",{name:`მოთამაშე${i}`,code,discordToken:token});
    state.set(sockets[i],(await wait(sockets[i],"room-joined")).room)
  }
  sockets.forEach((socket,index)=>socket.emit("choose-role",{team:SEATS[index][0],role:SEATS[index][1]}));
  await wait(sockets[0],"room-state",room=>room.canStart);
  sockets[0].emit("update-room-settings",{name:"ხმოვანი ტესტი",isPublic:true,settings:{clueTime:90,guessTime:120,roundTime:240,voiceMode:mode}});
  await wait(sockets[0],"room-state",room=>room.settings.voiceMode===mode);
  // ოთახს ხმოვან არხზე ვაბამთ, როგორც /saidumlo start აკეთებს
  const room=state.get(sockets[0]);
  assert.equal(room.players.filter(player=>player.discord).length,3,"სამი მოთამაშე Discord-ით უნდა იყოს მიბმული");
  sockets[0].emit("start-game");
  await Promise.all(sockets.map(socket=>wait(socket,"room-state",room=>!!room.game)));
  await settle();
  const game=state.get(sockets[0]).game;
  const turn=game.turn;
  const spy=turn==="blue"?sockets[1]:sockets[2];
  const enemySpyId=turn==="blue"?"d-red-spy":"d-blue-spy";
  const spyId=turn==="blue"?"d-blue-spy":"d-red-spy";
  const op=turn==="blue"?sockets[0]:sockets[3];
  return {sockets,state,spy,op,spyId,enemySpyId}
}
const close=sockets=>sockets.forEach(socket=>socket.disconnect());

test("mute: მინიშნების ფანჯარაში ავტორი თავისუფალია, მეტოქის ხელმძღვანელი — არა", async () => {
  const {sockets,spy,op,spyId,enemySpyId}=await seat("mute");
  calls.length=0;
  spy.emit("give-clue",{word:"ტესტი",count:2});
  await wait(op,"room-state",room=>room.game.phase==="guess");
  await settle();
  assert.deepEqual(patches(),[{user:enemySpyId,mute:true}],"მხოლოდ მეტოქის ხელმძღვანელი იმუტება");
  calls.length=0;
  await afterTick();
  assert.deepEqual(patches(),[{user:spyId,mute:true}],"ფანჯრის ვადის შემდეგ ავტორიც იმუტება");
  close(sockets)
});

test("mute: ბარათის გახსნა ხსნის რეაქციის ფანჯარას ორივე ხელმძღვანელისთვის", async () => {
  const {sockets,state,spy,op,spyId,enemySpyId}=await seat("mute");
  spy.emit("give-clue",{word:"ტესტი",count:2});
  await wait(op,"room-state",room=>room.game.phase==="guess");
  await afterTick();
  calls.length=0;
  // საკუთარი გუნდის ბარათი — რომ სვლა არ შეიცვალოს და თამაშიც არ დასრულდეს
  const index=state.get(spy).game.board.findIndex(card=>!card.revealed&&card.type===state.get(spy).game.turn);
  op.emit("suggest-card",{index});
  await wait(op,"room-state",room=>room.game.picks?.some(pick=>pick.index===index));
  op.emit("confirm-card",{index});
  await wait(op,"room-state",room=>room.game.board[index].revealed||!!room.game.winner);
  await settle();
  const opened=patches().filter(patch=>patch.mute===false).map(patch=>patch.user).sort();
  assert.deepEqual(opened,[enemySpyId,spyId].sort(),"გახსნის შემდეგ ორივეს უბრუნდება ხმა");
  close(sockets)
});

test("hardcore: ხელმძღვანელები ცალკე არხში გადადიან და clue ფაზაზე ბრუნდებიან", async () => {
  const {sockets,spy,op,spyId,enemySpyId}=await seat("hardcore");
  calls.length=0;
  spy.emit("give-clue",{word:"ტესტი",count:1});
  await wait(op,"room-state",room=>room.game.phase==="guess");
  await settle();
  assert.deepEqual(patches(),[{user:enemySpyId,mute:false,channel_id:"spy-channel"}]);
  assert.ok(calls.some(call=>call.method==="POST"&&call.url.endsWith("/channels")),"დროებითი არხი შეიქმნა");
  calls.length=0;
  await afterTick();
  assert.deepEqual(patches(),[{user:spyId,mute:false,channel_id:"spy-channel"}],"ფანჯრის შემდეგ ავტორიც გადადის");
  calls.length=0;
  op.emit("end-turn");
  await wait(op,"room-state",room=>room.game.phase==="clue");
  await settle();
  const back=patches().sort((a,b)=>a.user.localeCompare(b.user));
  assert.equal(back.length,2);
  assert.ok(back.every(patch=>patch.channel_id===null||patch.channel_id===undefined||patch.mute===false),"ორივე თავისუფლდება");
  close(sockets)
});

test("off: Discord-ს არცერთი მოთხოვნა არ ეგზავნება", async () => {
  const {sockets,spy,op}=await seat("off");
  calls.length=0;
  spy.emit("give-clue",{word:"ტესტი",count:1});
  await wait(op,"room-state",room=>room.game.phase==="guess");
  await afterTick();
  assert.deepEqual(calls,[]);
  close(sockets)
});

test("თამაშის დასრულებისას ყველას უბრუნდება ხმა", async () => {
  const {sockets,state,spy,op,spyId,enemySpyId}=await seat("mute");
  const team=state.get(sockets[0]).game.turn;
  spy.emit("give-clue",{word:"ტესტი",count:9});
  await wait(op,"room-state",room=>room.game.phase==="guess");
  await afterTick();
  calls.length=0;
  // მიმდინარე მდგომარეობა უკვე შეიძლება აკმაყოფილებდეს პირობას — ჯერ მას ვამოწმებთ
  const untilState=(socket,predicate)=>predicate(state.get(socket))?Promise.resolve(state.get(socket)):wait(socket,"room-state",predicate);
  for(let guard=0;guard<30;guard++){
    const game=state.get(spy).game;// მხოლოდ ხელმძღვანელი ხედავს ფერებს
    if(game.winner)break;
    const index=game.board.findIndex(card=>!card.revealed&&card.type===team);
    if(index<0)break;
    op.emit("suggest-card",{index});
    await untilState(spy,room=>room.game.picks?.some(pick=>pick.index===index)).catch(()=>{});
    op.emit("confirm-card",{index});
    await untilState(spy,room=>room.game.board[index].revealed||!!room.game.winner).catch(()=>{})
  }
  await settle();
  assert.ok(state.get(sockets[0]).game.winner,"თამაში დასრულდა");
  const opened=new Set(patches().filter(patch=>patch.mute===false).map(patch=>patch.user));
  assert.ok(opened.has(spyId)&&opened.has(enemySpyId),"ორივე ხელმძღვანელს დაუბრუნდა ხმა");
  close(sockets)
});

test("Discord ლოგინი: მოთამაშეს ებმება ანგარიში, ფოტო და ხმის კონტროლი", async () => {
  calls.length=0;store.resetMemory();
  const host=io(URL,{transports:["websocket"],forceNew:true});
  const guest=io(URL,{transports:["websocket"],forceNew:true});
  await Promise.all([wait(host,"connect"),wait(guest,"connect")]);
  const rooms=new Map();
  [host,guest].forEach(socket=>socket.on("room-state",room=>rooms.set(socket,room)));

  host.emit("create-room",{name:"მასპინძელი",roomName:"ლოგინის ტესტი"});
  const created=await wait(host,"room-joined");
  const code=created.room.code;

  // არასწორი token — მიბმა არ უნდა მოხდეს
  guest.emit("join-room",{name:"სტუმარი",code,authToken:"bogus-token"});
  await wait(guest,"room-joined");
  await settle();
  const withBogus=(rooms.get(host)||created.room).players.find(player=>player.name==="სტუმარი");
  assert.equal(withBogus?.discord,false,"ყალბი token-ით ანგარიში არ ებმება");
  assert.ok(!withBogus?.avatarUrl,"ყალბი token-ით ფოტო არ ჩნდება");

  // სწორი token — ებმება
  guest.emit("refresh-identity",{authToken:"good-token"});
  await wait(host,"room-state",room=>room.players.some(player=>player.name==="სტუმარი"&&player.discord));
  const linked=rooms.get(host).players.find(player=>player.name==="სტუმარი");
  assert.equal(linked.discord,true);
  assert.equal(linked.avatarUrl,"https://cdn.discordapp.com/avatars/555000111/hash.png?size=128");
  assert.equal(linked.discordId,undefined,"discordId კლიენტებს არ ეგზავნება");
  assert.equal(linked.userId,undefined,"Supabase user id კლიენტებს არ ეგზავნება");

  [host,guest].forEach(socket=>socket.disconnect())
});
