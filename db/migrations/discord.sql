-- Supabase სქემა Discord ინტეგრაციისთვის.
-- გაუშვი Supabase → SQL Editor-ში ერთხელ.

-- ერთჯერადი ბმულის token-ები: Discord ანგარიში ↔ ოთახის მოთამაშე.
create table if not exists public.discord_links (
  token text primary key,
  discord_id text not null,
  guild_id text not null,
  room_code text not null,
  player_id text,
  created_at timestamptz not null default now()
);
create index if not exists discord_links_room_idx on public.discord_links (room_code);
create index if not exists discord_links_created_idx on public.discord_links (created_at);

-- ვისზეა ამჟამად ხმოვანი შეზღუდვა — ავარიის შემდეგ აღდგენისთვის.
create table if not exists public.discord_voice_state (
  discord_id text not null,
  guild_id text not null,
  room_code text,
  muted boolean not null default false,
  home_channel_id text,
  updated_at timestamptz not null default now(),
  primary key (guild_id, discord_id)
);

-- ცხრილებს მხოლოდ სერვერი (service role) წვდება, ამიტომ RLS ჩართულია პოლიტიკის გარეშე.
alter table public.discord_links enable row level security;
alter table public.discord_voice_state enable row level security;

-- ძველი, გამოუყენებელი ბმულების წაშლა (სურვილისამებრ, pg_cron-ით).
-- delete from public.discord_links where created_at < now() - interval '1 day';
