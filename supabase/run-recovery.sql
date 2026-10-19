-- Apply after worker_schema.sql, before deploying server/collector. Short global lock serializes queue mutations.
begin;
alter table public.comparison_runs add column if not exists attempt integer not null default 0;
alter table public.comparison_runs add column if not exists lease_token uuid;
alter table public.comparison_runs add column if not exists lease_expires_at timestamptz;
alter table public.comparison_runs add column if not exists heartbeat_at timestamptz;
alter table public.comparison_runs add column if not exists available_at timestamptz not null default now();
-- Old completion could leave partial rows on a running job. Keep those rows for audit
-- and retry in a fresh run, rather than appending/replacing its historical data.
with retired as (
 update public.comparison_runs r set status='error',finished_at=now(),
 error='Resultado parcial legado conservado; recuperacion en nueva corrida.'
 where status in ('pending','running') and exists(select 1 from public.comparison_run_rows h where h.run_id=r.id)
 returning r.*
)
insert into public.comparison_runs(comparison_id,requested_by,trigger_source,comparison_snapshot)
select comparison_id,requested_by,trigger_source,comparison_snapshot from retired;
with ranked as (select id,row_number() over(partition by comparison_id order by requested_at desc,id desc) n from public.comparison_runs where status in ('pending','running'))
update public.comparison_runs r set status='error',finished_at=now(),error='Duplicado activo cerrado durante migracion.' from ranked d where r.id=d.id and d.n>1;
create unique index if not exists comparison_runs_one_active on public.comparison_runs(comparison_id) where status in ('pending','running');
create index if not exists comparison_runs_lease on public.comparison_runs(lease_expires_at) where status='running';

create or replace function public.recover_comparison_runs() returns integer
language plpgsql security invoker set search_path=public as $$
declare r public.comparison_runs; n integer:=0;
begin
 perform pg_advisory_xact_lock(793214601);
 for r in select * from public.comparison_runs where status='running' and
 (coalesce(lease_expires_at,started_at+interval '20 minutes',requested_at+interval '20 minutes')<=now() or started_at<=now()-interval '20 minutes') for update loop
 update public.comparison_runs set status=case when attempt>=3 then 'error' else 'pending' end,
 available_at=now()+interval '30 seconds'*greatest(attempt,1),lease_token=null,lease_expires_at=null,worker_id=null,
 finished_at=case when attempt>=3 then now() else null end,
 error=case when attempt>=3 then 'Se agotaron 3 intentos por abandono.' else 'Intento abandonado; reintento automatico.' end where id=r.id;
 update public.comparisons set sync_status=case when r.attempt>=3 then 'error' else 'pending' end,
 sync_error=case when r.attempt>=3 then 'Se agotaron 3 intentos por abandono.' else null end,updated_at=now() where id=r.comparison_id;
 n:=n+1;
 end loop;
 return n;
end $$;

create or replace function public.enqueue_comparison_run(p_id uuid,p_by text,p_source text,p_snapshot jsonb)
returns public.comparison_runs language plpgsql security invoker set search_path=public as $$
declare r public.comparison_runs;
begin
 perform pg_advisory_xact_lock(793214601);
 perform 1 from public.comparisons where id=p_id for update;
 if not found then raise exception 'Comparacion inexistente'; end if;
 select * into r from public.comparison_runs where comparison_id=p_id and status in ('pending','running');
 if not found then
 insert into public.comparison_runs(comparison_id,requested_by,trigger_source,comparison_snapshot) values(p_id,p_by,p_source,p_snapshot) returning * into r;
 end if;
 update public.comparisons set sync_status=r.status,sync_error=null,updated_at=now() where id=p_id;
 return r;
end $$;

create or replace function public.claim_comparison_run(p_worker text) returns public.comparison_runs
language plpgsql security invoker set search_path=public as $$
declare r public.comparison_runs;
begin
 perform pg_advisory_xact_lock(793214601);
 perform public.recover_comparison_runs();
 select * into r from public.comparison_runs where status='pending' and available_at<=now() order by requested_at,id limit 1 for update;
 if not found then return null; end if;
 update public.comparison_runs set status='running',attempt=attempt+1,lease_token=gen_random_uuid(),
 lease_expires_at=now()+interval '2 minutes',heartbeat_at=now(),started_at=now(),finished_at=null,worker_id=p_worker,error=null where id=r.id returning * into r;
 update public.comparisons set sync_status='running',sync_error=null,updated_at=now() where id=r.comparison_id;
 return r;
end $$;

