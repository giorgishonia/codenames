import express from "express";
import http from "node:http";
import crypto from "node:crypto";
import {Server} from "socket.io";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {DEFAULT_WORD_CATEGORIES,WORD_CATEGORY_OPTIONS,normalizeWordCategories,wordsForCategories} from "./shared/word-packs.js";
import {DEFAULT_VOICE_MODE,authEnabled,config as discordConfig,discordEnabled,interactionsEnabled,voiceMode} from "./discord/config.js";
import {verifySignature} from "./discord/rest.js";
import {takeLink} from "./discord/store.js";
import {closeWindows,openClueWindow,openReactionWindow} from "./discord/policy.js";
import {releaseRoom,restoreAfterRestart,syncRoomVoice,tickRoomVoice,voiceDiagnostics} from "./discord/voice.js";
import {handleInteraction} from "./discord/interactions.js";
import {verifyAccessToken} from "./discord/auth.js";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(),server=http.createServer(app),io=new Server(server,{pingTimeout:20000,pingInterval:10000});
const PORT=process.env.PORT||3000,rooms=new Map(),ROOM_INACTIVITY_MS=Number(process.env.ROOM_INACTIVITY_MS)||5*60*1000;
const DEFAULT_GAME_SETTINGS={clueTime:90,guessTime:120,roundTime:240,voiceMode:DEFAULT_VOICE_MODE};
const WORDS=["მთა","ზღვა","მზე","მთვარე","ვარსკვლავი","წვიმა","ქარი","თოვლი","ღრუბელი","ტყე","მდინარე","ხიდი","კოშკი","სახლი","ქუჩა","ქალაქი","სოფელი","ბაღი","ყვავილი","ხე","ფოთოლი","ვაშლი","ღვინო","პური","ყავა","ჩაი","სუფრა","წიგნი","კალამი","წერილი","გასაღები","საათი","სარკე","ფანჯარა","კარი","სკამი","მაგიდა","ხალიჩა","ტელეფონი","რადიო","მატარებელი","გემი","თვითმფრინავი","მანქანა","ველოსიპედი","გზა","რუკა","კომპასი","ოქრო","ვერცხლი","ბრილიანტი","გვირგვინი","მეფე","დედოფალი","რაინდი","დრაკონი","მზვერავი","ნიღაბი","ჩრდილი","საიდუმლო","სიზმარი","სიმღერა","ცეკვა","თეატრი","კინო","სცენა","ფოტო","ფერი","ხმა","სინათლე","ცეცხლი","წყალი","ყინული","ქვა","ქვიშა","კუნძული","უდაბნო","ოკეანე","ნავსადგური","ბაზარი","მუზეუმი","სკოლა","ექიმი","მასწავლებელი","მზარეული","მფრინავი","მეკარე","ბურთი","ჭადრაკი","თასი","მედალი","ბილეთი","საჩუქარი","დღე","ღამე","გაზაფხული","ზაფხული","შემოდგომა","ზამთარი"];
const CARD_ART={
  blue:["blue-0.webp","blue-7.webp","blue-8.webp","blue-11.webp","blue-13.webp","blue-19.webp","blue-21.webp","blue-23.webp","blue-24.webp"],
  red:["red-1.webp","red-8.webp","red-10.webp","red-13.webp","red-22.webp","red-23.webp","red-24.webp"],
  neutral:["neutral-0.webp","neutral-1.webp","neutral-2.webp","neutral-3.webp","neutral-4.webp","neutral-5.webp","neutral-6.webp","neutral-7.webp","neutral-8.webp","neutral-9.webp"],
  assassin:["black-0.webp"]
};
const code=()=>{let s="";const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";do{s=Array.from({length:5},()=>chars[crypto.randomInt(chars.length)]).join("")}while(rooms.has(s));return s};
const token=()=>crypto.randomBytes(18).toString("base64url");
const clean=(v,n=24)=>String(v??"").replace(/[<>]/g,"").trim().slice(0,n);
const shuffle=a=>{a=[...a];for(let i=a.length-1;i;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};
const gameSettings=value=>({
  clueTime:Math.min(600,Math.max(15,Number(value?.clueTime)||DEFAULT_GAME_SETTINGS.clueTime)),
  guessTime:Math.min(900,Math.max(15,Number(value?.guessTime)||DEFAULT_GAME_SETTINGS.guessTime)),
  roundTime:Math.min(1200,Math.max(30,Number(value?.roundTime)||DEFAULT_GAME_SETTINGS.roundTime)),
  voiceMode:voiceMode(value?.voiceMode)
});
const guessAllowance=count=>count===0||count===99?99:count+1;
const publicRoom=(room,selfId)=>{
  const viewer=room.players.find(p=>p.id===selfId),canSeeKey=viewer?.role==="spymaster"||!!room.game?.winner;
  const game=room.game?{...room.game,board:room.game.board.map(c=>c.revealed||canSeeKey?c:{word:c.word,revealed:false,type:null})}:null;
  return{code:room.code,name:room.name,isPublic:room.isPublic,settings:room.settings||DEFAULT_GAME_SETTINGS,wordCategories:normalizeWordCategories(room.wordCategories),wordCategoryOptions:WORD_CATEGORY_OPTIONS,selfId,hostId:room.hostId,canStart:canStart(room),players:room.players.map(({token,removeTimer,lastChatAt,discordId,userId,...p})=>({...p,discord:!!discordId})),chat:room.chat,game,voice:{enabled:discordEnabled(),mode:voiceMode(room.settings?.voiceMode),guild:!!room.discord?.guildId,linked:room.players.filter(p=>p.discordId).length,
    issues:[...(room.voice?.unavailable?.keys()||[])].map(id=>room.players.find(p=>p.discordId===id)?.name).filter(Boolean)}};
};
const lobbyAvatars=room=>{
  const connected=room.players.filter(p=>p.connected).slice(0,4);
  return{avatars:connected.map(p=>p.avatar),avatarUrls:connected.map(p=>p.avatarUrl||null)};
};
const canStart=r=>r.players.filter(p=>p.connected).length>=4&&["blue","red"].every(t=>r.players.some(p=>p.connected&&p.team===t&&p.role==="spymaster")&&r.players.some(p=>p.connected&&p.team===t&&p.role==="operative"));
const lobbyList=()=>[...rooms.values()].filter(r=>r.isPublic&&r.players.some(p=>p.connected)).map(r=>({code:r.code,name:r.name,status:r.game?"playing":"waiting",players:r.players.filter(p=>p.connected).length,...lobbyAvatars(r),createdAt:r.createdAt})).sort((a,b)=>b.createdAt-a.createdAt);
function broadcastLobbyList(){io.emit("lobby-list",lobbyList())}
function touch(room){room.lastActivity=Date.now()}
function assignHost(room){
  if(!room.players.length){room.hostId=null;return}
  const connected=room.players.filter(p=>p.connected),pool=connected.length?connected:room.players,next=pool[crypto.randomInt(pool.length)];
  room.players.forEach(p=>p.host=p.id===next.id);room.hostId=next.id
}
function removePlayer(room,target,reason,ban=false){
  if(ban&&!room.bannedTokens.includes(target.token))room.bannedTokens.push(target.token);
  clearTimeout(target.removeTimer);
  const client=target.socketId&&io.sockets.sockets.get(target.socketId);
  if(client){client.leave(room.code);client.data={};client.emit("removed-from-room",{reason,ban})}
  room.players=room.players.filter(p=>p.id!==target.id);
  if(target.host)assignHost(room);
  if(!room.players.length){releaseRoom(room);rooms.delete(room.code)}else emitRoom(room);
  broadcastLobbyList()
}
function expireRoom(room){
  if(!rooms.delete(room.code))return;
  releaseRoom(room);
  for(const p of room.players){
    const client=p.socketId&&io.sockets.sockets.get(p.socketId);
    if(client){client.leave(room.code);client.data={};client.emit("room-expired")}
  }
  broadcastLobbyList()
}
function emitRoom(room){for(const p of room.players)if(p.socketId)io.to(p.socketId).emit("room-state",publicRoom(room,p.id));syncRoomVoice(room)}
function findPlayer(socket){const room=rooms.get(socket.data.room),player=room?.players.find(p=>p.id===socket.data.player);return room&&player?[room,player]:null}
// ორივე გზა ერთ ადგილას: Discord ლოგინი და ბოტის ერთჯერადი ბმული.
const linkPlayer=(room,player,data)=>Promise.all([
  attachIdentity(room,player,data?.authToken),
  attachDiscord(room,player,data?.discordToken)
]);
// Supabase Discord ლოგინი → მოთამაშის ვინაობა (Discord ID + პროფილის ფოტო).
async function attachIdentity(room,player,authToken){
  if(!authToken)return null;
  const profile=await verifyAccessToken(String(authToken)).catch(()=>null);
  if(!profile)return null;
  player.discordId=profile.discordId;player.avatarUrl=profile.avatarUrl||null;player.userId=profile.userId;
  // Discord-ით შესული მოთამაშის სახელი ანგარიშიდან მოდის — ძველი სტუმრის სახელი აღარ რჩება.
  const discordName=clean(profile.name,18);if(discordName.length>=2)player.name=discordName;
  if(room.pendingHostDiscordId===profile.discordId){room.players.forEach(x=>x.host=false);player.host=true;room.hostId=player.id;room.pendingHostDiscordId=null}
  return profile
}
// Discord-ის ერთჯერადი ბმულის token → მოთამაშესთან Discord ანგარიშის მიბმა.
async function attachDiscord(room,player,linkToken){
  if(!linkToken)return null;
  const link=await takeLink(String(linkToken)).catch(()=>null);
  if(!link||link.roomCode!==room.code)return null;
  player.discordId=link.discordId;
  room.discord={...room.discord,guildId:link.guildId||room.discord?.guildId};
  if(room.pendingHostDiscordId===link.discordId){room.players.forEach(x=>x.host=false);player.host=true;room.hostId=player.id;room.pendingHostDiscordId=null}
  return link
}
function newGame(settings,wordCategories){
  const now=Date.now();
  const first=crypto.randomInt(2)?"blue":"red",types=[...Array(first==="blue"?9:8).fill("blue"),...Array(first==="red"?9:8).fill("red"),...Array(7).fill("neutral"),"assassin"],words=shuffle(wordsForCategories(wordCategories)).slice(0,25);
  const artPools=Object.fromEntries(Object.entries(CARD_ART).map(([type,items])=>[type,shuffle(items)])),artIndex={blue:0,red:0,neutral:0,assassin:0};
  const total={blue:types.filter(x=>x==="blue").length,red:types.filter(x=>x==="red").length};
  return{turn:first,round:1,phase:"clue",clue:null,pendingGuess:null,picks:[],voice:{},guessesLeft:0,roundDeadline:now+settings.roundTime*1000,phaseDeadline:now+Math.min(settings.clueTime,settings.roundTime)*1000,total,remaining:{...total},board:shuffle(types).map((type,i)=>({word:words[i],type,art:artPools[type][artIndex[type]++%artPools[type].length],revealed:false})),log:[{actor:"სისტემა",text:`${first==="blue"?"ლურჯი":"წითელი"} გუნდი იწყებს ოპერაციას.`}]}
}
function switchTurn(g,settings,reason=""){const now=Date.now();closeWindows(g);g.turn=g.turn==="blue"?"red":"blue";g.round++;g.phase="clue";g.clue=null;g.pendingGuess=null;g.picks=[];g.guessesLeft=0;g.roundDeadline=now+settings.roundTime*1000;g.phaseDeadline=now+Math.min(settings.clueTime,settings.roundTime)*1000;g.log.push({actor:"სისტემა",text:`${reason?`${reason} `:""}ახლა ${g.turn==="blue"?"ლურჯების":"წითლების"} სვლაა.`})}
function win(room,winner,reason){room.game.winner=winner;closeWindows(room.game);emitRoom(room);releaseRoom(room);io.to(room.code).emit("game-over",{winner,reason})}

// ---------------------------------------------------------------- Discord ---
// ბოტს ოთახებთან ამ პატარა API-ით ვაკავშირებთ (ციკლური import-ის გარეშე).
const discordApi={
  roomByCode:code=>rooms.get(String(code||"").toUpperCase()),
  roomForGuild:guildId=>[...rooms.values()].find(room=>room.discord?.guildId===guildId),
  roomForChannel:(guildId,channelId)=>[...rooms.values()].find(room=>room.discord?.guildId===guildId&&(room.discord?.textChannelId===channelId||room.discord?.channelId===channelId)),
  createRoom({name,guildId,channelId,textChannelId,hostDiscordId,voiceMode:mode}){
    const room={code:code(),name:clean(name,28)||"Discord ოთახი",isPublic:true,settings:{...DEFAULT_GAME_SETTINGS,voiceMode:voiceMode(mode)},wordCategories:[...DEFAULT_WORD_CATEGORIES],bannedTokens:[],hostId:null,players:[],chat:[],game:null,createdAt:Date.now(),lastActivity:Date.now(),
      discord:{guildId,channelId,textChannelId:textChannelId||null},pendingHostDiscordId:hostDiscordId||null};
    rooms.set(room.code,room);broadcastLobbyList();return room
  },
  setVoiceMode(room,mode){room.settings={...room.settings,voiceMode:voiceMode(mode)};touch(room);emitRoom(room)},
  releaseRoom(room){room.settings={...room.settings,voiceMode:"off"};emitRoom(room);return releaseRoom(room,{deleteChannel:false})}
};
app.post("/api/discord/interactions",express.raw({type:"*/*"}),async(req,res)=>{
  if(!interactionsEnabled())return res.status(503).json({error:"discord disabled"});
  if(!verifySignature(req.body,req.get("x-signature-ed25519"),req.get("x-signature-timestamp")))return res.status(401).send("invalid request signature");
  let body;try{body=JSON.parse(req.body.toString("utf8"))}catch{return res.status(400).send("bad json")}
  try{res.json(await handleInteraction(body,discordApi))}
  catch(error){console.error("[discord] interaction",error);res.json({type:4,data:{content:"შეცდომა მოხდა — სცადე თავიდან.",flags:64}})}
});
// კლიენტს Discord-ით შესვლისთვის მხოლოდ საჯარო მონაცემები სჭირდება.
app.get("/api/config",(req,res)=>res.json({
  auth:{enabled:authEnabled(),provider:"discord",supabaseUrl:discordConfig.supabaseUrl,anonKey:discordConfig.supabaseAnonKey},
  voice:{enabled:discordEnabled()}
}));
app.get("/api/discord/health",(req,res)=>res.json({
  enabled:discordEnabled(),interactions:interactionsEnabled(),auth:authEnabled(),
  configuredGuild:discordConfig.guildId||null,
  rooms:[...rooms.values()].map(voiceDiagnostics)
}));

app.use(express.static(path.join(__dirname,"public")));
app.use((req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
io.on("connection",socket=>{
  socket.emit("lobby-list",lobbyList());
  socket.on("list-rooms",()=>socket.emit("lobby-list",lobbyList()));
  socket.on("create-room",data=>{
    const name=clean(data?.name,18),roomName=clean(data?.roomName,28);if(name.length<2)return socket.emit("error-message","სახელი ძალიან მოკლეა.");if(roomName.length<2)return socket.emit("error-message","ოთახს სახელი სჭირდება.");
    const room={code:code(),name:roomName,isPublic:data?.isPublic!==false,settings:{...DEFAULT_GAME_SETTINGS},wordCategories:[...DEFAULT_WORD_CATEGORIES],bannedTokens:[],hostId:null,players:[],chat:[],game:null,createdAt:Date.now(),lastActivity:Date.now()},p={id:crypto.randomUUID(),token:token(),socketId:socket.id,name,avatar:crypto.randomInt(8),team:null,role:null,host:true,connected:true};
    room.hostId=p.id;room.players.push(p);rooms.set(room.code,room);socket.join(room.code);socket.data={room:room.code,player:p.id};socket.emit("room-joined",{room:publicRoom(room,p.id),token:p.token,selfId:p.id});
    linkPlayer(room,p,data).finally(()=>{emitRoom(room);broadcastLobbyList()})
  });
  socket.on("join-room",data=>{
    const room=rooms.get(clean(data?.code,5).toUpperCase()),name=clean(data?.name,18);if(!room)return socket.emit("error-message","ასეთი ოთახი ვერ მოიძებნა.");if(name.length<2)return socket.emit("error-message","სახელი ძალიან მოკლეა.");
    room.settings||={...DEFAULT_GAME_SETTINGS};room.wordCategories=normalizeWordCategories(room.wordCategories);room.bannedTokens||=[];
    if(data?.reconnectToken&&room.bannedTokens.includes(data.reconnectToken))return socket.emit("error-message","ამ ოთახში დაბრუნება აკრძალული გაქვს.");
    const returning=room.players.find(p=>p.token===data?.reconnectToken);
    if(returning){touch(room);returning.socketId=socket.id;returning.connected=true;clearTimeout(returning.removeTimer);socket.join(room.code);socket.data={room:room.code,player:returning.id};socket.emit("room-joined",{room:publicRoom(room,returning.id),token:returning.token,selfId:returning.id});linkPlayer(room,returning,data).finally(()=>{emitRoom(room);broadcastLobbyList()});return}
    if(room.game)return socket.emit("error-message","თამაში უკვე დაწყებულია.");
    const p={id:crypto.randomUUID(),token:token(),socketId:socket.id,name,avatar:room.players.length%8,team:null,role:null,host:false,connected:true};touch(room);room.players.push(p);
    if(!room.players.some(x=>x.host)){p.host=true;room.hostId=p.id}
    socket.join(room.code);socket.data={room:room.code,player:p.id};socket.emit("room-joined",{room:publicRoom(room,p.id),token:p.token,selfId:p.id});
    linkPlayer(room,p,data).finally(()=>{emitRoom(room);broadcastLobbyList()})
  });
  socket.on("reconnect-room",data=>{
    const room=rooms.get(clean(data?.code,5).toUpperCase()),p=room?.players.find(x=>x.token===data?.token);if(!room||!p)return;
    touch(room);p.socketId=socket.id;p.connected=true;clearTimeout(p.removeTimer);socket.join(room.code);socket.data={room:room.code,player:p.id};socket.emit("room-joined",{room:publicRoom(room,p.id),token:p.token,selfId:p.id});
    linkPlayer(room,p,data).finally(()=>{emitRoom(room);broadcastLobbyList()})
  });
  socket.on("update-room-settings",data=>{
    const found=findPlayer(socket);if(!found)return;const[room,p]=found;touch(room);if(!p.host)return;
    const name=clean(data?.name,28);if(name.length<2)return socket.emit("error-message","ოთახს სახელი სჭირდება.");
    room.name=name;room.isPublic=data?.isPublic!==false;room.settings=gameSettings(data?.settings);room.wordCategories=normalizeWordCategories(data?.wordCategories);emitRoom(room);broadcastLobbyList()
  });
  socket.on("moderate-player",data=>{
    const found=findPlayer(socket);if(!found)return;const[room,p]=found;touch(room);if(!p.host)return;
    const target=room.players.find(x=>x.id===data?.playerId);if(!target||target.id===p.id)return;
    if(data?.action==="promote"){p.host=false;target.host=true;room.hostId=target.id;emitRoom(room);socket.emit("moderation-result",{action:"promote",message:`${target.name} ახლა მასპინძელია`});return}
    if(data?.action==="kick"){removePlayer(room,target,"მასპინძელმა ოთახიდან გაგიშვა",false);socket.emit("moderation-result",{action:"kick",message:`${target.name} ოთახიდან გაიშვა`});return}
    if(data?.action==="ban"){removePlayer(room,target,"მასპინძელმა ოთახში დაბრუნება აგიკრძალა",true);socket.emit("moderation-result",{action:"ban",message:`${target.name} დაიბლოკა`});return}
  });
  socket.on("choose-role",data=>{
    const found=findPlayer(socket);if(!found)return;const [room,p]=found;touch(room);const team=["blue","red"].includes(data?.team)&&data.team,role=["spymaster","operative"].includes(data?.role)&&data.role;if(!team||!role||room.game)return;
    p.team=team;p.role=role;emitRoom(room);broadcastLobbyList()
  });
  socket.on("quick-role",data=>{
    const found=findPlayer(socket);if(!found)return;const[room,p]=found;touch(room);if(room.game)return;
    if(data?.mode==="observer"){p.team=null;p.role=null}
    else if(data?.mode==="auto"){
      if(!p.host)return;
      const active=shuffle(room.players.filter(player=>player.connected));if(active.length<4)return socket.emit("error-message","სწრაფი განაწილებისთვის მინიმუმ 4 მოთამაშეა საჭირო.");
      room.players.filter(player=>!player.connected).forEach(player=>{player.team=null;player.role=null});
      active.forEach((player,index)=>{player.team=index===0?"blue":index===1?"red":index%2===0?"blue":"red";player.role=index<2?"spymaster":"operative"})
    }
    emitRoom(room);broadcastLobbyList()
  });
  socket.on("send-chat",data=>{
    const found=findPlayer(socket);if(!found)return;const[room,p]=found;touch(room);const text=clean(data?.text,160);if(!text||p.role==="spymaster"&&room.game)return;
    if(p.lastChatAt&&Date.now()-p.lastChatAt<700)return;p.lastChatAt=Date.now();
    room.chat.push({id:crypto.randomUUID(),actor:p.name,playerId:p.id,team:p.team,text,time:Date.now()});if(room.chat.length>50)room.chat.shift();emitRoom(room)
  });
  socket.on("start-game",()=>{
    const found=findPlayer(socket);if(!found)return;const [room,p]=found;touch(room);if(!p.host||!canStart(room))return socket.emit("error-message","გუნდები ჯერ მზად არ არიან.");
    room.game=newGame(room.settings||DEFAULT_GAME_SETTINGS,room.wordCategories);emitRoom(room);broadcastLobbyList()
  });
  socket.on("give-clue",data=>{
    const found=findPlayer(socket);if(!found)return;const [room,p]=found;touch(room);const g=room.game,word=clean(data?.word,24).replace(/\s+/g,""),count=Number(data?.count);if(!g||g.winner||p.role!=="spymaster"||p.team!==g.turn||g.phase!=="clue")return;
    if(word.length<2||!Number.isInteger(count)||count<1||count>9)return socket.emit("error-message","მინიშნება და არჩეული ბარათები გადაამოწმე.");
    if(g.board.some(c=>{const card=c.word.toLowerCase(),clue=word.toLowerCase(),min=Math.min(card.length,clue.length);return!c.revealed&&(card===clue||min>=4&&(card.startsWith(clue)||clue.startsWith(card)))}))return socket.emit("error-message","დაფაზე არსებული სიტყვის ან მისი აშკარა ფორმის გამოყენება არ შეიძლება.");
    g.clue={word,count};g.pendingGuess=null;g.guessesLeft=guessAllowance(count);g.phase="guess";openClueWindow(g,p.id);g.phaseDeadline=Math.min(g.roundDeadline,Date.now()+(room.settings||DEFAULT_GAME_SETTINGS).guessTime*1000);g.log.push({actor:p.name,text:`მისცა მინიშნება „${word}“ · ${count===99?"∞":count}.`});emitRoom(room)
  });
  socket.on("suggest-card",data=>{
    const found=findPlayer(socket);if(!found)return;const[room,p]=found;touch(room);const g=room.game,i=Number(data?.index),card=g?.board[i];
    if(!g||g.winner||p.role!=="operative"||p.team!==g.turn||g.phase!=="guess"||!card||card.revealed)return;
    const picks=(g.picks||=[]),existing=picks.findIndex(v=>v.playerId===p.id&&v.index===i);
    if(existing>=0)picks.splice(existing,1);else picks.push({playerId:p.id,name:p.name,avatar:p.avatar,avatarUrl:p.avatarUrl||null,team:p.team,index:i});
    const last=g.picks[g.picks.length-1];
    g.pendingGuess=last?{index:last.index,actor:last.name}:null;emitRoom(room)
  });
  const confirmCard=data=>{
    const found=findPlayer(socket);if(!found)return;const [room,p]=found;touch(room);const g=room.game,i=Number(data?.index??g?.pendingGuess?.index),card=g?.board[i];
    if(!g||g.winner||p.role!=="operative"||p.team!==g.turn||g.phase!=="guess"||!card||card.revealed||!g.picks?.some(v=>v.index===i))return;
    g.picks=g.picks.filter(v=>v.index!==i);const last=g.picks[g.picks.length-1];g.pendingGuess=last?{index:last.index,actor:last.name}:null;
    card.revealed=true;openReactionWindow(g);g.log.push({actor:p.name,text:`დაადასტურა „${card.word}“ — ${card.type==="blue"?"ლურჯი":card.type==="red"?"წითელი":card.type==="neutral"?"ნეიტრალური":"შავი აგენტი"}.`});
    if(card.type==="assassin")return win(room,p.team==="blue"?"red":"blue","შავი აგენტი გაიხსნა — ოპერაცია ჩავარდა.");
    if(card.type==="blue"||card.type==="red"){g.remaining[card.type]--;if(g.remaining[card.type]===0)return win(room,card.type,"გუნდმა ყველა თავისი აგენტი იპოვა.")}
    if(card.type!==p.team)return switchTurn(g,room.settings||DEFAULT_GAME_SETTINGS),emitRoom(room);
    if(g.guessesLeft!==99)g.guessesLeft--;if(g.guessesLeft===0)switchTurn(g,room.settings||DEFAULT_GAME_SETTINGS);emitRoom(room)
  };
  socket.on("confirm-card",confirmCard);
  socket.on("guess-card",confirmCard);
  socket.on("end-turn",()=>{const found=findPlayer(socket);if(!found)return;const [room,p]=found;touch(room);const g=room.game;if(g&&!g.winner&&p.role==="operative"&&p.team===g.turn&&g.phase==="guess"){switchTurn(g,room.settings||DEFAULT_GAME_SETTINGS);emitRoom(room)}});
  socket.on("back-to-lobby",()=>{const found=findPlayer(socket);if(!found)return;const [room,p]=found;touch(room);if(p.host){room.game=null;emitRoom(room);broadcastLobbyList()}});
  socket.on("refresh-identity",data=>{
    const found=findPlayer(socket);if(!found)return;const[room,p]=found;
    attachIdentity(room,p,data?.authToken).then(profile=>{if(profile){emitRoom(room);broadcastLobbyList()}})
  });
  socket.on("leave-room",()=>disconnectPlayer(socket,true));
  socket.on("disconnect",()=>disconnectPlayer(socket,false))
});
function disconnectPlayer(socket,immediate){
  const found=findPlayer(socket);if(!found)return;const [room,p]=found;p.connected=false;p.socketId=null;
  const remove=()=>{const current=room.players.find(x=>x.id===p.id);if(!current||current.connected)return;removePlayer(room,current,"ოთახი დატოვე",false)};
  if(immediate)remove();else p.removeTimer=setTimeout(remove,5*60*1000);emitRoom(room);broadcastLobbyList()
}
setInterval(()=>{const now=Date.now();for(const room of rooms.values()){if(now-(room.lastActivity||room.createdAt)>=ROOM_INACTIVITY_MS){expireRoom(room);continue}const g=room.game;if(g&&!g.winner&&g.phaseDeadline&&now>=g.phaseDeadline){switchTurn(g,room.settings||DEFAULT_GAME_SETTINGS,"დრო ამოიწურა.");emitRoom(room)}else tickRoomVoice(room,now)}},Math.min(1000,ROOM_INACTIVITY_MS)).unref();
server.listen(PORT,()=>{
  console.log(`საიდუმლო სიტყვა მზადაა: http://localhost:${PORT}`);
  if(discordEnabled()){
    console.log(`[discord] ჩართულია · interactions: ${interactionsEnabled()?`${discordConfig.baseUrl}/api/discord/interactions`:"გამორთული (PUBLIC_KEY აკლია)"}`);
    restoreAfterRestart().catch(error=>console.warn("[discord]",error.message))
  }else console.log("[discord] გამორთულია (DISCORD_BOT_TOKEN არ არის)")
});
export {server,io,rooms};
for(const signal of ["SIGINT","SIGTERM"])process.once(signal,async()=>{
  await Promise.allSettled([...rooms.values()].map(room=>releaseRoom(room)));
  process.exit(0)
});
