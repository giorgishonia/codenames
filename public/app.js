const socket = io({autoConnect:false,reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:800});
const $ = (id) => document.getElementById(id);
const screens = ["landing","lobby","game"];
const state = {room:null,selfId:null,mode:"create",sound:localStorage.getItem("ss-sound")!=="off",lastPhase:null,lastRevealed:0};
const avatarPos = ["0% 0%","33.333% 0%","66.666% 0%","100% 0%","0% 100%","33.333% 100%","66.666% 100%","100% 100%"];
let audioCtx;

function showScreen(name){screens.forEach(id=>$(id).classList.toggle("hidden",id!==name));}
function toast(text){$("toast").textContent=text;$("toast").classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>$("toast").classList.remove("show"),2400);}
function sound(type){
  if(!state.sound)return;
  audioCtx ||= new (window.AudioContext||window.webkitAudioContext)();
  const now=audioCtx.currentTime, gain=audioCtx.createGain();gain.connect(audioCtx.destination);
  const notes=type==="reveal"?[220,330]:type==="clue"?[523,659]:type==="win"?[392,523,659]:type==="lose"?[220,185]:[440];
  notes.forEach((freq,i)=>{const o=audioCtx.createOscillator();o.type=type==="reveal"?"triangle":"sine";o.frequency.value=freq;o.connect(gain);o.start(now+i*.11);o.stop(now+i*.11+.18)});
  gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.09,now+.025);gain.gain.exponentialRampToValueAtTime(.0001,now+notes.length*.11+.2);
}
function syncSoundUI(){[$("soundBtn"),$("gameSoundBtn")].forEach(b=>{b.textContent=state.sound?"♫":"♩";b.classList.toggle("muted",!state.sound)})}
function toggleSound(){state.sound=!state.sound;localStorage.setItem("ss-sound",state.sound?"on":"off");syncSoundUI();sound("click")}
function openEntry(mode){state.mode=mode;$("modalTitle").textContent=mode==="create"?"ახალი ოთახი":"ოთახში შესვლა";$("modalSubtitle").textContent=mode==="create"?"შეარჩიე აგენტის სახელი.":"შეიყვანე მეგობრისგან მიღებული კოდი.";$("codeWrap").hidden=mode==="create";$("codeInput").required=mode==="join";$("formError").textContent="";$("entryModal").showModal();setTimeout(()=>$("nameInput").focus(),50)}
function connectAnd(event,payload){if(!socket.connected)socket.connect();socket.once("connect",()=>socket.emit(event,payload));if(socket.connected)socket.emit(event,payload)}
function enter(e){e.preventDefault();const name=$("nameInput").value.trim(),code=$("codeInput").value.trim().toUpperCase();if(name.length<2)return $("formError").textContent="სახელი მინიმუმ 2 სიმბოლო უნდა იყოს.";const payload={name,reconnectToken:localStorage.getItem("ss-token")};if(state.mode==="join"){if(code.length!==5)return $("formError").textContent="შეიყვანე 5-ნიშნა ოთახის კოდი.";payload.code=code}connectAnd(state.mode==="create"?"create-room":"join-room",payload)}
function avatar(index,extra=""){return `<span class="agent-avatar ${extra}" style="background-position:${avatarPos[index%8]}"></span>`}
function chip(p){return `<span class="agent-chip ${p.id===state.selfId?"me":""}">${avatar(p.avatar)}<span>${esc(p.name)}${p.host?' <i class="host">★</i>':""}</span></span>`}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function players(team,role){return state.room.players.filter(p=>p.team===team&&p.role===role)}
function renderLobby(){
  const r=state.room;$("lobbyCode").textContent=r.code;
  ["blue","red"].forEach(team=>{
    const sm=players(team,"spymaster"),ops=players(team,"operative");
    $(`${team}Spymaster`).innerHTML=sm.length?sm.map(chip).join(""):'<span class="empty-slot">ადგილი თავისუფალია</span>';
    $(`${team}Operatives`).innerHTML=ops.length?ops.map(chip).join(""):'<span class="empty-slot">ჯერ არავინ არის</span>';
    $(`${team}Count`).textContent=sm.length+ops.length;
  });
  document.querySelectorAll("[data-join]").forEach(btn=>{const [team,role]=btn.dataset.join.split(":");const occupied=role==="spymaster"&&players(team,role).length;btn.disabled=!!occupied&&!players(team,role).some(p=>p.id===state.selfId);btn.textContent=players(team,role).some(p=>p.id===state.selfId)?"შენი ადგილი":role==="spymaster"?"ადგილის დაკავება":"გუნდში შესვლა"});
  const self=r.players.find(p=>p.id===state.selfId),can=r.canStart;
  $("startGame").classList.toggle("hidden",!self?.host);$("startGame").disabled=!can;
  $("lobbyHint").textContent=can?(self?.host?"ყველაფერი მზადაა — დაიწყე ოპერაცია!":"ველოდებით მასპინძელს..."):"მინიმუმ 4 მოთამაშე და 2 ხელმძღვანელია საჭირო";
}
function renderTeam(team,target){$(target).innerHTML=state.room.players.filter(p=>p.team===team).map(p=>`<div class="game-player ${p.connected?"":"offline"}">${avatar(p.avatar)}<span>${esc(p.name)}<small>${p.role==="spymaster"?"ხელმძღვანელი":"ოპერატივი"}${p.connected?"":" · გათიშულია"}</small></span></div>`).join("")}
function renderGame(){
  const r=state.room,g=r.game,self=r.players.find(p=>p.id===state.selfId),isSpy=self?.role==="spymaster";
  $("turnText").textContent=`${g.turn==="blue"?"ლურჯების":"წითლების"} სვლაა`;$("turnDot").style.background=g.turn==="blue"?"#25a9d3":"#e55a4c";
  $("phaseText").textContent=g.phase==="clue"?"ხელმძღვანელი ფიქრობს...":"ოპერატივები არჩევენ";
  $("blueScore").textContent=g.remaining.blue;$("redScore").textContent=g.remaining.red;
  renderTeam("blue","blueTeamGame");renderTeam("red","redTeamGame");
  $("board").innerHTML=g.board.map((c,i)=>{
    const canSee=isSpy||c.revealed,cls=c.revealed?c.type:(isSpy?`key-${c.type}`:""),pos=avatarPos[(i+2)%8];
    return `<button class="card ${c.revealed?"revealed":""} ${cls}" data-card="${i}" style="--portrait-pos:${pos}" ${c.revealed||g.phase!=="guess"||self?.team!==g.turn||self?.role!=="operative"?"disabled":""}><span class="card-word">${esc(c.word)}</span></button>`
  }).join("");
  const hasClue=!!g.clue;$("clueBanner").classList.toggle("hidden",!hasClue);if(hasClue){$("clueWord").textContent=g.clue.word;$("clueNumber").textContent=g.clue.count===99?"∞":g.clue.count}
  const myTurn=self?.team===g.turn;$("clueForm").classList.toggle("hidden",!(isSpy&&myTurn&&g.phase==="clue"));
  $("guessControls").classList.toggle("hidden",!(self?.role==="operative"&&myTurn&&g.phase==="guess"));
  $("waitingControl").classList.toggle("hidden",(isSpy&&myTurn&&g.phase==="clue")||(self?.role==="operative"&&myTurn&&g.phase==="guess"));
  $("guessesLeft").textContent=g.guessesLeft===99?"∞":g.guessesLeft;
  $("gameLog").innerHTML=g.log.slice(-12).reverse().map(x=>`<div class="log-entry"><b>${esc(x.actor||"სისტემა")}</b> ${esc(x.text)}</div>`).join("");
  const revealed=g.board.filter(c=>c.revealed).length;if(revealed>state.lastRevealed)sound("reveal");if(state.lastPhase==="clue"&&g.phase==="guess")sound("clue");state.lastRevealed=revealed;state.lastPhase=g.phase;
}
function applyRoom(room){
  state.room=room;state.selfId=room.selfId||state.selfId;
  if(room.game){showScreen("game");renderGame()}else{showScreen("lobby");renderLobby()}
}
function leave(){localStorage.removeItem("ss-room");socket.emit("leave-room");state.room=null;showScreen("landing")}

