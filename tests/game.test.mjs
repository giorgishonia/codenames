import test from "node:test";
import assert from "node:assert/strict";
import {io} from "socket.io-client";

const URL=process.env.TEST_URL||"http://localhost:3000";
const wait=(socket,event)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error(`Timeout: ${event}`)),4000);
  socket.once(event,data=>{clearTimeout(timer);resolve(data)});
});
const until=(socket,event,predicate)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.off(event,onEvent);reject(new Error(`Timeout waiting for ${event}`))},4000);
  const onEvent=data=>{if(predicate(data)){clearTimeout(timer);socket.off(event,onEvent);resolve(data)}};
  socket.on(event,onEvent);
});
const connect=()=>io(URL,{transports:["websocket"],forceNew:true});

test("საჯარო ლობი, 7 მოთამაშე, დაწყება და reconnect",async()=>{
  const clients=Array.from({length:7},connect);
  let returning;
  try{
    await Promise.all(clients.map(c=>wait(c,"connect")));
    const joined=wait(clients[0],"room-joined");
    const listed=until(clients[6],"lobby-list",rooms=>rooms.some(room=>room.name==="ტესტის ოპერაცია"));
    clients[0].emit("create-room",{name:"ნინო",roomName:"ტესტის ოპერაცია",isPublic:true});
    const host=await joined,code=host.room.code;
    assert.match(code,/^[A-Z2-9]{5}$/);
    assert.equal(host.room.name,"ტესტის ოპერაცია");
    assert.equal((await listed).find(room=>room.code===code).status,"waiting");

    const identities=[host];
    for(let i=1;i<clients.length;i++){
      const next=wait(clients[i],"room-joined");
      clients[i].emit("join-room",{code,name:`მოთამაშე ${i}`});
      identities.push(await next);
    }

    const autoAssigned=until(clients[4],"room-state",room=>room.players.find(player=>player.id===identities[4].selfId)?.role==="operative");
    clients[4].emit("quick-role",{mode:"auto"});
    assert.ok((await autoAssigned).players.find(player=>player.id===identities[4].selfId)?.team);

    const ready=until(clients[0],"room-state",room=>room.canStart);
    clients[0].emit("choose-role",{team:"blue",role:"spymaster"});
    clients[1].emit("choose-role",{team:"blue",role:"operative"});
    clients[2].emit("choose-role",{team:"red",role:"spymaster"});
    clients[3].emit("choose-role",{team:"red",role:"operative"});
    clients[4].emit("choose-role",{team:"blue",role:"operative"});
    clients[5].emit("choose-role",{team:"red",role:"operative"});
    clients[6].emit("choose-role",{team:"blue",role:"operative"});
    await ready;

    const gameState=until(clients[1],"room-state",room=>!!room.game);
    clients[0].emit("start-game");
    const started=await gameState;
    assert.equal(started.game.board.length,25);
    assert.equal(started.players.length,7);
    assert.equal(started.game.board.every(card=>card.type===null),true,"ოპერატივმა საიდუმლო რუკა არ უნდა მიიღოს");
    assert.equal(started.game.remaining.blue+started.game.remaining.red,17);

    const chatted=until(clients[0],"room-state",room=>room.chat?.some(message=>message.text==="მზად ვართ"));
    clients[1].emit("send-chat",{text:"მზად ვართ"});
    assert.equal((await chatted).chat.at(-1).actor,"მოთამაშე 1");

    const activeSpy=started.game.turn==="blue"?clients[0]:clients[2];
    const activeOperative=started.game.turn==="blue"?clients[1]:clients[3];
    const clueReady=until(activeOperative,"room-state",room=>room.game?.phase==="guess"&&room.game?.clue?.count===0);
    activeSpy.emit("give-clue",{word:"თავისუფლება",count:0});
    const zeroClue=await clueReady;
    assert.equal(zeroClue.game.guessesLeft,99,"მინიშნება 0 შეუზღუდავ ცდებს უნდა იძლეოდეს");

    const suggested=until(activeOperative,"room-state",room=>room.game?.pendingGuess?.index===0);
    activeOperative.emit("suggest-card",{index:0});
    const beforeConfirm=await suggested;
    assert.equal(beforeConfirm.game.board[0].revealed,false,"ერთი დაჭერა მხოლოდ მონიშვნაა");

    const contacted=until(activeOperative,"room-state",room=>room.game?.board[0]?.revealed);
    activeOperative.emit("guess-card");
    const afterConfirm=await contacted;
    assert.equal(afterConfirm.game.board[0].revealed,true,"დადასტურება ბარათს ხსნის");
    assert.match(afterConfirm.game.board[0].art,/\.webp$/);

    const reconnectToken=identities[1].token;
    clients[1].disconnect();
    returning=connect();
    await wait(returning,"connect");
    const restored=wait(returning,"room-joined");
    returning.emit("reconnect-room",{code,token:reconnectToken});
    const again=await restored;
    assert.equal(again.selfId,identities[1].selfId);
    assert.ok(again.room.game);
  }finally{
    returning?.disconnect();
    clients.forEach(c=>c.disconnect());
  }
});
