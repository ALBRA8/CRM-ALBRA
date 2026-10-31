import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Chequeo de tipos ACTIVO en build (cierre H-02): src/ compila con 0 errores
  // de tsc; ya no se silencian fallos de tipos en producción.
  reactStrictMode: false,
  // Oculta el indicador "N" de Next.js DevTools (flotante abajo-izquierda)
  devIndicators: false,
  // El gateway del preview redirige /dashboard -> /dashboard/ (301). Desactivamos
  // el redirect automático de Next y servimos /dashboard/ vía rewrite: se rompe
  // el bucle 301/308 del dashboard SIN redirigir las rutas /api (los webhooks de
  // Telegram/Meta no siguen redirects).
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [{ source: '/dashboard/', destination: '/dashboard' }];
  },
};

export default nextConfig;
