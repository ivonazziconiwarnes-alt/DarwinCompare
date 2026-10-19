import { NextResponse } from 'next/server'

// Legacy writes have no run/attempt ownership and could overwrite recovered results.
export async function POST() {
  return NextResponse.json({ error: 'Usar collector con claim, leaseToken y complete.' }, { status: 410 })
}
