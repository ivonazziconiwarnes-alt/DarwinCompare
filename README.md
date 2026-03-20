# Comparador ML Web Pro + Supabase + Login

Esta versión guarda comparaciones en **Supabase** y protege el acceso con usuario y contraseña.

## Login por defecto

- Usuario: `Darwin`
- Contraseña: `Warnes1102`

Podés cambiarlo con variables de entorno.

## Qué trae

- Guardado real online
- Categorías
- Nombre de comparación
- Nombre y URL por competidor
- Comparación 100% por URL
- Foto ampliable
- Exportación a Excel
- Interfaz minimalista
- Editor que se abre con botón
- Login simple por cookie firmado

## Variables de entorno

Creá `.env.local` con:

```env
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SECRET_KEY=TU_SECRET_KEY
APP_USERNAME=Darwin
APP_PASSWORD=Warnes1102
APP_SESSION_SECRET=darwin-warnes-1102-session-secret
```

## SQL para Supabase

```sql
create extension if not exists pgcrypto;

create table if not exists public.comparisons (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Nueva comparación',
  category text not null default 'General',
  my_name text not null default 'Mi publicación',
  my_url text not null default '',
  last_result jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.comparison_competitors (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.comparisons(id) on delete cascade,
  name text not null,
  url text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists comparison_competitors_comparison_id_idx
  on public.comparison_competitors (comparison_id, position);
```

## Probar localmente

```bash
npm install
npm run dev
```

Abrí `http://localhost:3000`.
