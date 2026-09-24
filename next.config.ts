import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  devIndicators: false,

  // Treat these packages as external (not bundled) so they can resolve their
  // data files at runtime (e.g. pdfkit's font metrics in /js/data/*.afm).
  serverExternalPackages: ["pdfkit", "exceljs"],

  env: {
    LLM_API_KEY: process.env.LLM_API_KEY ?? '',
    LLM_BASE_URL: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
    LLM_MODEL: process.env.LLM_MODEL ?? 'gpt-4o-mini',
  },

  async rewrites() {
    return [
      {
        source: '/api/whatsapp/daemon/:path*',
        destination: 'http://localhost:3002/:path*',
      },
    ]
  },
};

export default nextConfig;
