import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL="https://example.supabase.co";
process.env.SUPABASE_ANON_KEY="anon-key";

const auth=await import("../discord/auth.js");
const {profileFromUser,verifyAccessToken,authorizeUrl,injectFetch}=auth;

const discordUser=(overrides={})=>({
  id:"11111111-2222-3333-4444-555555555555",
  user_metadata:{avatar_url:"https://cdn.discordapp.com/avatars/998877/abc123.png",full_name:"ნინო",provider_id:"998877",...overrides.meta},
  identities:[{provider:"discord",id:"998877",identity_data:{user_name:"nino",...overrides.identity}}],
  ...overrides.user
});

test("profileFromUser იღებს Discord ID-ს, სახელს და ფოტოს", () => {
  const profile=profileFromUser(discordUser());
  assert.equal(profile.discordId,"998877");
  assert.equal(profile.name,"ნინო");
  assert.equal(profile.avatarUrl,"https://cdn.discordapp.com/avatars/998877/abc123.png?size=128");
  assert.equal(profile.userId,"11111111-2222-3333-4444-555555555555");
});

test("სახელი 18 სიმბოლოზე გრძელი არ რჩება", () => {
  const profile=profileFromUser(discordUser({meta:{full_name:"ძალიან-ძალიან-გრძელი-სახელი-რომელიც-არ-ეტევა"}}));
  assert.ok(profile.name.length<=18);
});

test("სხვისი დომენის ფოტო არ მიიღება", () => {
  const profile=profileFromUser(discordUser({meta:{avatar_url:"https://evil.example.com/tracker.png"}}));
  assert.equal(profile.avatarUrl,null);
});

test("Discord identity-ის გარეშე პროფილი არ იქმნება", () => {
  assert.equal(profileFromUser({id:"x",user_metadata:{},identities:[{provider:"google",id:"g1"}]}),null);
  assert.equal(profileFromUser(null),null);
});

test("authorizeUrl სწორ redirect_to-ს აშენებს", () => {
  const url=authorizeUrl("https://saidumlo.ge/room/AB3K9");
  assert.ok(url.startsWith("https://example.supabase.co/auth/v1/authorize?provider=discord"));
  assert.ok(url.includes(encodeURIComponent("https://saidumlo.ge/room/AB3K9")));
});

test("verifyAccessToken Supabase-ს ეკითხება და თავად ამოწმებს", async () => {
  const calls=[];
  injectFetch(async(url,init)=>{
    calls.push({url:String(url),auth:init.headers.authorization,apikey:init.headers.apikey});
    return {ok:true,status:200,json:async()=>discordUser()}
  });
  const profile=await verifyAccessToken("token-abc");
  assert.equal(profile.discordId,"998877");
  assert.equal(calls[0].url,"https://example.supabase.co/auth/v1/user");
  assert.equal(calls[0].auth,"Bearer token-abc");
  assert.equal(calls[0].apikey,"anon-key");
  // მეორედ იგივე token — ქეშიდან, ახალი მოთხოვნის გარეშე
  await verifyAccessToken("token-abc");
  assert.equal(calls.length,1);
});

test("არასწორი token null-ს აბრუნებს", async () => {
  injectFetch(async()=>({ok:false,status:401,json:async()=>({}),text:async()=>"unauthorized"}));
  assert.equal(await verifyAccessToken("bogus-token"),null);
  assert.equal(await verifyAccessToken(""),null);
  assert.equal(await verifyAccessToken(undefined),null);
});

test("ქსელის შეცდომა არ აგდებს გამონაკლისს", async () => {
  injectFetch(async()=>{throw new Error("network down")});
  assert.equal(await verifyAccessToken("token-xyz"),null);
});
