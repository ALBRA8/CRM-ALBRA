import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Chequeo de tipos ACTIVO en build (cierre H-02): src/ compila con 0 errores
  // de tsc; ya no se silencian fallos de tipos en producción.
  reactStrictMode: false,
  // Oculta el indicador "N" de Next.js DevTools (flotante abajo-izquierda)
  devIndicators: false,
};

export default nextConfig;
