// დიაგნოსტიკა: npm run discord:check
// ამოწმებს ტოკენს, სერვერზე წვდომას, უფლებებს და Supabase-ის ცხრილებს.
import {config,discordEnabled,interactionsEnabled,supabaseEnabled} from "./config.js";
import {request} from "./rest.js";

const ok=text=>console.log(` ✓ ${text}`);
const bad=text=>{console.log(` ✗ ${text}`);failures++};
const info=text=>console.log(`   ${text}`);
let failures=0;

const PERMISSIONS={MUTE_MEMBERS:1n<<22n,MOVE_MEMBERS:1n<<24n,MANAGE_CHANNELS:1n<<4n,VIEW_CHANNEL:1n<<10n,SEND_MESSAGES:1n<<11n};
const REQUIRED=[["MUTE_MEMBERS","mute რეჟიმისთვის"],["MOVE_MEMBERS","hardcore რეჟიმისთვის"],["VIEW_CHANNEL","არხების დანახვა"],["SEND_MESSAGES","ოთახის ბარათის გაგზავნა"]];
const OPTIONAL=[["MANAGE_CHANNELS","hardcore-ის დროებითი არხის შექმნა"]];

console.log("\n— Discord —");
if(!discordEnabled())bad("DISCORD_BOT_TOKEN / DISCORD_APP_ID აკლია");
else{
  const me=await request("GET","/users/@me").catch(error=>({error}));
  if(me?.error)bad(`ტოკენი არ მუშაობს: ${me.error.message}`);
  else{ok(`ბოტი: ${me.username}#${me.discriminator} (${me.id})`);
    if(me.id!==config.appId)bad(`ბოტის ID (${me.id}) არ ემთხვევა DISCORD_APP_ID-ს (${config.appId})`)}
}
console.log(interactionsEnabled()?" ✓ PUBLIC_KEY დაყენებულია":" ✗ DISCORD_PUBLIC_KEY აკლია — interactions ვერ იმუშავებს");
if(!interactionsEnabled())failures++;
info(`Interactions Endpoint URL: ${config.baseUrl}/api/discord/interactions`);

const invite=(permissions)=>`https://discord.com/oauth2/authorize?client_id=${config.appId}&permissions=${permissions}&scope=bot+applications.commands`;
const fullPermissions=[...Object.values(PERMISSIONS)].reduce((sum,bit)=>sum|bit,0n);

console.log("\n— სერვერი (guild) —");
if(!config.guildId){
  ok("DISCORD_GUILD_ID არ არის — ბრძანებები გლობალურად დარეგისტრირდება");
  info("guild_id ყოველ interaction-ში მოდის, ამიტომ ხმის კონტროლი ისედაც იმუშავებს");
  info(`ბოტის დამატების ბმული: ${invite(fullPermissions)}`)
}else{
  const guild=await request("GET",`/guilds/${config.guildId}`).catch(error=>({error}));
  if(guild?.error)bad(`სერვერზე წვდომა არ არის (${guild.error.status}) — ბოტი დამატებულია? ${invite(fullPermissions)}`);
  else{
    ok(`სერვერი: ${guild.name}`);
    const member=await request("GET",`/guilds/${config.guildId}/members/${config.appId}`).catch(error=>({error}));
    const roles=await request("GET",`/guilds/${config.guildId}/roles`).catch(()=>[]);
    if(member?.error)bad("ბოტის წევრობა ვერ წავიკითხე");
    else{
      const botRoles=(roles||[]).filter(role=>member.roles.includes(role.id));
      const permissions=botRoles.reduce((sum,role)=>sum|BigInt(role.permissions),0n);
      const admin=(permissions&(1n<<3n))===(1n<<3n);
      for(const [name,why] of REQUIRED){
        const has=admin||(permissions&PERMISSIONS[name])===PERMISSIONS[name];
        if(has)ok(`${name} — ${why}`);else bad(`${name} აკლია — ${why}`)
      }
      for(const [name,why] of OPTIONAL){
        const has=admin||(permissions&PERMISSIONS[name])===PERMISSIONS[name];
        console.log(has?` ✓ ${name} — ${why}`:` ! ${name} არ არის — ${why} (გამოვიყენებთ DISCORD_SPYMASTER_CHANNEL_ID-ს)`)
      }
      const botTop=Math.max(...botRoles.map(role=>role.position),0);
      const above=(roles||[]).filter(role=>role.position>botTop&&!role.managed&&role.name!=="@everyone");
      if(above.length)info(`ყურადღება: ${above.length} როლი ბოტზე მაღლა დგას (${above.slice(0,3).map(role=>role.name).join(", ")}) — მათ წევრებს ვერ დავამუტებთ`);
      else ok("ბოტის როლი საკმარისად მაღლაა")
    }
  }
}

