// სლეშ-ბრძანებების რეგისტრაცია: npm run discord:register
// DISCORD_GUILD_ID არასავალდებულოა — თუ არ არის, გლობალურად რეგისტრირდება
// (მუშაობს ყველა სერვერზე, სადაც ბოტია, უბრალოდ გავრცელებას ~1 საათი სჭირდება).
import {config,discordEnabled} from "./config.js";
import {registerGlobalCommands,registerGuildCommands} from "./rest.js";
import {COMMANDS} from "./interactions.js";

if(!discordEnabled()){
  console.error("DISCORD_BOT_TOKEN / DISCORD_APP_ID აკლია — ჯერ .env შეავსე.");
  process.exit(1)
}
const scope=config.guildId?`სერვერზე ${config.guildId}`:"გლობალურად";
const result=config.guildId
  ? await registerGuildCommands(config.appId,config.guildId,COMMANDS)
  : await registerGlobalCommands(config.appId,COMMANDS);
console.log(`დარეგისტრირდა ${result?.length??0} ბრძანება ${scope}:`);
for(const command of result||[])console.log(` /${command.name} — ${(command.options||[]).map(option=>option.name).join(", ")}`);
if(!config.guildId)console.log("\nშენიშვნა: გლობალურ ბრძანებებს Discord-ში გამოჩენა ~1 საათამდე სჭირდება.\nმყისიერი განახლებისთვის შეავსე DISCORD_GUILD_ID და თავიდან გაუშვი.");
