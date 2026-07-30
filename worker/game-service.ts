type Client = { room?: string; player?: string; queue: {event:string; data?:unknown}[]; lastSeen:number };
type Player = {
  id: string; token: string; name: string; avatar: number; team: "blue" | "red" | null;
  role: "spymaster" | "operative" | null; host: boolean; connected: boolean; lastChatAt?: number;
};
type Room = {
  code: string; name: string; isPublic: boolean; hostId: string; players: Player[];
  chat: any[]; game: any; createdAt: number;
};

const rooms = new Map<string, Room>();
const clients = new Map<string, Client>();
const STATE_SCHEMA = `CREATE TABLE IF NOT EXISTS realtime_state (
  id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
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
      card.revealed || viewer?.role === "spymaster" ? card : {...card, type: null}
    )
  } : null;
  return {
    code: room.code, name: room.name, isPublic: room.isPublic, selfId, hostId: room.hostId,
    canStart: canStart(room),
    players: room.players.map(({token, lastChatAt, ...player}) => player),
    chat: room.chat, game
  };
};
const lobbyList = () => [...rooms.values()].filter(room => room.isPublic).map(room => ({
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
const newGame = () => {
  const first = random(2) ? "blue" : "red";
  const types = [
    ...Array(first === "blue" ? 9 : 8).fill("blue"),
    ...Array(first === "red" ? 9 : 8).fill("red"),
    ...Array(7).fill("neutral"), "assassin"
  ];
  const totals = {blue: types.filter(type => type === "blue").length, red: types.filter(type => type === "red").length};
  const pools = Object.fromEntries(Object.entries(ART).map(([type, items]) => [type, shuffle(items)]));
  const indices: Record<string, number> = {blue:0, red:0, neutral:0, assassin:0};
  const words = shuffle(WORDS).slice(0, 25);
  return {
    turn:first, round:1, phase:"clue", clue:null, pendingGuess:null, guessesLeft:0,
    total:totals, remaining:{...totals},
    board:shuffle(types).map((type, index) => ({
      word:words[index], type,
      art:pools[type][indices[type]++ % pools[type].length], revealed:false
    })),
    log:[{actor:"სისტემა", text:`${first === "blue" ? "ლურჯი" : "წითელი"} გუნდი იწყებს ოპერაციას.`}]
  };
};
const switchTurn = (game: any) => {
  game.turn = game.turn === "blue" ? "red" : "blue";
  game.round++; game.phase = "clue"; game.clue = null; game.pendingGuess = null; game.guessesLeft = 0;
  game.log.push({actor:"სისტემა", text:`ახლა ${game.turn === "blue" ? "ლურჯების" : "წითლების"} სვლაა.`});
};
const finish = (room: Room, winner: string, reason: string) => {
  room.game.winner = winner; emitRoom(room);
  clients.forEach((client, clientId) => { if (client.room === room.code) send(clientId, "game-over", {winner, reason}); });
};

async function loadState(db: any) {
  await db.prepare(STATE_SCHEMA).run();
  const row = await db.prepare("SELECT data FROM realtime_state WHERE id = 1").first<{data:string}>();
  rooms.clear(); clients.clear();
  if (!row?.data) return;
  try {
    const saved = JSON.parse(row.data);
    for (const [code, room] of saved.rooms || []) rooms.set(code, room);
    for (const [clientId, client] of saved.clients || []) clients.set(clientId, client);
  } catch {}
}

async function saveState(db: any) {
  const data = JSON.stringify({rooms:[...rooms], clients:[...clients]});
  await db.prepare(
    "INSERT INTO realtime_state (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
  ).bind(data, Date.now()).run();
}

function handle(clientId: string, event: string, data: any) {
  if (event === "list-rooms") return send(clientId, "lobby-list", lobbyList());
  if (event === "create-room") {
    const name = clean(data?.name, 18), roomName = clean(data?.roomName, 28);
    if (name.length < 2) return send(clientId, "error-message", "სახელი ძალიან მოკლეა.");
    if (roomName.length < 2) return send(clientId, "error-message", "ოთახს სახელი სჭირდება.");
    const room: Room = {code:newCode(), name:roomName, isPublic:data?.isPublic !== false, hostId:"", players:[], chat:[], game:null, createdAt:Date.now()};
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
    if (room.game) return send(clientId, "error-message", "თამაში უკვე დაწყებულია — დასაბრუნებლად გამოიყენე შენახული ბმული.");
    const player: Player = {id:id(), token:id(), name, avatar:room.players.length % 8, team:null, role:null, host:false, connected:true};
    room.players.push(player); Object.assign(clients.get(clientId)!, {room:room.code, player:player.id});
    send(clientId, "room-joined", {room:publicRoom(room, player.id), token:player.token, selfId:player.id});
    emitRoom(room); broadcastLobby(); return;
  }
  if (event === "reconnect-room") {
    const room = rooms.get(clean(data?.code, 5).toUpperCase());
    const player = room?.players.find(item => item.token === data?.token);
    if (!room || !player) return;
    player.connected = true; Object.assign(clients.get(clientId)!, {room:room.code, player:player.id});
    send(clientId, "room-joined", {room:publicRoom(room, player.id), token:player.token, selfId:player.id});
    emitRoom(room); broadcastLobby(); return;
  }
  const match = found(clientId);
  if (!match) return;
  const {room, player} = match;
  if (event === "update-room-settings" && player.host) {
    const name = clean(data?.name, 28);
    if (name.length < 2) return send(clientId, "error-message", "ოთახს სახელი სჭირდება.");
    room.name = name; room.isPublic = data?.isPublic !== false; emitRoom(room); broadcastLobby();
  } else if (event === "choose-role" && !room.game) {
    if (["blue","red"].includes(data?.team) && ["spymaster","operative"].includes(data?.role)) {
      player.team = data.team; player.role = data.role; emitRoom(room); broadcastLobby();
    }
  } else if (event === "quick-role" && !room.game) {
    if (data?.mode === "observer") { player.team = null; player.role = null; }
    else {
      const blue = room.players.filter(item => item.team === "blue").length;
      const red = room.players.filter(item => item.team === "red").length;
      player.team = blue <= red ? "blue" : "red"; player.role = "operative";
    }
    emitRoom(room); broadcastLobby();
  } else if (event === "send-chat") {
    const text = clean(data?.text, 160);
    if (!text || (player.role === "spymaster" && room.game) || (player.lastChatAt && Date.now() - player.lastChatAt < 700)) return;
    player.lastChatAt = Date.now(); room.chat.push({id:id(), actor:player.name, playerId:player.id, team:player.team, text, time:Date.now()});
    room.chat = room.chat.slice(-50); emitRoom(room);
  } else if (event === "start-game") {
    if (!player.host || !canStart(room)) return send(clientId, "error-message", "გუნდები ჯერ მზად არ არიან.");
    room.game = newGame(); emitRoom(room); broadcastLobby();
  } else if (event === "give-clue") {
    const game = room.game, word = clean(data?.word, 24).replace(/\s+/g, ""), count = Number(data?.count);
    if (!game || game.winner || player.role !== "spymaster" || player.team !== game.turn || game.phase !== "clue") return;
    if (word.length < 2 || ![0,1,2,3,4,5,6,7,8,9,99].includes(count)) return send(clientId, "error-message", "მინიშნება და რაოდენობა გადაამოწმე.");
    const invalid = game.board.some((card: any) => {
      const cardWord = card.word.toLowerCase(), clue = word.toLowerCase(), min = Math.min(cardWord.length, clue.length);
      return !card.revealed && (cardWord === clue || (min >= 4 && (cardWord.startsWith(clue) || clue.startsWith(cardWord))));
    });
    if (invalid) return send(clientId, "error-message", "დაფაზე არსებული სიტყვის ან მისი აშკარა ფორმის გამოყენება არ შეიძლება.");
    game.clue = {word, count}; game.pendingGuess = null; game.guessesLeft = count === 0 || count === 99 ? 99 : count + 1; game.phase = "guess";
    game.log.push({actor:player.name, text:`მისცა მინიშნება „${word}“ · ${count === 99 ? "∞" : count}.`}); emitRoom(room);
  } else if (event === "suggest-card") {
    const game = room.game, index = Number(data?.index), card = game?.board[index];
    if (!game || game.winner || player.role !== "operative" || player.team !== game.turn || game.phase !== "guess" || !card || card.revealed) return;
    game.pendingGuess = {index, actor:player.name}; emitRoom(room);
  } else if (event === "guess-card") {
    const game = room.game, index = game?.pendingGuess?.index, card = game?.board[index];
    if (!game || game.winner || player.role !== "operative" || player.team !== game.turn || game.phase !== "guess" || !card || card.revealed) return;
    game.pendingGuess = null; card.revealed = true;
    game.log.push({actor:player.name, text:`დაადასტურა „${card.word}“.`});
    if (card.type === "assassin") return finish(room, player.team === "blue" ? "red" : "blue", "შავი აგენტი გაიხსნა — ოპერაცია ჩავარდა.");
    if (card.type === "blue" || card.type === "red") {
      game.remaining[card.type]--;
      if (game.remaining[card.type] === 0) return finish(room, card.type, "გუნდმა ყველა თავისი აგენტი იპოვა.");
    }
    if (card.type !== player.team) switchTurn(game);
    else if (game.guessesLeft !== 99 && --game.guessesLeft === 0) switchTurn(game);
    emitRoom(room);
  } else if (event === "end-turn") {
    const game = room.game;
    if (game && !game.winner && player.role === "operative" && player.team === game.turn && game.phase === "guess") { switchTurn(game); emitRoom(room); }
  } else if (event === "back-to-lobby" && player.host) {
    room.game = null; emitRoom(room); broadcastLobby();
  } else if (event === "leave-room") {
    const index = room.players.findIndex(item => item.id === player.id);
    if (index >= 0) room.players.splice(index, 1);
    Object.assign(clients.get(clientId)!, {room:undefined, player:undefined});
    if (player.host && room.players.length) { room.players[0].host = true; room.hostId = room.players[0].id; }
    if (!room.players.length) rooms.delete(room.code); else emitRoom(room);
    broadcastLobby();
  }
}

export async function handleGameRequest(request: Request, db: D1Database): Promise<Response | null> {
  const url = new URL(request.url);
  const primary = db.withSession("first-primary");
  if (url.pathname === "/api/connect" && request.method === "POST") {
    await loadState(primary);
    const now = Date.now();
    clients.forEach((client, clientId) => { if (now - client.lastSeen > 120_000) clients.delete(clientId); });
    const clientId = id();
    clients.set(clientId, {queue:[], lastSeen:now});
    await saveState(primary);
    return Response.json({clientId});
  }
  if (url.pathname === "/api/event" && request.method === "POST") {
    await loadState(primary);
    const message = await request.json() as any;
    const client = clients.get(message?.clientId);
    if (!client) return Response.json({error:"expired"}, {status:410});
    client.lastSeen = Date.now();
    handle(message.clientId, message.event, message.data);
    await saveState(primary);
    return Response.json({ok:true});
  }
  if (url.pathname === "/api/poll" && request.method === "GET") {
    await loadState(primary);
    const clientId = url.searchParams.get("client") || "";
    const client = clients.get(clientId);
    if (!client) return Response.json({error:"expired"}, {status:410});
    client.lastSeen = Date.now();
    const queue = client.queue.splice(0, 100);
    await saveState(primary);
    return Response.json(queue, {headers:{"cache-control":"no-store"}});
  }
  return null;
}
