function realtimeSocket(){
  const handlers=new Map();let clientId=null,retry=null,active=false,polling=false;
  const dispatch=(event,data)=>(handlers.get(event)||[]).slice().forEach(fn=>fn(data));
  const poll=async()=>{
    if(!active||!clientId||polling)return;polling=true;
    try{
      const response=await fetch(`/api/v2/poll?client=${encodeURIComponent(clientId)}`,{cache:"no-store"});
      if(!response.ok)throw new Error("poll");
      const messages=await response.json();messages.forEach(message=>dispatch(message.event,message.data))
    }catch{
      if(api.connected){api.connected=false;dispatch("disconnect")}
    }finally{
      polling=false;if(active)retry=setTimeout(poll,350)
    }
  };
  const api={
    connected:false,
    on(event,fn){handlers.set(event,[...(handlers.get(event)||[]),fn]);return api},
    once(event,fn){const wrapped=data=>{api.off(event,wrapped);fn(data)};return api.on(event,wrapped)},
    off(event,fn){handlers.set(event,(handlers.get(event)||[]).filter(item=>item!==fn));return api},
    emit(event,data){
      if(clientId)fetch("/api/v2/event",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({clientId,event,data})})
        .then(async response=>{if(!response.ok)throw new Error("event");const messages=await response.json();messages.forEach(message=>dispatch(message.event,message.data))})
        .catch(()=>{});
      return api
    },
    async connect(){
      if(api.connected)return api;
      active=true;clearTimeout(retry);
      try{
        const response=await fetch("/api/v2/connect",{method:"POST"});
        if(!response.ok)throw new Error("connect");
        clientId=(await response.json()).clientId;api.connected=true;dispatch("connect");poll()
      }catch{retry=setTimeout(()=>api.connect(),900)}
      return api
    },
    disconnect(){active=false;clearTimeout(retry);clientId=null;api.connected=false;return api}
  };
  return api
}
const socket=globalThis.io
  ? globalThis.io({autoConnect:false})
  : realtimeSocket();
