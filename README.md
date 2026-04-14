# Comparador ML Web

Esta version queda lista para trabajar 100% web.

## Como funciona

La app web hace todo desde Next.js:

- login
- alta y edicion de comparaciones
- lectura de Mercado Libre por API publica
- fallback web cuando hace falta
- fallback remoto con Browserless si ML bloquea el acceso simple
- guardado del ultimo resultado
- historial de corridas cuando la tabla existe
- exportacion a Excel
- collector externo opcional para sacar la corrida pesada fuera de Vercel

## Flujo de uso

1. Ingresas al panel.
2. Creas o editas una comparacion.
3. Guardas si hiciste cambios.
4. Tocas `Actualizar ahora`.
5. La web encola la corrida y la deja en estado `running`.
6. El collector reclama el job pendiente, ejecuta la comparacion y publica el resultado.
7. La pantalla refresca sola y muestra el resultado final.

La web puede funcionar sola, pero para evitar timeouts y acercarse a 0 filas sin actualizar conviene usar el collector.

## Variables de entorno

Configura estas variables en `.env.local` o en Vercel:

```env
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SECRET_KEY=TU_SECRET_KEY

APP_USERNAME=TU_USUARIO
APP_PASSWORD=TU_PASSWORD
APP_SESSION_SECRET=TU_SECRETO_DE_SESSION

# Opcional pero recomendado
BROWSERLESS_TOKEN=TU_BROWSERLESS_TOKEN
BROWSERLESS_REGION=production-sfo

# Requerido para el collector externo
APP_BASE_URL=https://darwin-compare.vercel.app
WORKER_SYNC_TOKEN=UN_TOKEN_LARGO_Y_PRIVADO
WORKER_ID=collector-windows
WORKER_POLL_INTERVAL_MS=5000
```

Tambien puedes usar `SUPABASE_SERVICE_ROLE_KEY` en lugar de `SUPABASE_SECRET_KEY`.

## Supabase

El archivo `supabase/worker_schema.sql` sigue siendo util porque crea el historial de corridas:

- `comparison_runs`
- `comparison_run_rows`

Si ya tienes solo las tablas base (`comparisons` y `comparison_competitors`), la app igual funciona.
Simplemente no mostrara historial hasta que apliques ese SQL.

## Desarrollo local

```bash
npm run dev
```

## Collector externo

1. Configura en Vercel y en la maquina del collector el mismo `WORKER_SYNC_TOKEN`.
2. En la maquina donde correra el collector deja seteados:

- `APP_BASE_URL`
- `WORKER_SYNC_TOKEN`
- `BROWSERLESS_TOKEN` si usaras Browserless
- `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET` y `MELI_REFRESH_TOKEN` si usaras API autenticada

3. En la maquina donde correra el collector:

```bash
npm install
npm run collector
```

Si quieres probar una sola corrida:

```bash
npm run collector:once
```

El collector:

- reclama jobs desde `/api/worker/runs/claim`
- ejecuta la comparacion fuera de Vercel
- publica el resultado en `/api/worker/runs/{id}/complete`

## Build

```bash
npm run build
```
