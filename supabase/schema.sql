-- MIA Sant Cugat · esquema de Supabase
-- Pegar entero en Supabase → SQL Editor → Run. Se puede ejecutar más de una vez.

create table if not exists public.docs (
  collection text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  version    integer     not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid        default auth.uid(),
  primary key (collection, id)
);

create index if not exists docs_collection_idx on public.docs (collection);

-- Marca de quién y cuándo tocó cada ficha
create or replace function public.docs_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs
for each row execute function public.docs_touch();

-- Seguridad: solo usuarias con sesión iniciada (las que des de alta en Authentication).
-- Sin sesión no se puede leer ni escribir nada: hay datos personales de las socias.
alter table public.docs enable row level security;

drop policy if exists "equipo lee"     on public.docs;
drop policy if exists "equipo crea"    on public.docs;
drop policy if exists "equipo edita"   on public.docs;
drop policy if exists "equipo borra"   on public.docs;

create policy "equipo lee"   on public.docs for select to authenticated using (true);
create policy "equipo crea"  on public.docs for insert to authenticated with check (true);
create policy "equipo edita" on public.docs for update to authenticated using (true) with check (true);
create policy "equipo borra" on public.docs for delete to authenticated using (true);

revoke all on public.docs from anon;

-- Tiempo real: que la app se actualice sola cuando otra entrenadora guarda algo
alter table public.docs replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs'
  ) then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;
