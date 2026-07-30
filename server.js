import express from "express";
import http from "node:http";
import crypto from "node:crypto";
import {Server} from "socket.io";
import path from "node:path";
import {fileURLToPath} from "node:url";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(),server=http.createServer(app),io=new Server(server,{pingTimeout:20000,pingInterval:10000});
const PORT=process.env.PORT||3000,rooms=new Map();
const WORDS=["მთა","ზღვა","მზე","მთვარე","ვარსკვლავი","წვიმა","ქარი","თოვლი","ღრუბელი","ტყე","მდინარე","ხიდი","კოშკი","სახლი","ქუჩა","ქალაქი","სოფელი","ბაღი","ყვავილი","ხე","ფოთოლი","ვაშლი","ღვინო","პური","ყავა","ჩაი","სუფრა","წიგნი","კალამი","წერილი","გასაღები","საათი","სარკე","ფანჯარა","კარი","სკამი","მაგიდა","ხალიჩა","ტელეფონი","რადიო","მატარებელი","გემი","თვითმფრინავი","მანქანა","ველოსიპედი","გზა","რუკა","კომპასი","ოქრო","ვერცხლი","ბრილიანტი","გვირგვინი","მეფე","დედოფალი","რაინდი","დრაკონი","მზვერავი","ნიღაბი","ჩრდილი","საიდუმლო","სიზმარი","სიმღერა","ცეკვა","თეატრი","კინო","სცენა","ფოტო","ფერი","ხმა","სინათლე","ცეცხლი","წყალი","ყინული","ქვა","ქვიშა","კუნძული","უდაბნო","ოკეანე","ნავსადგური","ბაზარი","მუზეუმი","სკოლა","ექიმი","მასწავლებელი","მზარეული","მფრინავი","მეკარე","ბურთი","ჭადრაკი","თასი","მედალი","ბილეთი","საჩუქარი","დღე","ღამე","გაზაფხული","ზაფხული","შემოდგომა","ზამთარი"];
const code=()=>{let s="";const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";do{s=Array.from({length:5},()=>chars[crypto.randomInt(chars.length)]).join("")}while(rooms.has(s));return s};
const token=()=>crypto.randomBytes(18).toString("base64url");
const clean=(v,n=24)=>String(v??"").replace(/[<>]/g,"").trim().slice(0,n);
const shuffle=a=>{a=[...a];for(let i=a.length-1;i;i--){const j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};
const publicRoom=(room,selfId)=>{
  const viewer=room.players.find(p=>p.id===selfId),canSeeKey=viewer?.role==="spymaster";
  const game=room.game?{...room.game,board:room.game.board.map(c=>c.revealed||canSeeKey?c:{word:c.word,revealed:false,type:null})}:null;
  return{code:room.code,name:room.name,isPublic:room.isPublic,selfId,hostId:room.hostId,canStart:canStart(room),players:room.players.map(({token,removeTimer,...p})=>p),game};
};
const canStart=r=>r.players.filter(p=>p.connected).length>=4&&["blue","red"].every(t=>r.players.some(p=>p.connected&&p.team===t&&p.role==="spymaster")&&r.players.some(p=>p.connected&&p.team===t&&p.role==="operative"));
const lobbyList=()=>[...rooms.values()].filter(r=>r.isPublic).map(r=>({code:r.code,name:r.name,status:r.game?"playing":"waiting",players:r.players.filter(p=>p.connected).length,avatars:r.players.filter(p=>p.connected).slice(0,4).map(p=>p.avatar),createdAt:r.createdAt})).sort((a,b)=>b.createdAt-a.createdAt);
function broadcastLobbyList(){io.emit("lobby-list",lobbyList())}
function emitRoom(room){for(const p of room.players)if(p.socketId)io.to(p.socketId).emit("room-state",publicRoom(room,p.id))}
function findPlayer(socket){const room=rooms.get(socket.data.room);return room&&[room,room.players.find(p=>p.id===socket.data.player)]}
function newGame(){
  const first=crypto.randomInt(2)?"blue":"red",types=[...Array(first==="blue"?9:8).fill("blue"),...Array(first==="red"?9:8).fill("red"),...Array(7).fill("neutral"),"assassin"],words=shuffle(WORDS).slice(0,25);
  return{turn:first,phase:"clue",clue:null,guessesLeft:0,remaining:{blue:types.filter(x=>x==="blue").length,red:types.filter(x=>x==="red").length},board:shuffle(types).map((type,i)=>({word:words[i],type,revealed:false})),log:[{actor:"სისტემა",text:`${first==="blue"?"ლურჯი":"წითელი"} გუნდი იწყებს ოპერაციას.`}]}
}
function switchTurn(g){g.turn=g.turn==="blue"?"red":"blue";g.phase="clue";g.clue=null;g.guessesLeft=0;g.log.push({actor:"სისტემა",text:`ახლა ${g.turn==="blue"?"ლურჯების":"წითლების"} სვლაა.`})}
function win(room,winner,reason){room.game.winner=winner;emitRoom(room);io.to(room.code).emit("game-over",{winner,reason})}

app.use(express.static(path.join(__dirname,"public")));
app.use((req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
io.on("connection",socket=>{
  socket.emit("lobby-list",lobbyList());
  socket.on("list-rooms",()=>socket.emit("lobby-list",lobbyList()));
  socket.on("create-room",data=>{
    const name=clean(data?.name,18),roomName=clean(data?.roomName,28);if(name.length<2)return socket.emit("error-message","სახელი ძალიან მოკლეა.");if(roomName.length<2)return socket.emit("error-message","ოთახს სახელი სჭირდება.");
    const room={code:code(),name:roomName,isPublic:data?.isPublic!==false,hostId:null,players:[],game:null,createdAt:Date.now()},p={id:crypto.randomUUID(),token:token(),socketId:socket.id,name,avatar:crypto.randomInt(8),team:null,role:null,host:true,connected:true};
    room.hostId=p.id;room.players.push(p);rooms.set(room.code,room);socket.join(room.code);socket.data={room:room.code,player:p.id};socket.emit("room-joined",{room:publicRoom(room,p.id),token:p.token,selfId:p.id});broadcastLobbyList()
  });
  socket.on("join-room",data=>{
    const room=rooms.get(clean(data?.code,5).toUpperCase()),name=clean(data?.name,18);if(!room)return socket.emit("error-message","ასეთი ოთახი ვერ მოიძებნა.");if(name.length<2)return socket.emit("error-message","სახელი ძალიან მოკლეა.");if(room.game)return socket.emit("error-message","თამაში უკვე დაწყებულია.");
    const p={id:crypto.randomUUID(),token:token(),socketId:socket.id,name,avatar:room.players.length%8,team:null,role:null,host:false,connected:true};room.players.push(p);socket.join(room.code);socket.data={room:room.code,player:p.id};socket.emit("room-joined",{room:publicRoom(room,p.id),token:p.token,selfId:p.id});emitRoom(room);broadcastLobbyList()
  });
  socket.on("reconnect-room",data=>{
    const room=rooms.get(clean(data?.code,5).toUpperCase()),p=room?.players.find(x=>x.token===data?.token);if(!room||!p)return;
    p.socketId=socket.id;p.connected=true;clearTimeout(p.removeTimer);socket.join(room.code);socket.data={room:room.code,player:p.id};socket.emit("room-joined",{room:publicRoom(room,p.id),token:p.token,selfId:p.id});emitRoom(room);broadcastLobbyList()
  });
  socket.on("update-room-settings",data=>{
    const found=findPlayer(socket);if(!found)return;const[room,p]=found;if(!p.host)return;
    const name=clean(data?.name,28);if(name.length<2)return socket.emit("error-message","ოთახს სახელი სჭირდება.");
    room.name=name;room.isPublic=data?.isPublic!==false;emitRoom(room);broadcastLobbyList()
  });
  socket.on("choose-role",data=>{
    const found=findPlayer(socket);if(!found)return;const [room,p]=found,team=["blue","red"].includes(data?.team)&&data.team,role=["spymaster","operative"].includes(data?.role)&&data.role;if(!team||!role||room.game)return;
    if(role==="spymaster"&&room.players.some(x=>x.id!==p.id&&x.team===team&&x.role===role))return socket.emit("error-message","ამ გუნდს უკვე ჰყავს ხელმძღვანელი.");
    p.team=team;p.role=role;emitRoom(room);broadcastLobbyList()
  });
  socket.on("start-game",()=>{
    const found=findPlayer(socket);if(!found)return;const [room,p]=found;if(!p.host||!canStart(room))return socket.emit("error-message","გუნდები ჯერ მზად არ არიან.");
    room.game=newGame();emitRoom(room);broadcastLobbyList()
  });
  socket.on("give-clue",data=>{
    const found=findPlayer(socket);if(!found)return;const [room,p]=found,g=room.game,word=clean(data?.word,24).replace(/\s+/g,""),count=Number(data?.count);if(!g||g.winner||p.role!=="spymaster"||p.team!==g.turn||g.phase!=="clue")return;
    if(word.length<2||!([1,2,3,4,5,6,7,8,9,99].includes(count)))return socket.emit("error-message","მინიშნება და რაოდენობა გადაამოწმე.");
    if(g.board.some(c=>!c.revealed&&c.word.toLowerCase()===word.toLowerCase()))return socket.emit("error-message","დაფაზე არსებული სიტყვის გამოყენება არ შეიძლება.");
    g.clue={word,count};g.guessesLeft=count===99?99:count+1;g.phase="guess";g.log.push({actor:p.name,text:`მისცა მინიშნება „${word}“ · ${count===99?"∞":count}.`});emitRoom(room)
  });
  socket.on("guess-card",data=>{
    const found=findPlayer(socket);if(!found)return;const [room,p]=found,g=room.game,i=Number(data?.index),card=g?.board[i];if(!g||g.winner||p.role!=="operative"||p.team!==g.turn||g.phase!=="guess"||!card||card.revealed)return;
    card.revealed=true;g.log.push({actor:p.name,text:`გახსნა „${card.word}“ — ${card.type==="blue"?"ლურჯი":card.type==="red"?"წითელი":card.type==="neutral"?"ნეიტრალური":"შავი აგენტი"}.`});
    if(card.type==="assassin")return win(room,p.team==="blue"?"red":"blue","შავი აგენტი გაიხსნა — ოპერაცია ჩავარდა.");
    if(card.type==="blue"||card.type==="red"){g.remaining[card.type]--;if(g.remaining[card.type]===0)return win(room,card.type,"გუნდმა ყველა თავისი აგენტი იპოვა.")}
    if(card.type!==p.team)return switchTurn(g),emitRoom(room);
    if(g.guessesLeft!==99)g.guessesLeft--;if(g.guessesLeft===0)switchTurn(g);emitRoom(room)
  });
  socket.on("end-turn",()=>{const found=findPlayer(socket);if(!found)return;const [room,p]=found,g=room.game;if(g&&!g.winner&&p.role==="operative"&&p.team===g.turn&&g.phase==="guess"){switchTurn(g);emitRoom(room)}});
  socket.on("back-to-lobby",()=>{const found=findPlayer(socket);if(!found)return;const [room,p]=found;if(p.host){room.game=null;emitRoom(room);broadcastLobbyList()}});
  socket.on("leave-room",()=>disconnectPlayer(socket,true));
  socket.on("disconnect",()=>disconnectPlayer(socket,false))
});
function disconnectPlayer(socket,immediate){
  const found=findPlayer(socket);if(!found)return;const [room,p]=found;p.connected=false;p.socketId=null;
  const remove=()=>{const idx=room.players.findIndex(x=>x.id===p.id);if(idx<0||room.players[idx].connected)return;room.players.splice(idx,1);if(p.host&&room.players.length){room.players[0].host=true;room.hostId=room.players[0].id}if(!room.players.length)rooms.delete(room.code);else emitRoom(room);broadcastLobbyList()};
  if(immediate)remove();else p.removeTimer=setTimeout(remove,5*60*1000);emitRoom(room);broadcastLobbyList()
}
setInterval(()=>{const now=Date.now();for(const [key,r]of rooms)if(!r.players.some(p=>p.connected)&&now-r.createdAt>6*60*60*1000)rooms.delete(key)},30*60*1000).unref();
server.listen(PORT,()=>console.log(`საიდუმლო სიტყვა მზადაა: http://localhost:${PORT}`));