console.log("\n— Discord ლოგინი (Supabase Auth) —");
if(!config.supabaseAnonKey)bad("SUPABASE_ANON_KEY აკლია — საიტზე Discord-ით შესვლა ვერ იმუშავებს");
else{
  const {authSettings}=await import("./auth.js");
  const settings=await authSettings().catch(()=>null);
  if(!settings)bad("Supabase Auth-ის პარამეტრები ვერ წავიკითხე");
  else if(settings.external?.discord)ok("Discord provider ჩართულია Supabase-ში");
  else bad("Discord provider გამორთულია — Supabase → Authentication → Providers");
  info(`დაბრუნების მისამართი უნდა იყოს დაშვებული: ${config.baseUrl}/**`)
}

console.log("\n— Supabase —");
if(!supabaseEnabled())bad("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY აკლია (ბმულები მეხსიერებაში იმუშავებს)");
else{
  for(const table of ["discord_links","discord_voice_state"]){
    const response=await fetch(`${config.supabaseUrl}/rest/v1/${table}?select=*&limit=1`,{headers:{apikey:config.supabaseKey,authorization:`Bearer ${config.supabaseKey}`}});
    if(response.ok)ok(`ცხრილი ${table} მზადაა`);
    else if(response.status===404||(await response.clone().text()).includes("does not exist"))bad(`ცხრილი ${table} არ არსებობს — გაუშვი db/migrations/discord.sql`);
    else bad(`ცხრილი ${table}: ${response.status} ${await response.text()}`)
  }
  // ნამდვილი ჩაწერა/წაკითხვა/წაშლა — რომ სვეტებიც გადამოწმდეს, არა მარტო ცხრილის არსებობა
  const store=await import("./store.js");
  try{
    const token=store.linkToken();
    await store.saveLink({token,discordId:"check-user",guildId:"check-guild",roomCode:"CHECK"});
    const link=await store.takeLink(token);
    if(link?.discordId==="check-user"&&link.roomCode==="CHECK")ok("discord_links: ჩაწერა/წაკითხვა/წაშლა მუშაობს");
    else bad("discord_links: ჩანაწერი ვერ დაბრუნდა");
    if(await store.takeLink(token))bad("discord_links: ერთჯერადი token არ იშლება");
  }catch(error){bad(`discord_links: ${error.message}`)}
  try{
    await store.rememberVoice({discordId:"check-user",guildId:"check-guild",roomCode:"CHECK",muted:true,homeChannelId:"check-channel"});
    const rows=await store.pendingVoice();
    const row=rows.find(item=>item.discordId==="check-user");
    if(row?.muted&&row.homeChannelId==="check-channel")ok("discord_voice_state: ჩაწერა/წაკითხვა მუშაობს");else bad("discord_voice_state: ჩანაწერი ვერ დაბრუნდა");
    await store.forgetVoice("check-guild","check-user");
    if((await store.pendingVoice()).some(item=>item.discordId==="check-user"))bad("discord_voice_state: წაშლა არ მუშაობს");
    else ok("discord_voice_state: გასუფთავება მუშაობს");
  }catch(error){bad(`discord_voice_state: ${error.message}`)}
}

console.log(`\n${failures?`დარჩა ${failures} გასასწორებელი.`:"ყველაფერი მზადაა."}\n`);
process.exit(failures?1:0);
