const socket=io({autoConnect:false,reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:800});
const $=id=>document.getElementById(id);
const screens=["landing","lobby","game"];
const state={room:null,selfId:null,mode:"create",sound:localStorage.getItem("ss-sound")!=="off",compact:localStorage.getItem("ss-compact")==="on",rooms:[],filter:"all",lastPhase:null,lastRevealed:0};
const avatarPos=["0% 0%","33.333% 0%","66.666% 0%","100% 0%","0% 100%","33.333% 100%","66.666% 100%","100% 100%"];
let audioCtx;

function showScreen(name){screens.forEach(id=>$(id).classList.toggle("hidden",id!==name))}
function toast(text){$("toast").textContent=text;$("toast").classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>$("toast").classList.remove("show"),2400)}
function sound(type){
  if(!state.sound)return;
  audioCtx||=new(window.AudioContext||window.webkitAudioContext)();
  const now=audioCtx.currentTime,gain=audioCtx.createGain();gain.connect(audioCtx.destination);
  const notes=type==="reveal"?[220,330]:type==="clue"?[523,659]:type==="win"?[392,523,659]:type==="lose"?[220,185]:[440];
  notes.forEach((freq,i)=>{const o=audioCtx.createOscillator();o.type=type==="reveal"?"triangle":"sine";o.frequency.value=freq;o.connect(gain);o.start(now+i*.11);o.stop(now+i*.11+.18)});
  gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.09,now+.025);gain.gain.exponentialRampToValueAtTime(.0001,now+notes.length*.11+.2)
}
function syncSettings(){
  $("settingsSound").checked=state.sound;$("compactMode").checked=state.compact;
  $("gameSoundBtn").textContent=state.sound?"♫":"♩";$("gameSoundBtn").classList.toggle("muted",!state.sound);
  document.body.classList.toggle("body-compact",state.compact)
}
function openEntry(mode,prefill=""){
  state.mode=mode;state.joinCode=prefill;
  $("modalTitle").textContent=mode==="create"?"ახალი ოთახი":"ოთახში შესვლა";
  $("modalSubtitle").textContent=mode==="create"?"დაარქვი ოპერაციას სახელი.":"შეიყვანე შენი სახელი — შემდეგ ჯერზე დაგიმახსოვრებთ.";
  $("roomNameWrap").hidden=mode!=="create";$("nameWrap").hidden=mode==="create";$("visibilityWrap").hidden=true;$("codeWrap").hidden=true;
  $("roomNameInput").required=mode==="create";$("nameInput").required=mode==="join";$("codeInput").required=false;$("codeInput").value=prefill;
  $("nameInput").value=localStorage.getItem("ss-name")||"";$("formError").textContent="";
  $("entryModal").showModal();setTimeout(()=>$(mode==="create"?"roomNameInput":"nameInput").focus(),50)
}
function connectAnd(event,payload){if(!socket.connected){socket.connect();socket.once("connect",()=>socket.emit(event,payload))}else socket.emit(event,payload)}
function enter(e){
  e.preventDefault();
  const roomName=$("roomNameInput").value.trim(),code=state.joinCode;
  let name=state.mode==="join"?$("nameInput").value.trim():localStorage.getItem("ss-name");
  if(state.mode==="join"&&name.length<2)return $("formError").textContent="სახელი მინიმუმ 2 სიმბოლო უნდა იყოს.";
  if(state.mode==="create"&&roomName.length<2)return $("formError").textContent="ოთახს მოკლე სახელი მაინც სჭირდება.";
  if(!name){name=`მოთამაშე-${Math.floor(1000+Math.random()*9000)}`}
  localStorage.setItem("ss-name",name);
  const payload={name,reconnectToken:localStorage.getItem("ss-token")};
  if(state.mode==="join"){if(!code||code.length!==5)return $("formError").textContent="ოთახის კოდი ვერ მოიძებნა.";payload.code=code}
  else{payload.roomName=roomName;payload.isPublic=true}
  connectAnd(state.mode==="create"?"create-room":"join-room",payload)
}
function avatar(index,extra=""){return`<span class="agent-avatar ${extra}" style="background-position:${avatarPos[index%8]}"></span>`}
function chip(p){return`<span class="agent-chip ${p.id===state.selfId?"me":""}">${avatar(p.avatar)}<span>${esc(p.name)}${p.host?' <i class="host">★</i>':""}</span></span>`}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function players(team,role){return state.room.players.filter(p=>p.team===team&&p.role===role)}

