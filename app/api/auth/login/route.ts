import { NextResponse } from 'next/server'
import { authCookieName, buildSessionToken, validateCredentials } from '@/lib/auth'

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { username?: string; password?: string }

    const username = body.username?.trim() || ''
    const password = body.password?.trim() || ''

    if (!validateCredentials(username, password)) {
      return NextResponse.json({ error: 'Usuario o contraseña incorrectos.' }, { status: 401 })
    }

    const response = NextResponse.json({
      ok: true,
      authenticated: true,
      username,
    })

    response.cookies.set({
      name: authCookieName(),
      value: buildSessionToken(username),
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })

    return response
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo iniciar sesión.' },
      { status: 500 },
    )
  }
}