create or replace function public.heartbeat_comparison_run(p_id uuid,p_token uuid,p_worker text) returns boolean
language plpgsql security invoker set search_path=public as $$
begin
 perform pg_advisory_xact_lock(793214601);
 update public.comparison_runs set heartbeat_at=now(),lease_expires_at=now()+interval '2 minutes'
 where id=p_id and status='running' and lease_token=p_token and worker_id=p_worker and lease_expires_at>now() and started_at>now()-interval '20 minutes';
 return found;
end $$;

create or replace function public.complete_comparison_run(p_id uuid,p_token uuid,p_worker text,p_status text,p_error text,p_result jsonb)
returns boolean language plpgsql security invoker set search_path=public as $$
declare r public.comparison_runs; c public.comparisons; rows_json jsonb; history_json jsonb; price_rows jsonb;
begin
 perform pg_advisory_xact_lock(793214601);
 select * into r from public.comparison_runs where id=p_id for update;
 if not found or r.lease_token is distinct from p_token or r.worker_id is distinct from p_worker then return false; end if;
 -- Lost acknowledgements may be replayed without rewriting accepted results.
 if r.status in ('ok','error') and r.finished_at is not null then return true; end if;
 if r.status<>'running' or r.lease_expires_at<=now() or r.started_at<=now()-interval '20 minutes' then return false; end if;
 if p_status is null or p_status not in ('ok','error') then raise exception 'Estado invalido'; end if;
 rows_json:=coalesce(p_result->'rows','[]'::jsonb);
 if jsonb_typeof(rows_json)<>'array' then raise exception 'Filas invalidas'; end if;
 if p_status='ok' and jsonb_array_length(rows_json)=0 then raise exception 'Resultado vacio'; end if;
 select * into strict c from public.comparisons where id=r.comparison_id for update;
 -- No delete. All rows, run state, snapshot and history commit or roll back together.
 insert into public.comparison_run_rows(run_id,position,role,name,url,item_id,title,price,currency,image_url,source,source_kind,error,diff,pct)
 select p_id,ordinality-1,v->>'role',coalesce(v->>'name',''),coalesce(v->>'url',''),v->>'itemId',v->>'title',
 (v->>'price')::numeric,v->>'currency',v->>'imageUrl',coalesce(v->>'source','worker'),v->>'sourceKind',v->>'error',
 (v->>'diff')::numeric,(v->>'pct')::numeric from jsonb_array_elements(rows_json) with ordinality e(v,ordinality);
 history_json:=coalesce(c.last_result->'history','[]'::jsonb);
 if jsonb_array_length(history_json)=0 and jsonb_array_length(coalesce(c.last_result->'rows','[]'::jsonb))>0 then
 history_json:=jsonb_build_array(jsonb_build_object('runId',null,'capturedAt',coalesce(c.last_synced_at,now()),'rows',c.last_result->'rows'));
 end if;
 select coalesce(jsonb_agg(v),'[]'::jsonb) into price_rows from jsonb_array_elements(rows_json) v where jsonb_typeof(v->'price')='number';
 if jsonb_array_length(price_rows)>0 then history_json:=history_json||jsonb_build_array(jsonb_build_object('runId',p_id,'capturedAt',r.started_at,'rows',price_rows)); end if;
 select coalesce(jsonb_agg(v order by n),'[]'::jsonb) into history_json from (select v,n from jsonb_array_elements(history_json) with ordinality e(v,n) order by n desc limit 24) h;
 update public.comparison_runs set status=p_status,finished_at=now(),lease_expires_at=null,error=p_error,result_summary=p_result->'summary' where id=p_id;
 update public.comparisons set sync_status=p_status,sync_error=p_error,updated_at=now(),
 last_result=case when jsonb_array_length(price_rows)>0 then jsonb_set(p_result,'{history}',history_json) else last_result end,
 last_synced_at=case when jsonb_array_length(price_rows)>0 then now() else last_synced_at end where id=r.comparison_id;
 return true;
end $$;
revoke all on function public.recover_comparison_runs(),public.enqueue_comparison_run(uuid,text,text,jsonb),public.claim_comparison_run(text),public.heartbeat_comparison_run(uuid,uuid,text),public.complete_comparison_run(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.recover_comparison_runs(),public.enqueue_comparison_run(uuid,text,text,jsonb),public.claim_comparison_run(text),public.heartbeat_comparison_run(uuid,uuid,text),public.complete_comparison_run(uuid,uuid,text,text,text,jsonb) to service_role;
commit;
