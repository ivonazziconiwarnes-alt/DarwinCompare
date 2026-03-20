import { NextResponse } from 'next/server'
import { isAuthenticatedRequest } from '@/lib/auth'

export async function GET(request: Request) {
  return NextResponse.json({
    authenticated: isAuthenticatedRequest(request),
  })
}
