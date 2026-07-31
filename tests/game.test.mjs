import test from "node:test";
import assert from "node:assert/strict";
import {io} from "socket.io-client";
import {WORD_CATEGORY_OPTIONS,wordsForCategories} from "../shared/word-packs.js";

const URL=process.env.TEST_URL||"http://localhost:3000";
const wait=(socket,event)=>new Promise((resolve,reject)=>{
  if(event==="connect"&&socket.connected)return resolve();
  const timer=setTimeout(()=>reject(new Error(`Timeout: ${event}`)),4000);
  socket.once(event,data=>{clearTimeout(timer);resolve(data)});
});
const until=(socket,event,predicate)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{socket.off(event,onEvent);reject(new Error(`Timeout waiting for ${event}`))},4000);
  const onEvent=data=>{if(predicate(data)){clearTimeout(timer);socket.off(event,onEvent);resolve(data)}};
  socket.on(event,onEvent);
});
const connect=()=>io(URL,{transports:["websocket"],forceNew:true});

test("ყველა სიტყვების კატეგორია საკმარისად დიდია",()=>{
  assert.ok(WORD_CATEGORY_OPTIONS.length>=10);
  for(const category of WORD_CATEGORY_OPTIONS){
    assert.ok(wordsForCategories([category.id]).length>=25,`${category.label} მინიმუმ 25 უნიკალურ სიტყვას უნდა შეიცავდეს`);
  }
  assert.ok(wordsForCategories(WORD_CATEGORY_OPTIONS.map(category=>category.id)).length>=350);
});

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

    const selectedCategories=["nature","fantasy"];
    const categoryChanged=until(clients[0],"room-state",room=>room.wordCategories?.join(",")===selectedCategories.join(","));
    clients[0].emit("update-room-settings",{name:"ტესტის ოპერაცია",isPublic:true,wordCategories:selectedCategories,settings:{clueTime:90,guessTime:120,roundTime:240}});
    await categoryChanged;

    const autoAssigned=until(clients[4],"room-state",room=>room.canStart&&room.players.every(player=>player.team&&player.role));
    clients[0].emit("quick-role",{mode:"auto"});
    const randomized=await autoAssigned;
    assert.equal(randomized.players.filter(player=>player.role==="spymaster").length,2);
    assert.equal(randomized.players.filter(player=>player.team==="blue"&&player.role==="spymaster").length,1);
    assert.equal(randomized.players.filter(player=>player.team==="red"&&player.role==="spymaster").length,1);
    assert.ok(Math.abs(randomized.players.filter(player=>player.team==="blue").length-randomized.players.filter(player=>player.team==="red").length)<=1);

    const clientByPlayer=new Map(identities.map((identity,index)=>[identity.selfId,clients[index]]));
    const blueSpy=randomized.players.find(player=>player.team==="blue"&&player.role==="spymaster");
    const redSpy=randomized.players.find(player=>player.team==="red"&&player.role==="spymaster");
    const blueOperative=randomized.players.find(player=>player.team==="blue"&&player.role==="operative");
    const redOperative=randomized.players.find(player=>player.team==="red"&&player.role==="operative");
    const gameState=until(clientByPlayer.get(blueOperative.id),"room-state",room=>!!room.game);
    clients[0].emit("start-game");
    const started=await gameState;
    assert.equal(started.game.board.length,25);
    assert.equal(new Set(started.game.board.map(card=>card.word)).size,25);
    const allowedWords=new Set(wordsForCategories(selectedCategories));
    assert.equal(started.game.board.every(card=>allowedWords.has(card.word)),true,"დაფა მხოლოდ არჩეული კატეგორიებიდან უნდა შეიქმნას");
    assert.equal(started.players.length,7);
    assert.equal(started.game.board.every(card=>card.type===null),true,"ოპერატივმა საიდუმლო რუკა არ უნდა მიიღოს");
    assert.equal(started.game.remaining.blue+started.game.remaining.red,17);

    const chatter=randomized.players.find(player=>player.role==="operative"),chatterClient=clientByPlayer.get(chatter.id);
    const chatted=until(clients[0],"room-state",room=>room.chat?.some(message=>message.text==="მზად ვართ"));
    chatterClient.emit("send-chat",{text:"მზად ვართ"});
    assert.equal((await chatted).chat.at(-1).actor,chatter.name);

    const activeSpy=clientByPlayer.get(started.game.turn==="blue"?blueSpy.id:redSpy.id);
    const activeOperative=clientByPlayer.get(started.game.turn==="blue"?blueOperative.id:redOperative.id);
    const clueReady=until(activeOperative,"room-state",room=>room.game?.phase==="guess"&&room.game?.clue?.count===0);
    activeSpy.emit("give-clue",{word:"თავისუფლება",count:0});
    const zeroClue=await clueReady;
    assert.equal(zeroClue.game.guessesLeft,99,"მინიშნება 0 შეუზღუდავ ცდებს უნდა იძლეოდეს");

    const suggested=until(activeOperative,"room-state",room=>room.game?.pendingGuess?.index===0);
    activeOperative.emit("suggest-card",{index:0});
    const beforeConfirm=await suggested;
    assert.equal(beforeConfirm.game.board[0].revealed,false,"ერთი დაჭერა მხოლოდ მონიშვნაა");

    const contacted=until(activeOperative,"room-state",room=>room.game?.board[0]?.revealed);
    activeOperative.emit("confirm-card",{index:0});
    const afterConfirm=await contacted;
    assert.equal(afterConfirm.game.board[0].revealed,true,"დადასტურება ბარათს ხსნის");
    assert.match(afterConfirm.game.board[0].art,/\.webp$/);

    const reconnectToken=identities[1].token;
    clients[1].disconnect();
    returning=connect();
    await wait(returning,"connect");
    const restored=wait(returning,"room-joined");
    returning.emit("join-room",{code,name:"მოთამაშე 1",reconnectToken});
    const again=await restored;
    assert.equal(again.selfId,identities[1].selfId);
    assert.equal(again.room.players.length,7,"reconnect must restore the existing player instead of creating a duplicate");
    assert.ok(again.room.game);
  }finally{
    returning?.disconnect();
    clients.forEach(c=>c.disconnect());
  }
});