$("openCreate").onclick=()=>openEntry("create");$("openJoin").onclick=()=>openEntry("join");$("entryForm").onsubmit=enter;$("soundBtn").onclick=toggleSound;$("gameSoundBtn").onclick=toggleSound;
$("copyCode").onclick=async()=>{await navigator.clipboard.writeText(state.room.code);toast("ოთახის კოდი დაკოპირდა")};
$("leaveLobby").onclick=leave;$("rulesBtn").onclick=()=>$("rulesModal").showModal();
document.querySelectorAll("[data-join]").forEach(btn=>btn.onclick=()=>{const [team,role]=btn.dataset.join.split(":");socket.emit("choose-role",{team,role})});
$("startGame").onclick=()=>socket.emit("start-game");
$("clueForm").onsubmit=e=>{e.preventDefault();socket.emit("give-clue",{word:$("clueInput").value.trim(),count:Number($("clueCount").value)});$("clueInput").value=""};
$("board").onclick=e=>{const card=e.target.closest("[data-card]");if(card)socket.emit("guess-card",{index:Number(card.dataset.card)})};
$("endTurn").onclick=()=>socket.emit("end-turn");$("backToLobby").onclick=()=>{socket.emit("back-to-lobby");$("resultModal").close()};
for(let i=1;i<=9;i++)$("clueCount").insertAdjacentHTML("beforeend",`<option value="${i}">${i}</option>`);$("clueCount").insertAdjacentHTML("beforeend",'<option value="99">∞</option>');

socket.on("room-joined",({room,token,selfId})=>{localStorage.setItem("ss-token",token);localStorage.setItem("ss-room",room.code);state.selfId=selfId;$("entryModal").close();applyRoom(room);sound("clue")});
socket.on("room-state",applyRoom);
socket.on("game-over",({winner,reason})=>{sound(winner===state.room?.players.find(p=>p.id===state.selfId)?.team?"win":"lose");$("resultSeal").classList.toggle("red",winner==="red");$("resultTitle").textContent=`${winner==="blue"?"ლურჯებმა":"წითლებმა"} გაიმარჯვეს!`;$("resultText").textContent=reason;$("resultModal").showModal()});
socket.on("error-message",msg=>{$("formError").textContent=msg;toast(msg)});
socket.on("disconnect",()=>{if(state.room)toast("კავშირი გაწყდა — ვცდილობთ დაბრუნებას...")});
socket.on("connect",()=>{const code=localStorage.getItem("ss-room"),token=localStorage.getItem("ss-token");if(code&&token&&!state.room)socket.emit("reconnect-room",{code,token});else if(state.room)socket.emit("reconnect-room",{code:state.room.code,token})});
syncSoundUI();
const savedRoom=localStorage.getItem("ss-room"),savedToken=localStorage.getItem("ss-token");if(savedRoom&&savedToken){socket.connect()}
