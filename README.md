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

## Flujo de uso

1. Ingresas al panel.
2. Creas o editas una comparacion.
3. Guardas si hiciste cambios.
4. Tocas `Actualizar ahora`.
5. La API ejecuta la comparacion en ese mismo momento.
6. El resultado vuelve a Supabase y aparece en pantalla.

No hace falta un worker Python ni una app local prendida.

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

## Build

```bash
npm run build
```