function renderPublicRooms(){
  const query=$("roomSearch").value.trim().toLocaleLowerCase("ka");
  const filtered=state.rooms.filter(r=>(state.filter==="all"||r.status===state.filter)&&(!query||r.name.toLocaleLowerCase("ka").includes(query)||r.code.toLowerCase().includes(query)));
  $("allRoomsCount").textContent=state.rooms.length;
  $("onlineCount").innerHTML=`<i></i> ${state.rooms.reduce((n,r)=>n+r.players,0)} ონლაინ`;
  $("roomsGrid").classList.toggle("hidden",!filtered.length);$("emptyRooms").classList.toggle("hidden",!!filtered.length);
  $("roomsGrid").innerHTML=filtered.map(r=>`<article class="public-room ${r.status}">
    <div class="room-card-head"><div><h3>${esc(r.name)}</h3><span class="room-code"># ${esc(r.code)}</span></div><span class="room-status">${r.status==="waiting"?"ღიაა":"თამაშშია"}</span></div>
    <div class="room-card-body"><div class="room-people">${r.avatars.slice(0,4).map(avatar).join("")}<b>${r.players} მოთამაშე</b></div>
    <button class="join-public" data-room-code="${esc(r.code)}" ${r.status!=="waiting"?"disabled":""}>${r.status==="waiting"?"შესვლა →":"მიმდინარეობს"}</button></div>
  </article>`).join("")
}
function refreshRejoin(){
  const last=safeJson(localStorage.getItem("ss-last-room"));
  $("rejoinPanel").classList.toggle("hidden",!last||sessionStorage.getItem("ss-dismiss-rejoin")==="1");
  if(last){$("rejoinName").textContent=last.name||`ოთახი ${last.code}`;$("rejoinBtn").dataset.code=last.code}
}
function safeJson(value){try{return JSON.parse(value)}catch{return null}}
function renderLobby(){
  const r=state.room,self=r.players.find(p=>p.id===state.selfId);$("lobbyCode").textContent=r.code;$("lobbyRoomName").textContent=r.name;document.title=`${r.name} · საიდუმლო სიტყვა`;
  ["blue","red"].forEach(team=>{
    const sm=players(team,"spymaster"),ops=players(team,"operative");
    $(`${team}Spymaster`).innerHTML=sm.length?sm.map(chip).join(""):'<span class="empty-slot">ადგილი თავისუფალია</span>';
    $(`${team}Operatives`).innerHTML=ops.length?ops.map(chip).join(""):'<span class="empty-slot">ჯერ არავინ არის</span>';
    $(`${team}Count`).textContent=sm.length+ops.length
  });
  $("waitingRoster").innerHTML=r.players.filter(p=>!p.team).map(chip).join("");
  document.querySelectorAll("[data-join]").forEach(btn=>{const[team,role]=btn.dataset.join.split(":");btn.disabled=false;btn.textContent=players(team,role).some(p=>p.id===state.selfId)?"შენი ადგილი":role==="spymaster"?"ხელმძღვანელად შესვლა":"გუნდში შესვლა"});
  $("startGame").classList.toggle("hidden",!self?.host);$("startGame").disabled=!r.canStart;$("roomSettingsBtn").classList.toggle("hidden",!self?.host);
  $("lobbyHint").textContent=r.canStart?(self?.host?"ყველაფერი მზადაა — დაიწყე ოპერაცია!":"ველოდებით მასპინძელს..."):"მინიმუმ 4 მოთამაშე და 2 ხელმძღვანელია საჭირო"
}
function renderTeam(team,target){$(target).innerHTML=state.room.players.filter(p=>p.team===team).map(p=>`<div class="game-player ${p.connected?"":"offline"}">${avatar(p.avatar)}<span>${esc(p.name)}<small>${p.role==="spymaster"?"ხელმძღვანელი":"ოპერატივი"}${p.connected?"":" · გათიშულია"}</small></span></div>`).join("")}
function renderChat(self){
  const chat=state.room.chat||[];$("roomChat").innerHTML=chat.slice(-20).map(m=>`<div class="chat-message ${m.playerId===state.selfId?"mine":""}"><b>${esc(m.actor)}${m.team?` · ${m.team==="blue"?"ლურჯი":"წითელი"}`:""}</b>${esc(m.text)}</div>`).join("");
  $("roomChat").scrollTop=$("roomChat").scrollHeight;
  const blocked=self?.role==="spymaster";$("chatInput").disabled=blocked;$("chatForm").querySelector("button").disabled=blocked;$("chatHint").textContent=blocked?"ხელმძღვანელი თამაშის დროს ჩუმად უნდა იყოს.":"საუბარი ოთახის ყველა მოთამაშეს ესმის."
}
function renderGame(){
  const g=state.room.game,self=state.room.players.find(p=>p.id===state.selfId),isSpy=self?.role==="spymaster";
  $("turnText").textContent=`${g.turn==="blue"?"ლურჯების":"წითლების"} სვლაა`;$("turnDot").style.background=g.turn==="blue"?"#25a9d3":"#e55a4c";
  $("phaseText").textContent=`რაუნდი ${g.round||1} · ${g.phase==="clue"?"ხელმძღვანელი ფიქრობს...":"ოპერატივები არჩევენ"}`;$("blueScore").textContent=g.remaining.blue;$("redScore").textContent=g.remaining.red;
  $("blueProgress").style.width=`${100-(g.remaining.blue/(g.total?.blue||9))*100}%`;$("redProgress").style.width=`${100-(g.remaining.red/(g.total?.red||9))*100}%`;
  const myTurn=self?.team===g.turn,roleTitle=!self?.team?"დამკვირვებელი":isSpy?"ხელმძღვანელი":self.role==="operative"?"ოპერატივი":"დამკვირვებელი";
  const roleText=!self?.team?"თვალი ადევნე ოპერაციას":myTurn?(isSpy&&g.phase==="clue"?"შენი მინიშნების დროა":self.role==="operative"&&g.phase==="guess"?"მონიშნე და დაადასტურე ბარათი":"დაელოდე შენს გუნდს"):"მეტოქის სვლაა";
  $("roleBanner").className=`role-banner ${self?.team||""}`;$("roleBanner").innerHTML=`<b>${roleTitle}</b><span>${roleText}</span>`;
  renderTeam("blue","blueTeamGame");renderTeam("red","redTeamGame");
  $("board").innerHTML=g.board.map((c,i)=>{const cls=c.revealed?c.type:(isSpy?`key-${c.type}`:""),selected=g.pendingGuess?.index===i;return`<button class="card ${c.revealed?"revealed":""} ${selected?"selected":""} ${cls}" data-card="${i}" ${c.revealed||g.phase!=="guess"||self?.team!==g.turn||self?.role!=="operative"?"disabled":""}>${c.revealed&&c.art?`<img class="card-art" src="/cards/${esc(c.art)}" alt="">`:""}<span class="card-word">${esc(c.word)}</span></button>`}).join("");
  $("clueBanner").classList.toggle("hidden",!g.clue);if(g.clue){$("clueWord").textContent=g.clue.word;$("clueNumber").textContent=g.clue.count===99?"∞":g.clue.count}
  $("clueForm").classList.toggle("hidden",!(isSpy&&myTurn&&g.phase==="clue"));$("guessControls").classList.toggle("hidden",!(self?.role==="operative"&&myTurn&&g.phase==="guess"));$("waitingControl").classList.toggle("hidden",(isSpy&&myTurn&&g.phase==="clue")||(self?.role==="operative"&&myTurn&&g.phase==="guess"));
  $("confirmGuess").disabled=!g.pendingGuess;$("guessPrompt").innerHTML=g.pendingGuess?`<b>${esc(g.pendingGuess.actor)}</b>-მ მონიშნა „${esc(g.board[g.pendingGuess.index].word)}“ — დაადასტურეთ არჩევანი`:`ჯერ მონიშნეთ ბარათი — დარჩა <b id="guessesLeft">${g.guessesLeft===99?"∞":g.guessesLeft}</b> ცდა`;
  $("gameLog").innerHTML=g.log.slice(-12).reverse().map(x=>`<div class="log-entry"><b>${esc(x.actor||"სისტემა")}</b> ${esc(x.text)}</div>`).join("");
  renderChat(self);
  const revealed=g.board.filter(c=>c.revealed).length;if(revealed>state.lastRevealed)sound("reveal");if(state.lastPhase==="clue"&&g.phase==="guess")sound("clue");state.lastRevealed=revealed;state.lastPhase=g.phase
}
function applyRoom(room){
  state.room=room;state.selfId=room.selfId||state.selfId;
  localStorage.setItem("ss-last-room",JSON.stringify({code:room.code,name:room.name}));history.replaceState({}, "",`/room/${room.code}`);
  if(room.game){showScreen("game");renderGame()}else{if($("resultModal").open)$("resultModal").close();showScreen("lobby");renderLobby()}
}
function leave(){
  socket.emit("leave-room");state.room=null;state.selfId=null;localStorage.removeItem("ss-room");localStorage.removeItem("ss-token");localStorage.removeItem("ss-last-room");
  history.pushState({},"","/");document.title="საიდუმლო სიტყვა";showScreen("landing");refreshRejoin();socket.emit("list-rooms")
}
async function shareRoom(){
  const url=`${location.origin}/room/${state.room.code}`,data={title:state.room.name,text:`შემოგვიერთდი ოთახში — კოდი ${state.room.code}`,url};
  try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(url);toast("ოთახის ბმული დაკოპირდა")}}catch{}
}