const $=id=>document.getElementById(id);
const screens=["landing","lobby","game"];
const state={room:null,selfId:null,mode:"create",sound:localStorage.getItem("ss-sound")!=="off",compact:localStorage.getItem("ss-compact")==="on",rooms:[],filter:"all",lastPhase:null,lastRevealed:0,cluePicks:new Set(),cluePickKey:""};
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
  const savedName=localStorage.getItem("ss-name")?.trim();
  if(mode==="join"&&savedName?.length>=2&&prefill.length===5){
    const reconnectToken=localStorage.getItem("ss-token"),savedRoom=localStorage.getItem("ss-room");
    connectAnd(reconnectToken&&savedRoom===prefill?"reconnect-room":"join-room",{name:savedName,code:prefill,reconnectToken,token:reconnectToken});
    return
  }
  state.mode=mode;state.joinCode=prefill;
  $("modalTitle").textContent=mode==="create"?"ახალი ოთახი":"ოთახში შესვლა";
  $("modalSubtitle").textContent=mode==="create"?"დაარქვი ოპერაციას სახელი.":"შეიყვანე შენი სახელი — შემდეგ ჯერზე დაგიმახსოვრებთ.";
  $("roomNameWrap").hidden=mode!=="create";$("nameWrap").hidden=mode==="create";$("visibilityWrap").hidden=true;
  $("roomNameInput").required=mode==="create";$("nameInput").required=mode==="join";
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
function avatar(index,extra=""){return`<span class="agent-avatar ${extra}" style="background-image:url('/cards/neutral-${Number(index)%10}.webp')"></span>`}
function offlineStatus(p){return p.connected?"":'<span class="wifi-off" role="img" aria-label="გათიშულია" title="კავშირი გაწყვეტილია"></span>'}
function adminControls(p){
  const self=state.room?.players.find(player=>player.id===state.selfId);
  if(!self?.host||p.id===state.selfId)return"";
  return`<span class="player-admin"><button type="button" data-player-action="promote" data-player-id="${p.id}" title="მასპინძლად დანიშვნა" aria-label="${esc(p.name)} — მასპინძლად დანიშვნა">♛</button><button type="button" data-player-action="kick" data-player-id="${p.id}" title="ოთახიდან გაშვება" aria-label="${esc(p.name)} — ოთახიდან გაშვება">↗</button><button type="button" data-player-action="ban" data-player-id="${p.id}" title="დაბლოკვა" aria-label="${esc(p.name)} — დაბლოკვა">⊘</button></span>`
}
function chip(p){return`<span class="agent-chip ${p.id===state.selfId?"me":""} ${p.connected?"":"offline"}">${avatar(p.avatar)}<span>${esc(p.name)}${p.host?' <i class="host">★</i>':""}</span>${offlineStatus(p)}${adminControls(p)}</span>`}
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
  const selected=new Set(r.wordCategories||[]),packLabels=(r.wordCategoryOptions||[]).filter(pack=>selected.has(pack.id)).map(pack=>pack.label);
  $("activeWordPacks").innerHTML=`<b>სიტყვები</b><span>${packLabels.length===r.wordCategoryOptions?.length?"ყველა კატეგორია":packLabels.map(esc).join(" · ")}</span>`;
  ["blue","red"].forEach(team=>{
    const sm=players(team,"spymaster"),ops=players(team,"operative");
    $(`${team}Spymaster`).innerHTML=sm.length?sm.map(chip).join(""):'<span class="empty-slot">ადგილი თავისუფალია</span>';
    $(`${team}Operatives`).innerHTML=ops.length?ops.map(chip).join(""):'<span class="empty-slot">ჯერ არავინ არის</span>';
    $(`${team}Count`).textContent=sm.length+ops.length
  });
  $("waitingRoster").innerHTML=r.players.filter(p=>!p.team).map(chip).join("");
  document.querySelectorAll("[data-join]").forEach(btn=>{const[team,role]=btn.dataset.join.split(":");btn.disabled=false;btn.textContent=players(team,role).some(p=>p.id===state.selfId)?"შენი ადგილი":role==="spymaster"?"ხელმძღვანელად შესვლა":"გუნდში შესვლა"});
  $("quickTeam").classList.toggle("hidden",!self?.host);
  $("startGame").classList.toggle("hidden",!self?.host);$("startGame").disabled=!r.canStart;$("roomSettingsBtn").classList.toggle("hidden",!self?.host);
  $("lobbyHint").textContent=r.canStart?(self?.host?"ყველაფერი მზადაა — დაიწყე ოპერაცია!":"ველოდებით მასპინძელს..."):"მინიმუმ 4 მოთამაშე და 2 ხელმძღვანელია საჭირო"
}
function gamePlayer(p){return`<div class="game-player ${p.connected?"":"offline"}">${avatar(p.avatar)}<span>${esc(p.name)}<small>${p.role==="spymaster"?"ხელმძღვანელი":"ოპერატივი"}${p.connected?"":" · გათიშულია"}</small></span>${offlineStatus(p)}</div>`}
function renderTeam(team,target){
  const group=(role,label)=>{const list=players(team,role);return`<div class="roster-group"><h4>${label}</h4><div class="roster-row">${list.length?list.map(gamePlayer).join(""):'<span class="empty-slot">ცარიელია</span>'}</div></div>`};
  $(target).innerHTML=group("operative","ოპერატივები")+group("spymaster","ხელმძღვანელები")
}
function cardMarks(picks){
  if(!picks.length)return"";
  const shown=picks.slice(0,4),extra=picks.length-shown.length;
  const marks=shown.map(v=>`<span class="card-mark ${v.team||""}" title="${esc(v.name)}">${avatar(v.avatar)}<b>${esc(v.name)}</b></span>`).join("");
  return`<span class="card-marks ${picks.length>2?"dense":""}">${marks}${extra>0?`<span class="card-mark more">+${extra}</span>`:""}</span>`
}
function updateClueSelection(){
  const count=state.cluePicks.size;
  $("clueSelectionCount").textContent=count;
  $("giveClueButton").disabled=count<1
}
function fitMobileCardWords(){
  cancelAnimationFrame(state.wordFitFrame);
  state.wordFitFrame=requestAnimationFrame(()=>{
    const mobile=matchMedia("(max-width:640px)").matches;
    document.querySelectorAll("#board .card-word").forEach(word=>{
      word.style.fontSize="";
      if(!mobile)return;
      let size=10;
      while(word.scrollWidth>word.clientWidth&&size>5){size-=.5;word.style.fontSize=`${size}px`}
    })
  })
}
function renderBoard(g,self,over){
  const board=$("board"),fingerprint=g.board.map(c=>c.word).join("\u0001"),isSpy=self?.role==="spymaster";
  if(board.dataset.fingerprint!==fingerprint||board.children.length!==g.board.length){
    board.innerHTML=g.board.map((c,i)=>`<button class="card" data-card="${i}">${c.art?`<img class="card-art" src="/cards/${esc(c.art)}" alt="">`:`<img class="card-art card-placeholder-art" src="/cards/neutral-${i%10}.webp" alt="">`}<span class="card-word">${esc(c.word)}</span></button>`).join("");
    board.dataset.fingerprint=fingerprint
  }
  g.board.forEach((c,i)=>{
    const button=board.children[i],open=c.revealed||over&&!!c.type,cls=open?c.type:(c.type?`key-${c.type}`:""),picks=(g.picks||[]).filter(v=>v.index===i);
    const tracked=button.dataset.revealed!==undefined,wasRevealed=button.dataset.revealed==="true",justRevealed=tracked&&!wasRevealed&&c.revealed&&!isSpy;
    const clueTarget=state.cluePicks.has(i);
    const className=`card ${open?"revealed":""} ${justRevealed?"reveal-anim":""} ${isSpy&&c.revealed?"spymaster-revealed":""} ${clueTarget?"clue-target":""} ${picks.length?"selected":""} ${cls}`.replace(/\s+/g," ").trim();
    if(button.className!==className)button.className=className;
    const canChoose=!c.revealed&&!over&&g.phase==="guess"&&self?.team===g.turn&&self?.role==="operative";
    const canChooseClue=!c.revealed&&!over&&g.phase==="clue"&&self?.team===g.turn&&c.type===self.team&&isSpy;
    button.disabled=!(canChoose||canChooseClue);
    button.dataset.revealed=String(!!c.revealed);
    let art=button.querySelector(".card-art");
    if(c.art&&art?.dataset.art!==c.art){
      if(!art){button.insertAdjacentHTML("afterbegin",`<img class="card-art" src="/cards/${esc(c.art)}" alt="">`);art=button.querySelector(".card-art")}
      else art.src=`/cards/${c.art}`;
      art.dataset.art=c.art;art.classList.remove("card-placeholder-art")
    }
    const picksKey=JSON.stringify([canChoose,picks.map(v=>[v.playerId,v.name,v.avatar,v.team])]);
    if(button.dataset.picks!==picksKey){
      button.querySelector(".card-marks")?.remove();
      button.querySelector(".card-confirm")?.remove();
      const marks=cardMarks(picks);if(marks)button.insertAdjacentHTML("afterbegin",marks);
      if(picks.length&&canChoose)button.insertAdjacentHTML("beforeend",'<span class="card-confirm" aria-hidden="true">✓</span>');
      button.dataset.picks=picksKey
    }
  });
  fitMobileCardWords()
}
function renderChat(self){
  const chat=state.room.chat||[];$("roomChat").innerHTML=chat.slice(-20).map(m=>`<div class="chat-message ${m.playerId===state.selfId?"mine":""}"><b>${esc(m.actor)}${m.team?` · ${m.team==="blue"?"ლურჯი":"წითელი"}`:""}</b>${esc(m.text)}</div>`).join("");
  $("roomChat").scrollTop=$("roomChat").scrollHeight;
  const blocked=self?.role==="spymaster";$("chatInput").disabled=blocked;$("chatForm").querySelector("button").disabled=blocked;$("chatHint").textContent=blocked?"ხელმძღვანელი თამაშის დროს ჩუმად უნდა იყოს.":"საუბარი ოთახის ყველა მოთამაშეს ესმის."
}
function renderGame(){
  const g=state.room.game,self=state.room.players.find(p=>p.id===state.selfId),isSpy=self?.role==="spymaster",over=!!g.winner;
  $("turnText").textContent=`${g.turn==="blue"?"ლურჯების":"წითლების"} სვლაა`;$("turnDot").style.background=g.turn==="blue"?"#25a9d3":"#e55a4c";
  updatePhaseTimer();$("blueScore").textContent=g.remaining.blue;$("redScore").textContent=g.remaining.red;
  $("blueProgress").style.width=`${100-(g.remaining.blue/(g.total?.blue||9))*100}%`;$("redProgress").style.width=`${100-(g.remaining.red/(g.total?.red||9))*100}%`;
  const myTurn=self?.team===g.turn,clueTurn=!over&&isSpy&&self?.team===g.turn&&g.phase==="clue",roleTitle=!self?.team?"დამკვირვებელი":isSpy?"ხელმძღვანელი":self.role==="operative"?"ოპერატივი":"დამკვირვებელი";
  const cluePickKey=clueTurn?`${state.room.code}:${g.round}:${g.turn}`:"";
  if(state.cluePickKey!==cluePickKey){state.cluePicks.clear();state.cluePickKey=cluePickKey}
  const roleText=over?"ოპერაცია დასრულდა — სრული რუკა ღიაა":!self?.team?"თვალი ადევნე ოპერაციას":myTurn?(isSpy&&g.phase==="clue"?"მონიშნე ბარათები და დაწერე მინიშნება":self.role==="operative"&&g.phase==="guess"?"მონიშნე და დაადასტურე ბარათი":"დაელოდე შენს გუნდს"):"მეტოქის სვლაა";
  $("roleBanner").className=`role-banner ${self?.team||""}`;$("roleBanner").innerHTML=`<b>${roleTitle}</b><span>${roleText}</span>`;
  renderTeam("blue","blueTeamGame");renderTeam("red","redTeamGame");
  renderBoard(g,self,over);
  updateClueSelection();
  $("clueBanner").classList.toggle("hidden",!g.clue);if(g.clue){$("clueWord").textContent=g.clue.word;$("clueNumber").textContent=g.clue.count===99?"∞":g.clue.count}
  const guessTurn=!over&&self?.role==="operative"&&myTurn&&g.phase==="guess";
  $("clueForm").classList.toggle("hidden",!clueTurn);$("guessControls").classList.toggle("hidden",!guessTurn);$("waitingControl").classList.toggle("hidden",over||clueTurn||guessTurn);
  $("gameOverControls").classList.toggle("hidden",!over);
  if(over){$("gameOverText").textContent=`${g.winner==="blue"?"ლურჯებმა":"წითლებმა"} გაიმარჯვეს — ყველა ბარათი გახსნილია`;$("rematchBtn").classList.toggle("hidden",!self?.host)}
  $("guessPrompt").innerHTML=`მონიშნეთ ერთი ან რამდენიმე ბარათი და დააჭირეთ მწვანე ✓-ს — დარჩა <b id="guessesLeft">${g.guessesLeft===99?"∞":g.guessesLeft}</b> ცდა`;
  $("gameLog").innerHTML=g.log.slice(-12).reverse().map(x=>`<div class="log-entry"><b>${esc(x.actor||"სისტემა")}</b> ${esc(x.text)}</div>`).join("");
  renderChat(self);
  const revealed=g.board.filter(c=>c.revealed).length;if(revealed>state.lastRevealed)sound("reveal");if(state.lastPhase==="clue"&&g.phase==="guess")sound("clue");state.lastRevealed=revealed;state.lastPhase=g.phase
}
function updatePhaseTimer(){
  const g=state.room?.game;if(!g)return;
  const label=g.phase==="clue"?"ხელმძღვანელი ფიქრობს":"ოპერატივები არჩევენ",deadline=Math.min(g.phaseDeadline||Infinity,g.roundDeadline||Infinity);
  const seconds=Number.isFinite(deadline)?Math.max(0,Math.ceil((deadline-Date.now())/1000)):0,clock=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,"0")}`;
  $("phaseText").textContent=`რაუნდი ${g.round||1} · ${label} · ${clock}`;
  $("mobileTimerClock").textContent=clock
}
function applyRoom(room){
  state.room=room;state.selfId=room.selfId||state.selfId;if(!room.game?.winner)state.resultKey=null;
  localStorage.setItem("ss-last-room",JSON.stringify({code:room.code,name:room.name}));history.replaceState({}, "",`/room/${room.code}`);
  if(room.game){showScreen("game");renderGame()}else{if($("resultModal").open)$("resultModal").close();showScreen("lobby");renderLobby()}
}
function leave(){
  socket.emit("leave-room");state.room=null;state.selfId=null;localStorage.removeItem("ss-room");localStorage.removeItem("ss-token");localStorage.removeItem("ss-last-room");
  history.pushState({},"","/");document.title="საიდუმლო სიტყვა";showScreen("landing");refreshRejoin();socket.emit("list-rooms")
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
$("leaveLobby").onclick=leave;
$("roomSettingsBtn").onclick=()=>{
  const settings=state.room.settings||{},selected=new Set(state.room.wordCategories||[]);
  $("editRoomName").value=state.room.name;$("editRoomPublic").checked=state.room.isPublic;$("editClueTime").value=settings.clueTime||90;$("editGuessTime").value=settings.guessTime||120;$("editRoundTime").value=settings.roundTime||240;
  $("wordCategoryError").textContent="";
  $("wordCategoryOptions").innerHTML=(state.room.wordCategoryOptions||[]).map(pack=>`<label class="word-category"><input type="checkbox" name="wordCategory" value="${esc(pack.id)}" ${selected.has(pack.id)?"checked":""}><span><b>${esc(pack.label)}</b><small>${esc(pack.description)} · ${pack.count} სიტყვა</small></span></label>`).join("");
  $("roomSettingsModal").showModal()
};
$("roomSettingsForm").onsubmit=e=>{
  e.preventDefault();
  const wordCategories=[...document.querySelectorAll('input[name="wordCategory"]:checked')].map(input=>input.value);
  if(!wordCategories.length){$("wordCategoryError").textContent="მინიმუმ ერთი კატეგორია აირჩიე.";$("wordCategoryOptions").scrollIntoView({behavior:"smooth",block:"nearest"});return}
  socket.emit("update-room-settings",{name:$("editRoomName").value.trim(),isPublic:$("editRoomPublic").checked,wordCategories,settings:{clueTime:Number($("editClueTime").value),guessTime:Number($("editGuessTime").value),roundTime:Number($("editRoundTime").value)}});
  $("roomSettingsModal").close()
};
document.addEventListener("click",e=>{const button=e.target.closest?.("[data-player-action]");if(!button)return;e.preventDefault();e.stopPropagation();const action=button.dataset.playerAction,player=state.room?.players.find(p=>p.id===button.dataset.playerId);if(!player)return;if(action!=="promote"&&!confirm(`${player.name} — ნამდვილად გინდა ${action==="ban"?"დაბლოკვა":"ოთახიდან გაშვება"}?`))return;button.disabled=true;socket.emit("moderate-player",{action,playerId:player.id})});
document.querySelectorAll("[data-join]").forEach(btn=>btn.onclick=()=>{const[team,role]=btn.dataset.join.split(":");socket.emit("choose-role",{team,role})});
$("quickTeam").onclick=()=>socket.emit("quick-role",{mode:"auto"});$("observeGame").onclick=()=>socket.emit("quick-role",{mode:"observer"});
$("startGame").onclick=()=>socket.emit("start-game");
$("clueForm").onsubmit=e=>{
  e.preventDefault();
  const count=state.cluePicks.size;if(count<1)return toast("მინიმუმ ერთი ბარათი მონიშნე");
  socket.emit("give-clue",{word:$("clueInput").value.trim(),count});
  $("clueInput").value="";state.cluePicks.clear();
  const self=state.room.players.find(p=>p.id===state.selfId);renderBoard(state.room.game,self,false);updateClueSelection()
};
$("board").onclick=e=>{
  const card=e.target.closest("[data-card]");if(!card)return;
  const index=Number(card.dataset.card),g=state.room?.game,self=state.room?.players.find(p=>p.id===state.selfId);
  if(g&&!g.winner&&g.phase==="clue"&&self?.role==="spymaster"&&self.team===g.turn&&g.board[index]?.type===self.team&&!g.board[index]?.revealed){
    if(state.cluePicks.has(index))state.cluePicks.delete(index);else state.cluePicks.add(index);
    renderBoard(g,self,false);updateClueSelection();return
  }
  socket.emit(e.target.closest(".card-confirm")?"confirm-card":"suggest-card",{index})
};
$("endTurn").onclick=()=>socket.emit("end-turn");
$("backToLobby").onclick=$("rematchBtn").onclick=()=>{clearTimeout(state.resultTimer);socket.emit("back-to-lobby");$("resultModal").close()};
$("resultModal").onclick=e=>{if(e.target===$("resultModal")){clearTimeout(state.resultTimer);$("resultModal").close()}};
$("chatForm").onsubmit=e=>{e.preventDefault();const text=$("chatInput").value.trim();if(text){socket.emit("send-chat",{text});$("chatInput").value=""}};

socket.on("lobby-list",rooms=>{state.rooms=rooms.filter(room=>room.players>0);renderPublicRooms()});
socket.on("room-joined",({room,token,selfId})=>{localStorage.setItem("ss-token",token);localStorage.setItem("ss-room",room.code);state.selfId=selfId;$("entryModal").close();applyRoom(room);sound("clue")});
socket.on("room-state",applyRoom);
socket.on("game-over",({winner,reason})=>{
  const self=state.room?.players.find(p=>p.id===state.selfId),key=`${state.room?.code||""}:${winner}`;
  if(state.resultKey===key)return;state.resultKey=key;
  sound(winner===self?.team?"win":"lose");
  $("resultSeal").classList.toggle("red",winner==="red");$("resultTitle").textContent=`${winner==="blue"?"ლურჯებმა":"წითლებმა"} გაიმარჯვეს!`;$("resultText").textContent=reason;
  $("backToLobby").disabled=!self?.host;$("backToLobby").textContent=self?.host?"რემატჩი — ლობიში დაბრუნება":"ველოდებით მასპინძელს…";
  $("resultModal").showModal();clearTimeout(state.resultTimer);state.resultTimer=setTimeout(()=>$("resultModal").close(),3400)
});
socket.on("error-message",msg=>{$("formError").textContent=msg;toast(msg)});
socket.on("moderation-result",({message})=>toast(message));
socket.on("disconnect",()=>{if(state.room)toast("კავშირი გაწყდა — ვცდილობთ დაბრუნებას...")});
socket.on("room-expired",()=>{
  state.room=null;state.selfId=null;localStorage.removeItem("ss-room");localStorage.removeItem("ss-token");localStorage.removeItem("ss-last-room");
  history.replaceState({},"","/");document.title="საიდუმლო სიტყვა";showScreen("landing");refreshRejoin();toast("ოთახი 5 წუთის უმოქმედობის გამო დაიხურა");socket.emit("list-rooms")
});
socket.on("removed-from-room",({reason})=>{
  state.room=null;state.selfId=null;localStorage.removeItem("ss-room");localStorage.removeItem("ss-token");localStorage.removeItem("ss-last-room");
  history.replaceState({},"","/");document.title="საიდუმლო სიტყვა";showScreen("landing");refreshRejoin();toast(reason||"ოთახიდან გამოხვედი");socket.emit("list-rooms")
});
socket.on("connect",()=>{
  socket.emit("list-rooms");
  const pathCode=location.pathname.match(/^\/room\/([A-Z2-9]{5})$/i)?.[1]?.toUpperCase(),saved=localStorage.getItem("ss-room"),token=localStorage.getItem("ss-token");
  if(pathCode&&saved===pathCode&&token)socket.emit("reconnect-room",{code:pathCode,token});
  else if(pathCode&&!state.room)openEntry("join",pathCode)
});
window.addEventListener("popstate",()=>{if(location.pathname==="/"&&!state.room){showScreen("landing");socket.emit("list-rooms")}});
window.addEventListener("resize",fitMobileCardWords);
setInterval(updatePhaseTimer,500);syncSettings();refreshRejoin();socket.connect();
