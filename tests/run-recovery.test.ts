import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

test('queue recovery and atomic price history on real embedded PostgreSQL', async () => {
  const db = new PGlite()
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;')
    await db.exec(readFileSync('supabase/worker_schema.sql', 'utf8').replace('create extension if not exists pgcrypto;', ''))
    await db.exec(readFileSync('supabase/run-recovery.sql', 'utf8'))
    const query = async (sql: string, params: any[] = []) => (await db.query<any>(sql, params)).rows
    const scalar = async (sql: string, params: any[] = []) => Object.values((await query(sql, params))[0])[0]
    const comparison = (await query('insert into comparisons(name) values ($1) returning id', ['test']))[0].id
    const enqueue = () => query('select * from enqueue_comparison_run($1,null,$2,$3)', [comparison, 'test', { id: comparison }])
    const jobs = await Promise.all(Array.from({ length: 8 }, enqueue))
    const id = jobs[0][0].id
    assert(jobs.every(rows => rows[0].id === id), 'concurrent enqueue must share a job')
    await assert.rejects(query('insert into comparison_runs(comparison_id) values ($1)', [comparison]), /duplicate key/)
    const claim = async () => (await query('select * from claim_comparison_run($1)', ['worker']))[0]
    let run = await claim()
    assert.equal(run.attempt, 1)
    assert.equal((await claim()).id, null, 'second collector cannot claim active run')
    const oldToken = run.lease_token
    const beat = (token: string) => scalar('select heartbeat_comparison_run($1,$2,$3)', [id, token, 'worker'])
    assert.equal(await beat(oldToken), true)
    assert.equal(await scalar('select heartbeat_comparison_run($1,$2,$3)', [id, oldToken, 'other']), false)
    assert.equal(await scalar('select recover_comparison_runs()'), 0, 'live heartbeat prevents recovery')
    const expire = () => query("update comparison_runs set lease_expires_at=now()-interval '1 second' where id=$1", [id])
    const ready = () => query("update comparison_runs set available_at=now()-interval '1 second' where id=$1", [id])
    await expire()
    assert.equal(await beat(oldToken), false, 'expired owner cannot resurrect lease')
    await claim() // Every poll recovers automatically, even without another web request.
    assert.equal(await scalar('select status from comparison_runs where id=$1', [id]), 'pending')
    assert.equal((await claim()).id, null, 'backoff is respected')
    await ready()
    run = await claim()
    assert.equal(run.attempt, 2)
    assert.notEqual(run.lease_token, oldToken)
    const result = { rows: [{ role: 'mine', name: 'mine', url: '', price: 100, source: 'worker' }], summary: { total: 1, ok: 1, failed: 0, minePrice: 100 } }
    const complete = (token: string, payload: any = result, status = 'ok') => scalar('select complete_comparison_run($1,$2,$3,$4,null,$5)', [id, token, 'worker', status, payload])
    assert.equal(await complete(oldToken), false, 'late result fenced out')
    // A failure after inserting rows must roll back EVERYTHING.
    await db.exec("create function test_fail() returns trigger language plpgsql as $$begin raise exception 'injected failure'; end$$; create trigger test_fail before update on comparisons for each row execute function test_fail();")
    await assert.rejects(complete(run.lease_token), /injected failure/)
    assert.equal(await scalar('select count(*)::int from comparison_run_rows'), 0)
    assert.equal(await scalar('select status from comparison_runs where id=$1', [id]), 'running')
    await db.exec('drop trigger test_fail on comparisons; drop function test_fail();')
    assert.equal(await complete(run.lease_token), true)
    assert.equal(await complete(run.lease_token, { ...result, rows: [] }, 'error'), true, 'duplicate acknowledgement cannot rewrite success')
    assert.equal(await scalar('select count(*)::int from comparison_run_rows'), 1)
    const saved = await scalar('select last_result from comparisons where id=$1', [comparison]) as any
    assert.equal(saved.history.length, 1)
    assert.equal(saved.rows[0].price, 100)
    assert.equal(await scalar("select has_function_privilege('anon','complete_comparison_run(uuid,uuid,text,text,text,jsonb)','execute')"), false)
    // Exhaustion never changes stored prices; hard timeout wins even with fresh heartbeats.
    await enqueue()
    const next = await claim()
    await query("update comparison_runs set attempt=3,started_at=now()-interval '21 minutes' where id=$1", [next.id])
    assert.equal(await scalar('select recover_comparison_runs()'), 1)
    assert.equal(await scalar('select status from comparison_runs where id=$1', [next.id]), 'error')
    assert.deepEqual(await scalar('select last_result from comparisons where id=$1', [comparison]), saved)
    await enqueue()
    const failed = await claim()
    assert.equal(await scalar('select complete_comparison_run($1,$2,$3,$4,$5,$6)', [failed.id, failed.lease_token, 'worker', 'error', 'network', { rows: [], summary: {} }]), true)
    assert.deepEqual(await scalar('select last_result from comparisons where id=$1', [comparison]), saved)
    // Legacy running jobs without a token are also recovered.
    await enqueue()
    await query("update comparison_runs set status='running',started_at=now()-interval '21 minutes',lease_token=null,lease_expires_at=null where status='pending'")
    assert.equal(await scalar('select recover_comparison_runs()'), 1)
    await db.exec(readFileSync('supabase/run-recovery.sql', 'utf8')) // rerunnable installation
  } finally { await db.close() }
})

test('migration preserves partial legacy prices and retires duplicate active jobs', async () => {
  const db = new PGlite()
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;')
    await db.exec(readFileSync('supabase/worker_schema.sql', 'utf8').replace('create extension if not exists pgcrypto;', ''))
    const comparison = (await db.query<any>("insert into comparisons(name,last_result) values('legacy','{\"rows\":[{\"price\":50}]}') returning id")).rows[0].id
    const partial = (await db.query<any>("insert into comparison_runs(comparison_id,status) values($1,'running') returning id", [comparison])).rows[0].id
    await db.query("insert into comparison_run_rows(run_id,role,name,price) values($1,'mine','legacy',50)", [partial])
    await db.query("insert into comparison_runs(comparison_id,status) values($1,'pending')", [comparison])
    await db.exec(readFileSync('supabase/run-recovery.sql', 'utf8'))
    const rows = (await db.query<any>('select * from comparison_runs where comparison_id=$1', [comparison])).rows
    assert.equal(rows.filter(r => ['pending', 'running'].includes(r.status)).length, 1)
    assert.equal(rows.find(r => r.id === partial).status, 'error')
    assert.equal((await db.query<any>('select price from comparison_run_rows where run_id=$1', [partial])).rows[0].price, '50')
    assert.equal((await db.query<any>('select last_result from comparisons where id=$1', [comparison])).rows[0].last_result.rows[0].price, 50)
  } finally { await db.close() }
})