$("openCreate").onclick=$("emptyCreate").onclick=()=>openEntry("create");
$("entryForm").onsubmit=enter;$("rulesLobbyBtn").onclick=$("rulesBtn").onclick=()=>$("rulesModal").showModal();
$("settingsBtn").onclick=()=>{$("settingsModal").showModal();syncSettings()};
$("settingsModal").addEventListener("close",()=>{state.sound=$("settingsSound").checked;state.compact=$("compactMode").checked;localStorage.setItem("ss-sound",state.sound?"on":"off");localStorage.setItem("ss-compact",state.compact?"on":"off");syncSettings()});
$("gameSoundBtn").onclick=()=>{state.sound=!state.sound;localStorage.setItem("ss-sound",state.sound?"on":"off");syncSettings();sound("click")};
$("roomsGrid").onclick=e=>{const btn=e.target.closest("[data-room-code]");if(btn&&!btn.disabled)openEntry("join",btn.dataset.roomCode)};
$("roomSearch").oninput=renderPublicRooms;
document.querySelectorAll("[data-filter]").forEach(btn=>btn.onclick=()=>{state.filter=btn.dataset.filter;document.querySelectorAll("[data-filter]").forEach(x=>x.classList.toggle("active",x===btn));renderPublicRooms()});
$("refreshRooms").onclick=()=>{$("refreshRooms").classList.remove("spinning");void $("refreshRooms").offsetWidth;$("refreshRooms").classList.add("spinning");socket.emit("list-rooms")};
$("rejoinBtn").onclick=()=>connectAnd("reconnect-room",{code:$("rejoinBtn").dataset.code,token:localStorage.getItem("ss-token")});
$("dismissRejoin").onclick=()=>{sessionStorage.setItem("ss-dismiss-rejoin","1");refreshRejoin()};
$("copyCode").onclick=async()=>{await navigator.clipboard.writeText(state.room.code);toast("ოთახის კოდი დაკოპირდა")};
$("shareRoom").onclick=shareRoom;$("leaveLobby").onclick=leave;
$("roomSettingsBtn").onclick=()=>{$("editRoomName").value=state.room.name;$("editRoomPublic").checked=state.room.isPublic;$("roomSettingsModal").showModal()};
$("roomSettingsForm").onsubmit=e=>{e.preventDefault();socket.emit("update-room-settings",{name:$("editRoomName").value.trim(),isPublic:$("editRoomPublic").checked});$("roomSettingsModal").close()};
document.querySelectorAll("[data-join]").forEach(btn=>btn.onclick=()=>{const[team,role]=btn.dataset.join.split(":");socket.emit("choose-role",{team,role})});
$("quickTeam").onclick=()=>socket.emit("quick-role",{mode:"auto"});$("observeGame").onclick=()=>socket.emit("quick-role",{mode:"observer"});
$("startGame").onclick=()=>socket.emit("start-game");
$("clueForm").onsubmit=e=>{e.preventDefault();socket.emit("give-clue",{word:$("clueInput").value.trim(),count:Number($("clueCount").value)});$("clueInput").value=""};
$("board").onclick=e=>{const card=e.target.closest("[data-card]");if(card)socket.emit("suggest-card",{index:Number(card.dataset.card)})};
$("confirmGuess").onclick=()=>socket.emit("guess-card");
$("endTurn").onclick=()=>socket.emit("end-turn");$("backToLobby").onclick=()=>{socket.emit("back-to-lobby");$("resultModal").close()};
$("chatForm").onsubmit=e=>{e.preventDefault();const text=$("chatInput").value.trim();if(text){socket.emit("send-chat",{text});$("chatInput").value=""}};
$("clueCount").insertAdjacentHTML("beforeend",'<option value="0">0</option>');for(let i=1;i<=9;i++)$("clueCount").insertAdjacentHTML("beforeend",`<option value="${i}">${i}</option>`);$("clueCount").insertAdjacentHTML("beforeend",'<option value="99">∞</option>');

