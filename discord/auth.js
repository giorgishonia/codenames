import {authEnabled,config} from "./config.js";

// Supabase Auth (Discord provider). კლიენტი გვიგზავნის access_token-ს,
// სერვერი მას თვითონ ამოწმებს Supabase-თან — კლიენტის ნათქვამს არ ვენდობით.
let doFetch=(...args)=>globalThis.fetch(...args);
export function injectFetch(fn){doFetch=fn}

const cache=new Map();// token → {profile, expires}
const CACHE_MS=60_000;

export function authorizeUrl(redirectTo){
  const target=`${config.supabaseUrl}/auth/v1/authorize`;
  return `${target}?provider=discord&redirect_to=${encodeURIComponent(redirectTo)}`
}

// Discord-ის ავატარი Supabase-ის მეტამონაცემებში სრული URL-ია; ზომას ჩვენ ვამატებთ.
const sizedAvatar=url=>{
  if(!url||!/^https:\/\/cdn\.discordapp\.com\//.test(url))return null;
  const clean=url.split("?")[0];
  return `${clean}?size=128`
};

export function profileFromUser(user){
  if(!user)return null;
  const identity=(user.identities||[]).find(item=>item.provider==="discord");
  const meta={...user.user_metadata,...identity?.identity_data};
  const discordId=identity?.id||meta.provider_id||meta.sub||null;
  if(!discordId)return null;
  return {
    userId:user.id,
    discordId:String(discordId),
    name:(meta.custom_claims?.global_name||meta.full_name||meta.name||meta.user_name||meta.preferred_username||"").trim().slice(0,18),
    avatarUrl:sizedAvatar(meta.avatar_url||meta.picture)
  }
}

export async function verifyAccessToken(token){
  if(!authEnabled()||!token)return null;
  const cached=cache.get(token);
  if(cached&&cached.expires>Date.now())return cached.profile;
  try{
    const response=await doFetch(`${config.supabaseUrl}/auth/v1/user`,{
      headers:{apikey:config.supabaseAnonKey,authorization:`Bearer ${token}`}
    });
    if(!response.ok)return null;
    const profile=profileFromUser(await response.json());
    if(profile){
      cache.set(token,{profile,expires:Date.now()+CACHE_MS});
      if(cache.size>500)cache.delete(cache.keys().next().value)
    }
    return profile
  }catch{return null}
}

// რომელი პროვაიდერებია ჩართული პროექტში (დიაგნოსტიკისთვის).
export async function authSettings(){
  if(!authEnabled())return null;
  const response=await doFetch(`${config.supabaseUrl}/auth/v1/settings`,{headers:{apikey:config.supabaseAnonKey}});
  return response.ok?response.json():null
}
