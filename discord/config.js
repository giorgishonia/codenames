// Discord ხმოვანი კონტროლის კონფიგურაცია.
// ყველა მნიშვნელობა env-იდან მოდის; თუ ტოკენი არ არის, ინტეგრაცია ჩუმად ითიშება.
export const VOICE_MODES=["off","mute","hardcore"];
export const DEFAULT_VOICE_MODE="mute";
export const voiceMode=value=>VOICE_MODES.includes(value)?value:DEFAULT_VOICE_MODE;

// რამდენ ხანს რჩება მიკროფონი ღია ხელმძღვანელისთვის.
export const CLUE_WINDOW_MS=Number(process.env.DISCORD_CLUE_WINDOW_MS)||20_000;
export const REACTION_WINDOW_MS=Number(process.env.DISCORD_REACTION_WINDOW_MS)||4_000;

export const config={
  token:process.env.DISCORD_BOT_TOKEN||"",
  appId:process.env.DISCORD_APP_ID||"",
  publicKey:process.env.DISCORD_PUBLIC_KEY||"",
  guildId:process.env.DISCORD_GUILD_ID||"",
  spymasterChannelId:process.env.DISCORD_SPYMASTER_CHANNEL_ID||"",
  baseUrl:(process.env.PUBLIC_BASE_URL||"http://localhost:3000").replace(/\/+$/,""),
  supabaseUrl:(process.env.SUPABASE_URL||"").replace(/\/+$/,""),
  supabaseKey:process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_KEY||"",
  supabaseAnonKey:process.env.SUPABASE_ANON_KEY||""
};
export const discordEnabled=()=>Boolean(config.token&&config.appId);
export const interactionsEnabled=()=>Boolean(config.publicKey);
export const supabaseEnabled=()=>Boolean(config.supabaseUrl&&config.supabaseKey);
// Discord-ით შესვლა მხოლოდ საჯარო (anon) გასაღებს საჭიროებს.
export const authEnabled=()=>Boolean(config.supabaseUrl&&config.supabaseAnonKey);
