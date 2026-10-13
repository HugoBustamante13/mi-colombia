-- =============================================================================
-- Mi Colombia — esquema de Supabase (sincronización entre dispositivos)
--
-- Cómo usarlo: en tu proyecto de Supabase abre "SQL Editor", pega todo este
-- archivo y ejecútalo una vez. Es idempotente: puedes volver a ejecutarlo.
--
-- Modelo: cada fila pertenece a un usuario (user_id). Las eliminaciones son
-- "lápidas" (borrada = true) para que se propaguen a los demás dispositivos.
-- En cada registro gana el cambio con la marca `actualizada` más reciente.
-- =============================================================================

-- ---------- Tablas ----------

create table if not exists public.visitas (
  user_id      uuid    not null default auth.uid() references auth.users on delete cascade,
  id           text    not null,
  divipola     text    not null check (divipola ~ '^[0-9]{5}$'),
  fecha        date    not null,
  notas        text    not null default '' check (char_length(notas) <= 2000),
  calificacion smallint check (calificacion between 1 and 5),
  creada       bigint  not null,
  actualizada  bigint  not null,
  borrada      boolean not null default false,
  primary key (user_id, id)
);

create table if not exists public.deseos (
  user_id     uuid    not null default auth.uid() references auth.users on delete cascade,
  divipola    text    not null check (divipola ~ '^[0-9]{5}$'),
  creada      bigint  not null,
  actualizada bigint  not null,
  borrada     boolean not null default false,
  primary key (user_id, divipola)
);

create table if not exists public.fotos (
  user_id     uuid    not null default auth.uid() references auth.users on delete cascade,
  id          text    not null,
  divipola    text    not null check (divipola ~ '^[0-9]{5}$'),
  fecha       date,
  ancho       integer,
  alto        integer,
  ruta        text,       -- archivo en el bucket "fotos": <user_id>/<id>.jpg
  ruta_mini   text,       -- miniatura: <user_id>/<id>-mini.jpg
  creada      bigint  not null,
  actualizada bigint  not null,
  borrada     boolean not null default false,
  primary key (user_id, id)
);

create table if not exists public.perfiles (
  user_id     uuid primary key default auth.uid() references auth.users on delete cascade,
  nombre      text not null default '' check (char_length(nombre) <= 60),
  publico     boolean not null default false,
  actualizada timestamptz not null default now()
);

-- ---------- Acceso por la API (algunos proyectos nuevos no lo dan por defecto) ----------

grant select, insert, update, delete on public.visitas, public.deseos, public.fotos, public.perfiles
  to authenticated;

-- ---------- Seguridad por filas: cada quien ve y edita solo lo suyo ----------

alter table public.visitas  enable row level security;
alter table public.deseos   enable row level security;
alter table public.fotos    enable row level security;
alter table public.perfiles enable row level security;

drop policy if exists "propias" on public.visitas;
drop policy if exists "propias" on public.deseos;
drop policy if exists "propias" on public.fotos;
drop policy if exists "propias" on public.perfiles;

create policy "propias" on public.visitas  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "propias" on public.deseos   for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "propias" on public.fotos    for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "propias" on public.perfiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Mapa público de solo lectura ----------
-- Devuelve solo municipio y fecha (nunca notas ni fotos), y solo si el dueño
-- marcó su perfil como público. Lo puede llamar cualquiera, sin iniciar sesión.

create or replace function public.mapa_publico(p_usuario uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'nombre', p.nombre,
    'visitas', coalesce((
      select json_agg(json_build_object('divipola', v.divipola, 'fecha', v.fecha))
      from visitas v where v.user_id = p.user_id and not v.borrada
    ), '[]'::json),
    'deseos', coalesce((
      select json_agg(d.divipola)
      from deseos d where d.user_id = p.user_id and not d.borrada
    ), '[]'::json)
  )
  from perfiles p
  where p.user_id = p_usuario and p.publico;
$$;

revoke all on function public.mapa_publico(uuid) from public;
grant execute on function public.mapa_publico(uuid) to anon, authenticated;

-- ---------- Almacenamiento de fotos (bucket privado) ----------

insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', false)
on conflict (id) do nothing;

drop policy if exists "fotos propias: leer"     on storage.objects;
drop policy if exists "fotos propias: subir"    on storage.objects;
drop policy if exists "fotos propias: cambiar"  on storage.objects;
drop policy if exists "fotos propias: borrar"   on storage.objects;

create policy "fotos propias: leer" on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "fotos propias: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "fotos propias: cambiar" on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "fotos propias: borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