socket.on("lobby-list",rooms=>{state.rooms=rooms;renderPublicRooms()});
socket.on("room-joined",({room,token,selfId})=>{localStorage.setItem("ss-token",token);localStorage.setItem("ss-room",room.code);state.selfId=selfId;$("entryModal").close();applyRoom(room);sound("clue")});
socket.on("room-state",applyRoom);
socket.on("game-over",({winner,reason})=>{const self=state.room?.players.find(p=>p.id===state.selfId);sound(winner===self?.team?"win":"lose");$("resultSeal").classList.toggle("red",winner==="red");$("resultTitle").textContent=`${winner==="blue"?"ლურჯებმა":"წითლებმა"} გაიმარჯვეს!`;$("resultText").textContent=reason;$("backToLobby").disabled=!self?.host;$("backToLobby").textContent=self?.host?"რემატჩი — ლობიში დაბრუნება":"ველოდებით მასპინძელს…";$("resultModal").showModal()});
socket.on("error-message",msg=>{$("formError").textContent=msg;toast(msg)});
socket.on("disconnect",()=>{if(state.room)toast("კავშირი გაწყდა — ვცდილობთ დაბრუნებას...")});
socket.on("connect",()=>{
  socket.emit("list-rooms");
  const pathCode=location.pathname.match(/^\/room\/([A-Z2-9]{5})$/i)?.[1]?.toUpperCase(),saved=localStorage.getItem("ss-room"),token=localStorage.getItem("ss-token");
  if(pathCode&&saved===pathCode&&token)socket.emit("reconnect-room",{code:pathCode,token});
  else if(pathCode&&!state.room)openEntry("join",pathCode)
});
window.addEventListener("popstate",()=>{if(location.pathname==="/"&&!state.room){showScreen("landing");socket.emit("list-rooms")}});
syncSettings();refreshRejoin();socket.connect();
