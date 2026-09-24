import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Oculta el indicador "N" de Next.js DevTools (flotante abajo-izquierda)
  devIndicators: false,
};

export default nextConfig;
