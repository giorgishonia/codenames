import {CLUE_WINDOW_MS,REACTION_WINDOW_MS,voiceMode} from "./config.js";

// სუფთა ფუნქციები — Discord-ს არ ეხებიან, ამიტომ ტესტით სრულად იფარება.
//
//   off       — ხმას საერთოდ არ ვეხებით
//   mute      — ხელმძღვანელები დამუტებულები არიან ოპერატივების მსჯელობისას,
//               მაგრამ ეძლევათ ორი ფანჯარა: მინიშნების თქმა და ბარათის გახსნის რეაქცია
//   hardcore  — ხელმძღვანელები საერთოდ გადადიან ცალკე არხში (მხოლოდ მინიშნების ფანჯარა რჩება)
export const OPEN="open",MUTED="muted",AWAY="away";

export function openClueWindow(game,playerId,now=Date.now()){
  game.voice={...game.voice,cluePlayerId:playerId,clueUntil:now+CLUE_WINDOW_MS}
}
export function openReactionWindow(game,now=Date.now()){
  game.voice={...game.voice,reactUntil:now+REACTION_WINDOW_MS}
}
export function closeWindows(game){
  if(game)game.voice={}
}

export function nextWindowExpiry(game){
  const {clueUntil=0,reactUntil=0}=game?.voice||{};
  const upcoming=[clueUntil,reactUntil].filter(value=>value>0);
  return upcoming.length?Math.min(...upcoming):0
}

export function desiredState(player,{mode,game,now=Date.now()}){
  if(mode==="off")return OPEN;
  // გათიშულ მოთამაშეს ხმა უბრუნდება — ის ამ თამაშში აღარ მონაწილეობს.
  if(player.connected===false)return OPEN;
  if(!game||game.winner)return OPEN;
  if(player.role!=="spymaster")return OPEN;
  if(game.phase!=="guess")return OPEN;
  const {cluePlayerId,clueUntil=0,reactUntil=0}=game.voice||{};
  if(cluePlayerId===player.id&&now<clueUntil)return OPEN;
  if(mode==="mute"&&now<reactUntil)return OPEN;
  return mode==="hardcore"?AWAY:MUTED
}

// ოთახის სრული გეგმა: ვისზე რა უნდა გაკეთდეს ახლა.
export function voicePlan(room,now=Date.now()){
  const mode=voiceMode(room?.settings?.voiceMode);
  return (room?.players||[])
    .filter(player=>player.discordId)
    .map(player=>({playerId:player.id,discordId:player.discordId,name:player.name,state:desiredState(player,{mode,game:room.game,now})}))
}