test("host controls, moderation, settings, and automatic succession",async()=>{
  const clients=Array.from({length:4},connect);
  try{
    await Promise.all(clients.map(client=>wait(client,"connect")));
    const hostJoined=wait(clients[0],"room-joined");
    clients[0].emit("create-room",{name:"Host",roomName:"Host Controls"});
    const host=await hostJoined,code=host.room.code;
    const identities=[host];
    for(let index=1;index<4;index++){
      const joined=wait(clients[index],"room-joined");
      clients[index].emit("join-room",{code,name:`Player ${index}`});
      identities.push(await joined);
    }

    const settingsChanged=until(clients[0],"room-state",room=>room.settings?.clueTime===45&&room.wordCategories?.join(",")==="science,ideas");
    clients[0].emit("update-room-settings",{name:"Host Controls",isPublic:true,wordCategories:["science","ideas"],settings:{clueTime:45,guessTime:75,roundTime:180}});
    const changedRoom=await settingsChanged;
    assert.deepEqual(changedRoom.settings,{clueTime:45,guessTime:75,roundTime:180});
    assert.deepEqual(changedRoom.wordCategories,["science","ideas"]);

    const promoted=until(clients[1],"room-state",room=>room.players.find(player=>player.id===identities[1].selfId)?.host);
    const promoteResult=wait(clients[0],"moderation-result");
    clients[0].emit("moderate-player",{action:"promote",playerId:identities[1].selfId});
    const promotedRoom=await promoted;
    assert.equal((await promoteResult).action,"promote");
    assert.equal(promotedRoom.players.find(player=>player.id===host.selfId)?.host,false);

    const banned=wait(clients[2],"removed-from-room");
    const banResult=wait(clients[1],"moderation-result");
    const removed=until(clients[0],"room-state",room=>room.players.length===3);
    clients[1].emit("moderate-player",{action:"ban",playerId:identities[2].selfId});
    assert.equal((await banned).ban,true);
    assert.equal((await banResult).action,"ban");
    await removed;

    const blocked=wait(clients[2],"error-message");
    clients[2].emit("join-room",{code,name:"Player 2",reconnectToken:identities[2].token});
    assert.match(await blocked,/აკრძალული/);

    const kicked=wait(clients[3],"removed-from-room");
    const kickResult=wait(clients[1],"moderation-result");
    const kickedState=until(clients[0],"room-state",room=>room.players.length===2);
    clients[1].emit("moderate-player",{action:"kick",playerId:identities[3].selfId});
    assert.equal((await kicked).ban,false);
    assert.equal((await kickResult).action,"kick");
    await kickedState;

    const successor=until(clients[0],"room-state",room=>room.players.length===1&&room.players[0].host);
    clients[1].emit("leave-room");
    const finalRoom=await successor;
    assert.equal(finalRoom.players[0].id,host.selfId);
  }finally{
    clients.forEach(client=>client.disconnect());
  }
});

