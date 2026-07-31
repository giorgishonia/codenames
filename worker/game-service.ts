import {DEFAULT_WORD_CATEGORIES, WORD_CATEGORY_OPTIONS, normalizeWordCategories, wordsForCategories} from "../shared/word-packs.js";

type Client = { room?: string; player?: string; queue: {event:string; data?:unknown}[]; lastSeen:number };
type Player = {
  id: string; token: string; name: string; avatar: number; team: "blue" | "red" | null;
  role: "spymaster" | "operative" | null; host: boolean; connected: boolean; lastChatAt?: number;
};
type Room = {
  code: string; name: string; isPublic: boolean; hostId: string; players: Player[];
  chat: any[]; game: any; createdAt: number; lastActivity: number;
  settings: {clueTime:number; guessTime:number; roundTime:number}; wordCategories: string[]; bannedTokens: string[];
  removedPlayers: Record<string, {reason:string; ban:boolean}>;
};

const rooms = new Map<string, Room>();
const clients = new Map<string, Client>();
const ROOM_INACTIVITY_MS = 5 * 60 * 1000;
const DEFAULT_GAME_SETTINGS = {clueTime:90, guessTime:120, roundTime:240};
const ROOM_SCHEMA = `CREATE TABLE IF NOT EXISTS game_rooms (
  code TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;
const CLIENT_SCHEMA = `CREATE TABLE IF NOT EXISTS game_clients (
  id TEXT PRIMARY KEY,
  room_code TEXT,
  player_id TEXT,
  last_seen INTEGER NOT NULL
)`;
const WORDS = [
  "მთა","ზღვა","მზე","მთვარე","ვარსკვლავი","წვიმა","ქარი","თოვლი","ღრუბელი","ტყე",
  "მდინარე","ხიდი","კოშკი","სახლი","ქუჩა","ქალაქი","სოფელი","ბაღი","ყვავილი","ხე",
  "ფოთოლი","ვაშლი","ღვინო","პური","ყავა","ჩაი","სუფრა","წიგნი","კალამი","წერილი",
  "გასაღები","საათი","სარკე","ფანჯარა","კარი","სკამი","მაგიდა","ხალიჩა","ტელეფონი","რადიო",
  "მატარებელი","გემი","თვითმფრინავი","მანქანა","ველოსიპედი","გზა","რუკა","კომპასი","ოქრო","ვერცხლი",
  "ბრილიანტი","გვირგვინი","მეფე","დედოფალი","რაინდი","დრაკონი","მზვერავი","ნიღაბი","ჩრდილი","საიდუმლო",
  "სიზმარი","სიმღერა","ცეკვა","თეატრი","კინო","სცენა","ფოტო","ფერი","ხმა","სინათლე",
  "ცეცხლი","წყალი","ყინული","ქვა","ქვიშა","კუნძული","უდაბნო","ოკეანე","ნავსადგური","ბაზარი",
  "მუზეუმი","სკოლა","ექიმი","მასწავლებელი","მზარეული","მფრინავი","მეკარე","ბურთი","ჭადრაკი","თასი"
];
const ART: Record<string, string[]> = {
  blue:["blue-0.webp","blue-7.webp","blue-8.webp","blue-11.webp","blue-13.webp","blue-19.webp","blue-21.webp","blue-23.webp","blue-24.webp"],
  red:["red-1.webp","red-8.webp","red-10.webp","red-13.webp","red-22.webp","red-23.webp","red-24.webp"],
  neutral:["neutral-0.webp","neutral-1.webp","neutral-2.webp","neutral-3.webp","neutral-4.webp","neutral-5.webp","neutral-6.webp","neutral-7.webp","neutral-8.webp","neutral-9.webp"],
  assassin:["black-0.webp"]
};

const id = () => crypto.randomUUID();
const clean = (value: unknown, max = 24) => String(value ?? "").replace(/[<>]/g, "").trim().slice(0, max);
const gameSettings = (value: any) => ({
  clueTime:Math.min(600, Math.max(15, Number(value?.clueTime) || DEFAULT_GAME_SETTINGS.clueTime)),
  guessTime:Math.min(900, Math.max(15, Number(value?.guessTime) || DEFAULT_GAME_SETTINGS.guessTime)),
  roundTime:Math.min(1200, Math.max(30, Number(value?.roundTime) || DEFAULT_GAME_SETTINGS.roundTime))
});
const guessAllowance = (count: number) => count === 0 || count === 99 ? 99 : count + 1;
const random = (max: number) => crypto.getRandomValues(new Uint32Array(1))[0] % max;
const shuffle = <T>(input: T[]) => {
  const values = [...input];
  for (let i = values.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
};
const newCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  do value = Array.from({length: 5}, () => alphabet[random(alphabet.length)]).join("");
  while (rooms.has(value));
  return value;
};
const send = (clientId: string, event: string, data?: unknown) => {
  const client = clients.get(clientId);
  if (client) client.queue.push({event, data});
};
const canStart = (room: Room) =>
  room.players.filter(player => player.connected).length >= 4 &&
  (["blue","red"] as const).every(team =>
    room.players.some(player => player.connected && player.team === team && player.role === "spymaster") &&
    room.players.some(player => player.connected && player.team === team && player.role === "operative")
  );
const publicRoom = (room: Room, selfId?: string) => {
  const viewer = room.players.find(player => player.id === selfId);
  const game = room.game ? {
    ...room.game,
    board: room.game.board.map((card: any) =>
      card.revealed || viewer?.role === "spymaster" || room.game.winner ? card : {word: card.word, revealed: false, type: null}
    )
  } : null;
  return {
    code: room.code, name: room.name, isPublic: room.isPublic, settings:room.settings,
    wordCategories:normalizeWordCategories(room.wordCategories), wordCategoryOptions:WORD_CATEGORY_OPTIONS,
    selfId, hostId: room.hostId,
    canStart: canStart(room),
    players: room.players.map(({token, lastChatAt, ...player}) => player),
    chat: room.chat, game
  };
};
const lobbyList = () => [...rooms.values()].filter(room =>
  room.isPublic && room.players.some(player => player.connected)
).map(room => ({
  code: room.code, name: room.name, status: room.game ? "playing" : "waiting",
  players: room.players.filter(player => player.connected).length,
  avatars: room.players.filter(player => player.connected).slice(0,4).map(player => player.avatar),
  createdAt: room.createdAt
})).sort((a,b) => b.createdAt - a.createdAt);
const broadcastLobby = () => clients.forEach((_client, clientId) => send(clientId, "lobby-list", lobbyList()));
const emitRoom = (room: Room) => clients.forEach((client, clientId) => {
  if (client.room === room.code && client.player) send(clientId, "room-state", publicRoom(room, client.player));
});
const found = (clientId: string) => {
  const client = clients.get(clientId);
  const room = client?.room ? rooms.get(client.room) : undefined;
  const player = room?.players.find(item => item.id === client?.player);
  return room && player ? {room, player} : null;
};
const consumeRemoval = (clientId: string) => {
  const client = clients.get(clientId);
  if (!client?.room || !client.player) return null;
  const room = rooms.get(client.room), removal = room?.removedPlayers?.[client.player];
  if (!room || !removal) return null;
  delete room.removedPlayers[client.player];
  client.room = undefined; client.player = undefined;
  return {room, removal};
};
const assignHost = (room: Room) => {
  if (!room.players.length) { room.hostId = ""; return; }
  const connected = room.players.filter(player => player.connected);
  const pool = connected.length ? connected : room.players;
  const next = pool[random(pool.length)];
  room.players.forEach(player => { player.host = player.id === next.id; });
  room.hostId = next.id;
};
const removePlayer = (room: Room, target: Player, reason: string, ban = false) => {
  if (ban && !room.bannedTokens.includes(target.token)) room.bannedTokens.push(target.token);
  room.removedPlayers[target.id] = {reason, ban};
  room.players = room.players.filter(player => player.id !== target.id);
  if (target.host) assignHost(room);
  if (!room.players.length) rooms.delete(room.code); else emitRoom(room);
  broadcastLobby();
};
const newGame = (settings: Room["settings"], wordCategories: string[]) => {
  const now = Date.now();
  const first = random(2) ? "blue" : "red";
  const types = [
    ...Array(first === "blue" ? 9 : 8).fill("blue"),
    ...Array(first === "red" ? 9 : 8).fill("red"),
    ...Array(7).fill("neutral"), "assassin"
  ];
  const totals = {blue: types.filter(type => type === "blue").length, red: types.filter(type => type === "red").length};
  const pools = Object.fromEntries(Object.entries(ART).map(([type, items]) => [type, shuffle(items)]));
  const indices: Record<string, number> = {blue:0, red:0, neutral:0, assassin:0};
  const words = shuffle(wordsForCategories(wordCategories)).slice(0, 25);
  return {
    turn:first, round:1, phase:"clue", clue:null, pendingGuess:null, picks:[], guessesLeft:0,
    roundDeadline:now + settings.roundTime * 1000,
    phaseDeadline:now + Math.min(settings.clueTime, settings.roundTime) * 1000,
    total:totals, remaining:{...totals},
    board:shuffle(types).map((type, index) => ({
      word:words[index], type,
      art:pools[type][indices[type]++ % pools[type].length], revealed:false
    })),
    log:[{actor:"სისტემა", text:`${first === "blue" ? "ლურჯი" : "წითელი"} გუნდი იწყებს ოპერაციას.`}]
  };
};
const switchTurn = (game: any, settings: Room["settings"], reason = "") => {
  const now = Date.now();
  game.turn = game.turn === "blue" ? "red" : "blue";
  game.round++; game.phase = "clue"; game.clue = null; game.pendingGuess = null; game.picks = []; game.guessesLeft = 0;
  game.roundDeadline = now + settings.roundTime * 1000;
  game.phaseDeadline = now + Math.min(settings.clueTime, settings.roundTime) * 1000;
  game.log.push({actor:"სისტემა", text:`${reason ? `${reason} ` : ""}ახლა ${game.turn === "blue" ? "ლურჯების" : "წითლების"} სვლაა.`});
};
const finish = (room: Room, winner: string, reason: string) => {
  room.game.winner = winner; emitRoom(room);
  clients.forEach((client, clientId) => { if (client.room === room.code) send(clientId, "game-over", {winner, reason}); });
};
const processGameTimers = () => {
  const now = Date.now(), changed: Room[] = [];
  rooms.forEach(room => {
    const game = room.game;
    if (game && !game.winner && game.phaseDeadline && now >= game.phaseDeadline) {
      switchTurn(game, room.settings, "დრო ამოიწურა.");
      emitRoom(room); changed.push(room);
    }
  });
  return changed;
};

async function ensureSchema(db: any) {
  await db.batch([db.prepare(ROOM_SCHEMA), db.prepare(CLIENT_SCHEMA)]);
}

async function loadWorld(db: any) {
  await ensureSchema(db);
  const [roomResult, clientResult] = await Promise.all([
    db.prepare("SELECT code, state FROM game_rooms").all(),
    db.prepare("SELECT id, room_code, player_id, last_seen FROM game_clients").all()
  ]);
  rooms.clear(); clients.clear();
  for (const row of roomResult.results || []) {
    try {
      const room = JSON.parse(row.state);
      room.lastActivity ||= room.createdAt;
      room.settings ||= {...DEFAULT_GAME_SETTINGS};
      room.wordCategories = normalizeWordCategories(room.wordCategories);
      room.bannedTokens ||= [];
      room.removedPlayers ||= {};
      rooms.set(row.code, room);
    } catch {}
  }
  for (const row of clientResult.results || []) {
    clients.set(row.id, {room:row.room_code || undefined, player:row.player_id || undefined, lastSeen:Number(row.last_seen), queue:[]});
  }
  const now = Date.now();
  const active = new Set(
    [...clients.values()].filter(client => now - client.lastSeen < 150_000 && client.room && client.player)
      .map(client => `${client.room}:${client.player}`)
  );
  const lastSeenByPlayer = new Map<string, number>();
  clients.forEach(client => {
    if (!client.room || !client.player) return;
    const key = `${client.room}:${client.player}`;
    lastSeenByPlayer.set(key, Math.max(lastSeenByPlayer.get(key) || 0, client.lastSeen));
  });
  const cleanedRooms: Room[] = [];
  rooms.forEach(room => {
    const previousHost = room.hostId, before = room.players.length;
    room.players.forEach(player => { player.connected = active.has(`${room.code}:${player.id}`); });
    room.players = room.players.filter(player => {
      const seen = lastSeenByPlayer.get(`${room.code}:${player.id}`) || room.lastActivity;
      return player.connected || now - seen < ROOM_INACTIVITY_MS;
    });
    if (room.players.length !== before) {
      if (previousHost && !room.players.some(player => player.id === previousHost)) assignHost(room);
      cleanedRooms.push(room);
    }
  });
  const staleCodes = new Set([...rooms.values()]
    .filter(room => !room.players.length || now - room.lastActivity >= ROOM_INACTIVITY_MS)
    .map(room => room.code));
  const expiredClients = new Set<string>();
  if (staleCodes.size) {
    for (const [clientId, client] of clients) {
      if (client.room && staleCodes.has(client.room)) {
        expiredClients.add(clientId);
        client.room = undefined; client.player = undefined;
      }
    }
    staleCodes.forEach(code => rooms.delete(code));
  }
  const cleanupStatements = [
    ...[...staleCodes].map(code => db.prepare("DELETE FROM game_rooms WHERE code = ?").bind(code)),
    ...[...expiredClients].map(clientId => db.prepare("UPDATE game_clients SET room_code = NULL, player_id = NULL WHERE id = ?").bind(clientId)),
    ...cleanedRooms.filter(room => !staleCodes.has(room.code)).map(room => db.prepare(
      "UPDATE game_rooms SET state = ?, updated_at = ? WHERE code = ?"
    ).bind(JSON.stringify(room), now, room.code))
  ];
  if (cleanupStatements.length) await db.batch(cleanupStatements);
  return expiredClients;
}

async function saveEvent(db: any, clientId: string, previousCodes: Set<string>) {
  const statements = [...rooms.values()].map(room => db.prepare(
    "INSERT INTO game_rooms (code, state, updated_at) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at"
  ).bind(room.code, JSON.stringify(room), Date.now()));
  for (const code of previousCodes) if (!rooms.has(code)) statements.push(db.prepare("DELETE FROM game_rooms WHERE code = ?").bind(code));
  const client = clients.get(clientId);
  if (client) statements.push(db.prepare(
    "INSERT INTO game_clients (id, room_code, player_id, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET room_code = excluded.room_code, player_id = excluded.player_id, last_seen = excluded.last_seen"
  ).bind(clientId, client.room || null, client.player || null, client.lastSeen));
  if (statements.length) await db.batch(statements);
}

function handle(clientId: string, event: string, data: any) {
  if (event === "list-rooms") return send(clientId, "lobby-list", lobbyList());
  if (event === "create-room") {
    const name = clean(data?.name, 18), roomName = clean(data?.roomName, 28);
    if (name.length < 2) return send(clientId, "error-message", "სახელი ძალიან მოკლეა.");
    if (roomName.length < 2) return send(clientId, "error-message", "ოთახს სახელი სჭირდება.");
    const room: Room = {code:newCode(), name:roomName, isPublic:data?.isPublic !== false, settings:{...DEFAULT_GAME_SETTINGS}, wordCategories:[...DEFAULT_WORD_CATEGORIES], bannedTokens:[], removedPlayers:{}, hostId:"", players:[], chat:[], game:null, createdAt:Date.now(), lastActivity:Date.now()};
    const player: Player = {id:id(), token:id(), name, avatar:random(8), team:null, role:null, host:true, connected:true};
    room.hostId = player.id; room.players.push(player); rooms.set(room.code, room);
    Object.assign(clients.get(clientId)!, {room:room.code, player:player.id});
    send(clientId, "room-joined", {room:publicRoom(room, player.id), token:player.token, selfId:player.id});
    broadcastLobby(); return;
  }
  if (event === "join-room") {
    const room = rooms.get(clean(data?.code, 5).toUpperCase()), name = clean(data?.name, 18);
    if (!room) return send(clientId, "error-message", "ასეთი ოთახი ვერ მოიძებნა.");
    if (name.length < 2) return send(clientId, "error-message", "სახელი ძალიან მოკლეა.");
    if (data?.reconnectToken && room.bannedTokens.includes(data.reconnectToken)) return send(clientId, "error-message", "ამ ოთახში დაბრუნება აკრძალული გაქვს.");
    const returning = room.players.find(player => player.token === data?.reconnectToken);
    if (returning) {
      room.lastActivity = Date.now(); returning.connected = true;
      Object.assign(clients.get(clientId)!, {room:room.code, player:returning.id});
      send(clientId, "room-joined", {room:publicRoom(room, returning.id), token:returning.token, selfId:returning.id});
      emitRoom(room); broadcastLobby(); return;
    }
    if (room.game) return send(clientId, "error-message", "თამაში უკვე დაწყებულია — დასაბრუნებლად გამოიყენე შენახული ბმული.");
    room.lastActivity = Date.now();
    const player: Player = {id:id(), token:id(), name, avatar:room.players.length % 8, team:null, role:null, host:false, connected:true};
    room.players.push(player); Object.assign(clients.get(clientId)!, {room:room.code, player:player.id});
    send(clientId, "room-joined", {room:publicRoom(room, player.id), token:player.token, selfId:player.id});
    emitRoom(room); broadcastLobby(); return;
  }
  if (event === "reconnect-room") {
    const room = rooms.get(clean(data?.code, 5).toUpperCase());
    const player = room?.players.find(item => item.token === data?.token);
    if (!room || !player) return;
    room.lastActivity = Date.now(); player.connected = true; Object.assign(clients.get(clientId)!, {room:room.code, player:player.id});
    send(clientId, "room-joined", {room:publicRoom(room, player.id), token:player.token, selfId:player.id});
    emitRoom(room); broadcastLobby(); return;
  }
  const match = found(clientId);
  if (!match) return;
  const {room, player} = match;
  room.lastActivity = Date.now();
  if (event === "update-room-settings" && player.host) {
    const name = clean(data?.name, 28);
    if (name.length < 2) return send(clientId, "error-message", "ოთახს სახელი სჭირდება.");
    room.name = name; room.isPublic = data?.isPublic !== false; room.settings = gameSettings(data?.settings);
    room.wordCategories = normalizeWordCategories(data?.wordCategories); emitRoom(room); broadcastLobby();
  } else if (event === "moderate-player" && player.host) {
    const target = room.players.find(item => item.id === data?.playerId);
    if (!target || target.id === player.id) return;
    if (data?.action === "promote") {
      player.host = false; target.host = true; room.hostId = target.id; emitRoom(room);
      send(clientId, "moderation-result", {action:"promote", message:`${target.name} ახლა მასპინძელია`});
    } else if (data?.action === "kick") {
      removePlayer(room, target, "მასპინძელმა ოთახიდან გაგიშვა");
      send(clientId, "moderation-result", {action:"kick", message:`${target.name} ოთახიდან გაიშვა`});
    } else if (data?.action === "ban") {
      removePlayer(room, target, "მასპინძელმა ოთახში დაბრუნება აგიკრძალა", true);
      send(clientId, "moderation-result", {action:"ban", message:`${target.name} დაიბლოკა`});
    }
  } else if (event === "choose-role" && !room.game) {
    if (["blue","red"].includes(data?.team) && ["spymaster","operative"].includes(data?.role)) {
      player.team = data.team; player.role = data.role; emitRoom(room); broadcastLobby();
    }
  } else if (event === "quick-role" && !room.game) {
    if (data?.mode === "observer") { player.team = null; player.role = null; }
    else if (data?.mode === "auto" && player.host) {
      const active = shuffle(room.players.filter(item => item.connected));
      if (active.length < 4) return send(clientId, "error-message", "სწრაფი განაწილებისთვის მინიმუმ 4 მოთამაშეა საჭირო.");
      room.players.filter(item => !item.connected).forEach(item => { item.team = null; item.role = null; });
      active.forEach((item, index) => {
        item.team = index === 0 ? "blue" : index === 1 ? "red" : index % 2 === 0 ? "blue" : "red";
        item.role = index < 2 ? "spymaster" : "operative";
      });
    }
    emitRoom(room); broadcastLobby();
  } else if (event === "send-chat") {
    const text = clean(data?.text, 160);
    if (!text || (player.role === "spymaster" && room.game) || (player.lastChatAt && Date.now() - player.lastChatAt < 700)) return;
    player.lastChatAt = Date.now(); room.chat.push({id:id(), actor:player.name, playerId:player.id, team:player.team, text, time:Date.now()});
    room.chat = room.chat.slice(-50); emitRoom(room);
  } else if (event === "start-game") {
    if (!player.host || !canStart(room)) return send(clientId, "error-message", "გუნდები ჯერ მზად არ არიან.");
    room.game = newGame(room.settings, room.wordCategories); emitRoom(room); broadcastLobby();
  } else if (event === "give-clue") {
    const game = room.game, word = clean(data?.word, 24).replace(/\s+/g, ""), count = Number(data?.count);
    if (!game || game.winner || player.role !== "spymaster" || player.team !== game.turn || game.phase !== "clue") return;
    if (word.length < 2 || !Number.isInteger(count) || count < 1 || count > 9) return send(clientId, "error-message", "მინიშნება და არჩეული ბარათები გადაამოწმე.");
    const invalid = game.board.some((card: any) => {
      const cardWord = card.word.toLowerCase(), clue = word.toLowerCase(), min = Math.min(cardWord.length, clue.length);
      return !card.revealed && (cardWord === clue || (min >= 4 && (cardWord.startsWith(clue) || clue.startsWith(cardWord))));
    });
    if (invalid) return send(clientId, "error-message", "დაფაზე არსებული სიტყვის ან მისი აშკარა ფორმის გამოყენება არ შეიძლება.");
    game.clue = {word, count}; game.pendingGuess = null; game.guessesLeft = guessAllowance(count); game.phase = "guess";
    game.phaseDeadline = Math.min(game.roundDeadline, Date.now() + room.settings.guessTime * 1000);
    game.log.push({actor:player.name, text:`მისცა მინიშნება „${word}“ · ${count === 99 ? "∞" : count}.`}); emitRoom(room);
  } else if (event === "suggest-card") {
    const game = room.game, index = Number(data?.index), card = game?.board[index];
    if (!game || game.winner || player.role !== "operative" || player.team !== game.turn || game.phase !== "guess" || !card || card.revealed) return;
    const picks = (game.picks ||= []) as any[], existing = picks.findIndex(pick => pick.playerId === player.id && pick.index === index);
    if (existing >= 0) picks.splice(existing, 1);
    else picks.push({playerId:player.id, name:player.name, avatar:player.avatar, team:player.team, index});
    const last = game.picks[game.picks.length - 1];
    game.pendingGuess = last ? {index:last.index, actor:last.name} : null;
    emitRoom(room);
  } else if (event === "confirm-card" || event === "guess-card") {
    const game = room.game, index = Number(data?.index ?? game?.pendingGuess?.index), card = game?.board[index];
    if (!game || game.winner || player.role !== "operative" || player.team !== game.turn || game.phase !== "guess" || !card || card.revealed || !game.picks?.some((pick:any) => pick.index === index)) return;
    game.picks = game.picks.filter((pick:any) => pick.index !== index);
    const last = game.picks[game.picks.length - 1];
    game.pendingGuess = last ? {index:last.index, actor:last.name} : null;
    card.revealed = true;
    game.log.push({actor:player.name, text:`დაადასტურა „${card.word}“.`});
    if (card.type === "assassin") return finish(room, player.team === "blue" ? "red" : "blue", "შავი აგენტი გაიხსნა — ოპერაცია ჩავარდა.");
    if (card.type === "blue" || card.type === "red") {
      game.remaining[card.type]--;
      if (game.remaining[card.type] === 0) return finish(room, card.type, "გუნდმა ყველა თავისი აგენტი იპოვა.");
    }
    if (card.type !== player.team) switchTurn(game, room.settings);
    else if (game.guessesLeft !== 99 && --game.guessesLeft === 0) switchTurn(game, room.settings);
    emitRoom(room);
  } else if (event === "end-turn") {
    const game = room.game;
    if (game && !game.winner && player.role === "operative" && player.team === game.turn && game.phase === "guess") { switchTurn(game, room.settings); emitRoom(room); }
  } else if (event === "back-to-lobby" && player.host) {
    room.game = null; emitRoom(room); broadcastLobby();
  } else if (event === "leave-room") {
    const index = room.players.findIndex(item => item.id === player.id);
    if (index >= 0) room.players.splice(index, 1);
    Object.assign(clients.get(clientId)!, {room:undefined, player:undefined});
    if (player.host && room.players.length) assignHost(room);
    if (!room.players.length) rooms.delete(room.code); else emitRoom(room);
    broadcastLobby();
  }
}

export async function handleGameRequest(request: Request, db: D1Database): Promise<Response | null> {
  const url = new URL(request.url);
  const primary = db.withSession("first-primary");
  if (url.pathname === "/api/v2/connect" && request.method === "POST") {
    await ensureSchema(primary);
    const clientId = id();
    await primary.prepare("INSERT INTO game_clients (id, last_seen) VALUES (?, ?)").bind(clientId, Date.now()).run();
    return Response.json({clientId});
  }
  if (url.pathname === "/api/v2/event" && request.method === "POST") {
    const expiredClients = await loadWorld(primary);
    processGameTimers();
    const message = await request.json() as any;
    const client = clients.get(message?.clientId);
    if (!client) return Response.json({error:"expired"}, {status:410});
    if (expiredClients.has(message.clientId)) send(message.clientId, "room-expired");
    const removed = consumeRemoval(message.clientId);
    if (removed) send(message.clientId, "removed-from-room", removed.removal);
    client.lastSeen = Date.now();
    if (client.room && client.player) {
      const player = rooms.get(client.room)?.players.find(item => item.id === client.player);
      if (player) player.connected = true;
    }
    const previousCodes = new Set(rooms.keys());
    handle(message.clientId, message.event, message.data);
    await saveEvent(primary, message.clientId, previousCodes);
    return Response.json(client.queue.splice(0,100));
  }
  if (url.pathname === "/api/v2/poll" && request.method === "GET") {
    const expiredClients = await loadWorld(primary);
    const timedRooms = processGameTimers();
    const clientId = url.searchParams.get("client") || "";
    const client = clients.get(clientId);
    if (!client) return Response.json({error:"expired"}, {status:410});
    const removed = consumeRemoval(clientId);
    client.lastSeen = Date.now();
    if (client.room && client.player) {
      const player = rooms.get(client.room)?.players.find(item => item.id === client.player);
      if (player) player.connected = true;
    }
    const pollStatements = [primary.prepare(
      "UPDATE game_clients SET room_code = ?, player_id = ?, last_seen = ? WHERE id = ?"
    ).bind(client.room || null, client.player || null, client.lastSeen, clientId)];
    if (removed) pollStatements.push(primary.prepare(
      "UPDATE game_rooms SET state = ?, updated_at = ? WHERE code = ?"
    ).bind(JSON.stringify(removed.room), Date.now(), removed.room.code));
    timedRooms.forEach(room => pollStatements.push(primary.prepare(
      "UPDATE game_rooms SET state = ?, updated_at = ? WHERE code = ?"
    ).bind(JSON.stringify(room), Date.now(), room.code)));
    await primary.batch(pollStatements);
    const messages: {event:string;data?:unknown}[] = expiredClients.has(clientId) ? [{event:"room-expired"}] : [];
    if (removed) messages.push({event:"removed-from-room", data:removed.removal});
    messages.push({event:"lobby-list", data:lobbyList()});
    if (client.room && client.player) {
      const room = rooms.get(client.room);
      if (room) {
        messages.push({event:"room-state", data:publicRoom(room, client.player)});
        if (room.game?.winner) messages.push({event:"game-over", data:{winner:room.game.winner, reason:"ოპერაცია დასრულებულია."}});
      }
    }
    return Response.json(messages, {headers:{"cache-control":"no-store"}});
  }
  return null;
}
