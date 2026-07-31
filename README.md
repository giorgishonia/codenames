# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Discord-ით შესვლა (Supabase Auth)

მოთამაშე თავსართში აჭერს **„Discord-ით შესვლა“**-ს → Supabase → Discord → ბრუნდება საიტზე.
რას გვაძლევს:

- **პროფილის ფოტო** — Discord-ის ავატარი ჩნდება ლობიში, თამაშში, ბარათებზე მონიშვნისას და ოთახების სიაში
- **ავტომატური მიბმა ბოტთან** — შესულ მოთამაშეს Discord ID ისედაც აქვს, ამიტომ ხმის კონტროლს
  `/saidumlo join`-ის ბმული აღარ სჭირდება

access_token-ს **სერვერი თვითონ ამოწმებს** Supabase-თან (`/auth/v1/user`) — კლიენტის ნათქვამს არ ვენდობით.
`discordId` და Supabase-ის user id კლიენტებს არასოდეს ეგზავნება, მხოლოდ `discord: true` და ავატარის URL.
ავატარი მიიღება მხოლოდ `cdn.discordapp.com`-იდან.

**Supabase-ში საჭიროა:** Authentication → Providers → Discord ჩართული (Client ID/Secret იმავე
აპლიკაციიდან), და Authentication → URL Configuration → Redirect URLs-ში დამატებული შენი დომენი
(`http://localhost:3000/**` ლოკალურად ისედაც მუშაობს).

## Discord ბოტი — ხელმძღვანელის მიკროფონი

ბოტი აკონტროლებს ხელმძღვანელების ხმას თამაშის ფაზების მიხედვით. gateway/websocket
პროცესი არ სჭირდება — მუშაობს Discord REST + Interactions Endpoint-ით.

### რეჟიმები (მასპინძელი ცვლის ოთახის პარამეტრებში ან `/saidumlo mode`-ით)

| რეჟიმი | რას აკეთებს |
|---|---|
| `off` | ხმას საერთოდ არ ეხება |
| `mute` | ხელმძღვანელები დამუტებულები არიან მსჯელობისას; ღიაა მინიშნების (20წმ) და ბარათის გახსნის (4წმ) ფანჯრები |
| `hardcore` | ხელმძღვანელები მსჯელობის მთელი დროით ცალკე ხმოვან არხში გადადიან (მინიშნების ფანჯარა რჩება) |

ორივე გუნდის ხელმძღვანელი ერთდროულად იზღუდება — მეტოქესაც არ შეუძლია რეაქციით ინფორმაციის გაცემა.

### გაშვება

1. `cp .env.example .env` და შეავსე: `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`,
   `DISCORD_PUBLIC_KEY`, `PUBLIC_BASE_URL`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
   (`DISCORD_GUILD_ID` არასავალდებულოა — მხოლოდ ბრძანებების რეგისტრაციაზე მოქმედებს)
2. Supabase → SQL Editor → გაუშვი `db/migrations/discord.sql`
3. ბოტი დაამატე სერვერზე უფლებებით: **Mute Members**, **Move Members**,
   `applications.commands` (hardcore-ის ავტომატური არხისთვის — **Manage Channels**).
   ბოტის როლი მოთამაშეების როლებზე მაღლა უნდა იდგეს.
4. `npm run discord:register` — სლეშ-ბრძანებების რეგისტრაცია
5. Developer Portal → General Information → **Interactions Endpoint URL**:
   `https://<შენი დომენი>/api/discord/interactions`
6. `npm run dev`

### ბრძანებები

- `/saidumlo start [name] [channel] [mode]` — ოთახის შექმნა მიმდინარე ხმოვანი არხისთვის
- `/saidumlo join` — პირადი ბმული (Discord ანგარიშს აბამს მოთამაშეს)
- `/saidumlo mode <off|mute|hardcore>` — რეჟიმის შეცვლა (მასპინძელი/მოდერატორი)
- `/saidumlo free` — სასწრაფო: ყველას დაუბრუნებს ხმას
- `/saidumlo status` — მიმდინარე მდგომარეობა

ტოკენების გარეშე პროექტი ჩვეულებრივ მუშაობს — Discord ინტეგრაცია ჩუმად ითიშება.
`npm run discord:check` ამოწმებს ყველაფერს: ტოკენს, სერვერზე წვდომას, უფლებებს,
ბოტის როლის პოზიციას, Discord provider-ს და Supabase-ის ცხრილებს (ნამდვილი ჩაწერა/წაშლით).

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