test("clue count grants one extra guess and a wrong guess ends the turn",async()=>{
  const clients=Array.from({length:4},connect);
  try{
    await Promise.all(clients.map(client=>wait(client,"connect")));
    const hostJoined=wait(clients[0],"room-joined");
    clients[0].emit("create-room",{name:"Blue Spy",roomName:"Guess Limit"});
    const host=await hostJoined,code=host.room.code;
    for(let index=1;index<4;index++){
      const joined=wait(clients[index],"room-joined");
      clients[index].emit("join-room",{code,name:`Player ${index}`});
      await joined;
    }

    const ready=until(clients[0],"room-state",room=>room.canStart);
    clients[0].emit("choose-role",{team:"blue",role:"spymaster"});
    clients[1].emit("choose-role",{team:"blue",role:"operative"});
    clients[2].emit("choose-role",{team:"red",role:"spymaster"});
    clients[3].emit("choose-role",{team:"red",role:"operative"});
    await ready;

    const blueSpyStarted=until(clients[0],"room-state",room=>!!room.game);
    const redSpyStarted=until(clients[2],"room-state",room=>!!room.game);
    clients[0].emit("start-game");
    const [blueView,redView]=await Promise.all([blueSpyStarted,redSpyStarted]);
    const turn=blueView.game.turn,spy=turn==="blue"?clients[0]:clients[2],operative=turn==="blue"?clients[1]:clients[3];
    const key=turn==="blue"?blueView:redView;

    const guessing=until(operative,"room-state",room=>room.game?.phase==="guess"&&room.game?.clue?.count===1);
    spy.emit("give-clue",{word:"თავისუფლება",count:1});
    const guessState=await guessing;
    assert.equal(guessState.game.guessesLeft,2);

    const correctIndex=key.game.board.findIndex(card=>card.type===turn);
    const wrongIndex=key.game.board.findIndex((card,index)=>index!==correctIndex&&card.type!==turn&&card.type!=="assassin");
    const selectedCorrect=until(operative,"room-state",room=>room.game?.picks?.some(pick=>pick.index===correctIndex));
    operative.emit("suggest-card",{index:correctIndex});
    await selectedCorrect;
    const selectedBoth=until(operative,"room-state",room=>room.game?.picks?.some(pick=>pick.index===correctIndex)&&room.game?.picks?.some(pick=>pick.index===wrongIndex));
    operative.emit("suggest-card",{index:wrongIndex});
    await selectedBoth;
    const correctResult=until(operative,"room-state",room=>room.game?.board[correctIndex]?.revealed&&room.game?.guessesLeft===1);
    operative.emit("confirm-card",{index:correctIndex});
    const afterCorrect=await correctResult;
    assert.equal(afterCorrect.game.phase,"guess");
    assert.equal(afterCorrect.game.turn,turn);
    assert.equal(afterCorrect.game.picks.some(pick=>pick.index===wrongIndex),true,"დარჩენილი მონიშვნა სწორი პასუხის შემდეგ უნდა შენარჩუნდეს");

    const turnEnded=until(operative,"room-state",room=>room.game?.turn!==turn&&room.game?.phase==="clue");
    operative.emit("confirm-card",{index:wrongIndex});
    const afterWrong=await turnEnded;
    assert.equal(afterWrong.game.pendingGuess,null);
  }finally{
    clients.forEach(client=>client.disconnect());
  }
});
