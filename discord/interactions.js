import {VOICE_MODES,config,voiceMode} from "./config.js";
import * as rest from "./rest.js";
import * as store from "./store.js";
import {MUTED,AWAY} from "./policy.js";

const PING=1,COMMAND=2,COMPONENT=3;
const PONG=1,REPLY=4;
const EPHEMERAL=64;
const MUTE_MEMBERS=1n<<22n;
const MODE_LABELS={off:"გამორთული — ხმას არ ვეხებით",mute:"დამუტება — ხელმძღვანელი ჩუმდება მსჯელობისას",hardcore:"ჰარდქორი — ხელმძღვანელი ცალკე არხში გადადის"};

export const COMMANDS=[{
  name:"saidumlo",
  description:"საიდუმლო სიტყვა — ხმოვანი კონტროლი და ოთახები",
  options:[
    {type:1,name:"start",description:"ახალი ოთახის შექმნა ამ ხმოვანი არხისთვის",options:[
      {type:3,name:"name",description:"ოთახის სახელი",required:false,max_length:28},
      {type:7,name:"channel",description:"ხმოვანი არხი (ავტომატურად შენი არხი)",required:false,channel_types:[2]},
      {type:3,name:"mode",description:"ხმოვანი რეჟიმი",required:false,choices:VOICE_MODES.map(value=>({name:MODE_LABELS[value],value}))}
    ]},
    {type:1,name:"join",description:"პირადი ბმულის მიღება მიმდინარე ოთახში"},
    {type:1,name:"mode",description:"ხმოვანი რეჟიმის შეცვლა (მასპინძელი)",options:[
      {type:3,name:"value",description:"რეჟიმი",required:true,choices:VOICE_MODES.map(value=>({name:MODE_LABELS[value],value}))}
    ]},
    {type:1,name:"free",description:"სასწრაფო: ყველას დაუბრუნე ხმა"},
    {type:1,name:"status",description:"მიმდინარე ოთახის მდგომარეობა"}
  ]
}];

const reply=(content,extra={})=>({type:REPLY,data:{content,flags:EPHEMERAL,...extra}});
const publicReply=(content,extra={})=>({type:REPLY,data:{content,...extra}});
const userId=body=>body.member?.user?.id||body.user?.id;
const userName=body=>body.member?.nick||body.member?.user?.global_name||body.member?.user?.username||body.user?.username||"აგენტი";
const canModerate=body=>(BigInt(body.member?.permissions||"0")&MUTE_MEMBERS)===MUTE_MEMBERS;
const option=(options,name)=>options?.find(item=>item.name===name)?.value;

async function personalLink(room,discordId,guildId){
  const token=store.linkToken();
  await store.saveLink({token,discordId,guildId,roomCode:room.code});
  return `${config.baseUrl}/room/${room.code}?d=${token}`
}

function roomCard(room,url){
  return {
    embeds:[{
      title:`🕵️ ${room.name}`,
      description:`ოთახის კოდი: **${room.code}**\nხმოვანი რეჟიმი: **${MODE_LABELS[voiceMode(room.settings?.voiceMode)]}**\n\nდააჭირე ღილაკს და მიიღებ პირად ბმულს — ის შენს Discord ანგარიშს დაუკავშირებს მოთამაშეს.`,
      color:0x019ffd
    }],
    components:[{type:1,components:[
      {type:2,style:1,label:"შემიერთე",custom_id:`join:${room.code}`},
      {type:2,style:5,label:"ბრაუზერში გახსნა",url}
    ]}]
  }
}

export async function handleInteraction(body,api){
  if(body.type===PING)return {type:PONG};
  const guildId=body.guild_id||config.guildId;
  if(!guildId)return reply("ეს ბრძანება მხოლოდ სერვერზე მუშაობს.");

  if(body.type===COMPONENT){
    const [action,code]=String(body.data?.custom_id||"").split(":");
    if(action!=="join")return reply("უცნობი ღილაკი.");
    const room=api.roomByCode(code);
    if(!room)return reply("ოთახი ვეღარ მოიძებნა — შექმენი ახალი `/saidumlo start`.");
    const url=await personalLink(room,userId(body),guildId);
    return reply(`შენი პირადი ბმული: ${url}\n(ბმული ერთჯერადია და შენს ანგარიშზეა მიბმული)`)
  }

  if(body.type!==COMMAND)return reply("უცნობი მოთხოვნა.");
  const sub=body.data?.options?.[0];
  const options=sub?.options;

  if(sub?.name==="start"){
    let channelId=option(options,"channel");
    if(!channelId){
      const state=await rest.voiceState(guildId,userId(body)).catch(()=>null);
      channelId=state?.channel_id||null
    }
    if(!channelId)return reply("ჯერ შედი ხმოვან არხში (ან მიუთითე `channel` პარამეტრი).");
    const room=api.createRoom({
      name:option(options,"name")||`${userName(body)}-ის ოთახი`,
      guildId,channelId,
      hostDiscordId:userId(body),
      voiceMode:option(options,"mode")
    });
    const url=await personalLink(room,userId(body),guildId);
    return publicReply("",roomCard(room,url))
  }

  const room=api.roomForChannel(guildId,body.channel_id)||api.roomForGuild(guildId);
  if(!room)return reply("ამ არხზე აქტიური ოთახი არ არის — გამოიყენე `/saidumlo start`.");

  if(sub?.name==="join"){
    const url=await personalLink(room,userId(body),guildId);
    return reply(`შენი პირადი ბმული: ${url}`)
  }
  if(sub?.name==="mode"){
    const host=room.players.find(player=>player.host);
    if(host?.discordId&&host.discordId!==userId(body)&&!canModerate(body))return reply("რეჟიმს მხოლოდ მასპინძელი ან მოდერატორი ცვლის.");
    const mode=voiceMode(option(options,"value"));
    api.setVoiceMode(room,mode);
    return publicReply(`🔊 ხმოვანი რეჟიმი: **${MODE_LABELS[mode]}**`)
  }
  if(sub?.name==="free"){
    if(!canModerate(body)&&!room.players.some(player=>player.host&&player.discordId===userId(body)))return reply("ამის უფლება მხოლოდ მასპინძელს ან მოდერატორს აქვს.");
    await api.releaseRoom(room);
    return publicReply("🔓 ყველა მოთამაშეს დაუბრუნდა ხმა.")
  }
  if(sub?.name==="status"){
    const linked=room.players.filter(player=>player.discordId).length;
    const applied=[...(room.voice?.applied?.values()||[])];
    const restricted=applied.filter(item=>item.state===MUTED||item.state===AWAY).length;
    return reply([
      `**${room.name}** · კოდი \`${room.code}\``,
      `რეჟიმი: ${MODE_LABELS[voiceMode(room.settings?.voiceMode)]}`,
      `მოთამაშეები: ${room.players.length} (Discord-ით დაკავშირებული: ${linked})`,
      `ამჟამად შეზღუდული: ${restricted}`,
      room.game?`ფაზა: ${room.game.winner?"დასრულებულია":room.game.phase==="clue"?"მინიშნება":"მსჯელობა"}`:"თამაში ჯერ არ დაწყებულა"
    ].join("\n"))
  }
  return reply("უცნობი ბრძანება.")
}
