# Comparador ML Web + Worker

Esta version deja la arquitectura en modo `web-first`.

## Como queda armado

### Web

La app web queda como panel central para:

- login
- alta y edicion de comparaciones
- cola de ejecucion
- ultimo resultado
- historial de corridas
- exportacion a Excel

### Worker Python

El motor real de actualizacion vive en `C:\FINAL\Comparacion MELI\web_compare_worker.py`.

Ese worker:

- toma jobs desde la web
- usa la logica de Mercado Libre
- intenta API publica
- intenta API autenticada si hace falta
- usa Playwright al final como fallback
- devuelve el resultado a la web

### Supabase

Supabase queda como fuente central para:

- comparaciones
- competidores
- ultimo resultado
- historial de corridas
- filas de cada corrida

## Flujo final

1. El usuario crea o edita una comparacion desde la web.
2. La web guarda todo en Supabase.
3. El usuario toca `Actualizar ahora`.
4. Se crea una corrida en cola.
5. El worker reclama la corrida.
6. El worker ejecuta la comparacion real.
7. El worker guarda resumen y filas.
8. La web muestra estado, historial y ultimo resultado.

## Variables de entorno

Usar `.env.local` con estas variables:

```env
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SECRET_KEY=TU_SECRET_KEY

APP_USERNAME=TU_USUARIO
APP_PASSWORD=TU_PASSWORD
APP_SESSION_SECRET=TU_SECRETO_DE_SESSION

DESKTOP_SYNC_TOKEN=TOKEN_PARA_SYNC_DESKTOP
WORKER_SYNC_TOKEN=TOKEN_PARA_WORKER
```

Nota:

- `WORKER_SYNC_TOKEN` puede ser el mismo valor que `DESKTOP_SYNC_TOKEN` si queres simplificar.
- la UI ya no viene precompletada con credenciales hardcodeadas.

## SQL

Aplicar el script:

- `supabase/worker_schema.sql`

Ese script crea o completa:

- `comparisons`
- `comparison_competitors`
- `comparison_runs`
- `comparison_run_rows`

## Worker

### Ejecutar una sola vez

```bash
python C:\FINAL\Comparacion MELI\web_compare_worker.py --once
```

### Ejecutar en loop

```bash
python C:\FINAL\Comparacion MELI\web_compare_worker.py
```

### Abrir login manual de ML

```bash
python C:\FINAL\Comparacion MELI\web_compare_worker.py --open-login
```

## Estado del compare legacy

La ruta `/api/compare` queda deshabilitada a proposito.

La arquitectura nueva ya no usa comparacion directa desde Next.js.
Ahora el camino correcto es:

- guardar
- encolar corrida
- procesar con worker

## Build validado

Se valido:

- `npm.cmd run build`
- `python -m py_compile C:\FINAL\Comparacion MELI\web_compare_worker.py`
