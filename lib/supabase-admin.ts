import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const adminKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

export function getSupabaseAdmin() {
  if (!url || !adminKey) {
    throw new Error(
      'Faltan SUPABASE_URL y una key de servidor (SUPABASE_SECRET_KEY o SUPABASE_SERVICE_ROLE_KEY) en las variables de entorno.',
    )
  }

  return createClient(url, adminKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
