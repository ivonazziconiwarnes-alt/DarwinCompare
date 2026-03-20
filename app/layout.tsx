import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Comparador ML Pro',
  description: 'Comparador web de publicaciones de Mercado Libre',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
