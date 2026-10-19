# Ejecución y recuperación del Comparador ML

## Hallazgos confirmados antes de modificar

Revisión de main `75d6247adb65a1ae7f5305d97e4bcbf028c070db`:

- Claim sólo buscaba `pending`; un corte después del claim o una respuesta HTTP perdida dejaba `running` sin recuperación por sondeo.
- La limpieza de 20 minutos sólo ocurría al solicitar otra actualización y no comprobaba actividad real ni propietario.
- Dos solicitudes de actualización podían insertar dos trabajos activos.
- Complete aceptaba cualquier corrida por ID, borraba filas y guardaba en varios pasos. Un cierre tardío/repetido o un fallo intermedio podía reemplazar o dejar incompletos precios/historial.
- El collector convertía un error de transporte al cerrar una ejecución exitosa en un segundo cierre con error.
- PATCH podía restaurar resultados antiguos del navegador; desktop-results escribía sin acreditar propiedad de una ejecución.

Son defectos del protocolo verificados en código. No se consultó producción para afirmar que hayan ocurrido.

## Protocolo nuevo

El servidor usa RPCs transaccionales, SECURITY INVOKER y acceso de ejecución exclusivo a service_role. Un lock transaccional corto compartido serializa las mutaciones de cola; ninguna consulta a Mercado Libre ocurre dentro de él. El índice parcial permite una sola corrida pending/running por comparación incluso frente a inserciones que evadan el enqueue.

Cada claim incrementa attempt y emite un UUID nuevo (leaseToken), ligado al worker. El collector renueva cada 30 segundos un permiso de 2 minutos. Cada sondeo ejecuta recovery antes de reclamar: un permiso vencido vuelve a pending con espera de 30/60 segundos y se reclama sin otra interacción web. Al tercer abandono queda error con fecha de cierre, conservando precios. Un trabajo legítimamente lento renueva el permiso; el límite absoluto de 20 minutos impide renovaciones infinitas. El collector sale a los 19 minutos y su supervisor lo reinicia, evitando que ese mismo proceso acumule ejecuciones colgadas.

Un resultado sólo se acepta para el token y worker actuales, con permiso vigente. Filas, estado, snapshot e historial se guardan en una transacción. Reenviar un cierre aceptado devuelve éxito sin escribir otra vez, incluso si después se inició otra corrida. Un token reemplazado devuelve 409. Los fallos sin precios conservan last_result y last_synced_at. Se mantiene la ventana de 24 puntos del historial de UI y todas las filas históricas en comparison_run_rows.

La exclusión garantiza un solo propietario autorizado y un solo resultado aceptado. Tras una partición de red, un proceso antiguo podría seguir leyendo Mercado Libre hasta su límite local; no puede escribir resultados después de perder el permiso. No se promete ejecución física exactamente una vez en máquinas distintas.

Las filas parciales legadas se conservan en la corrida original cerrada, y se crea una nueva corrida para reintentarlas. Los duplicados activos legados se cierran conservando su historial. La UI sondea tanto pending como running para mostrar reintentos y cierres sin recargar. PATCH sólo edita configuración. El endpoint legado desktop-results devuelve 410: los clientes deben migrar al protocolo claim/heartbeat/complete.

## Instalación

1. Detener los collectors anteriores y evitar solicitudes de actualización durante el cambio.
2. Respaldar la base y ejecutar `supabase/run-recovery.sql` después de `supabase/worker_schema.sql`. Este repo usa SQL de instalación, sin historial de migraciones Supabase CLI. El SQL es transaccional y repetible. No sustituirlo por cambios parciales.
3. Desplegar servidor de esta versión; no mezclar servidor viejo con nuevos RPCs ni volver al servidor viejo sin detener los workers.
4. Actualizar dependencias del collector con `npm ci` y arrancar `npm run collector`. Incluye supervisor y reinicio del proceso hijo después de una caída. Mantener el proceso supervisor con el servicio habitual del sistema operativo para reinicios de la máquina. `collector:once` procesa una sola corrida y no supervisa/reinicia.
5. Verificar una comparación de prueba y las consultas de abajo. No hace falta cambiar tokens de acceso existentes.

La recuperación se dispara por el sondeo del collector y requiere que al menos uno esté funcionando y pueda acceder al servidor/base. Si todos están apagados no se pueden capturar precios: los abandonos se recuperan cuando se reanuda el sondeo. Un fallo de base revierte claim/complete sin escrituras parciales. No hay fallback al protocolo inseguro si falta instalar los RPCs: el servidor devuelve error.

## Verificación

`npm test` aplica el esquema y el SQL real en PostgreSQL embebido (PGlite), sin credenciales ni llamadas a Mercado Libre. Cubre solicitudes repetidas, exclusión de claim, heartbeat, vencimiento, backoff, nuevo token, respuesta tardía, rollback por fallo inyectado, replay del cierre, agotamiento, límite absoluto, preservación de precios, permisos RPC y trabajos legados. PGlite serializa sus consultas: esto no sustituye una prueba de contención entre conexiones en staging.

`npm run typecheck` comprueba servidor y collector. CI ejecuta ambas verificaciones.

En staging: iniciar dos collectors con worker IDs distintos; encolar la misma comparación simultáneamente; confirmar un único ID activo. Cortar uno después del claim, esperar 2 minutos más backoff y observar attempt=2 con token distinto, sin pulsar actualizar. Reenviar complete con el token anterior: debe devolver 409 y no cambiar historial. Repetir un complete aceptado: debe devolver 200 sin nuevas filas. Una respuesta HTTP perdida de claim se recupera igual que una caída. Nunca simular vencimientos manuales en producción.

```sql
select id, comparison_id, status, attempt, worker_id, heartbeat_at,
       lease_expires_at, available_at, finished_at, error
from public.comparison_runs order by requested_at desc limit 50;

-- Debe devolver cero filas.
select comparison_id, count(*) from public.comparison_runs
where status in ('pending','running') group by comparison_id having count(*) > 1;

-- Alertar si persisten con un collector sano más allá del siguiente sondeo.
select id, comparison_id, attempt from public.comparison_runs
where status='running' and
(coalesce(lease_expires_at,started_at+interval '20 minutes',requested_at+interval '20 minutes') < now()
 or started_at < now()-interval '20 minutes');
```
