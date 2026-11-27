-- 대시보드 기본 스키마: 모든 행은 소유자(user_id)만 읽고 쓸 수 있음 (RLS)

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null default current_date,
  text text not null check (char_length(text) between 1 and 500),
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists todos_user_day_idx on public.todos (user_id, day);

create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ideas_user_created_idx on public.ideas (user_id, created_at desc);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  starts_at timestamptz not null,
  all_day boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists events_user_starts_idx on public.events (user_id, starts_at);

-- RLS: 본인 데이터만
alter table public.todos  enable row level security;
alter table public.ideas  enable row level security;
alter table public.events enable row level security;

do $$
declare t text;
begin
  foreach t in array array['todos', 'ideas', 'events'] loop
    execute format('drop policy if exists "owner_all" on public.%I', t);
    execute format(
      'create policy "owner_all" on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
