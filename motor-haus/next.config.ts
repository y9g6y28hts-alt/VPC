import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  // Base de demostración embebida y archivos WebAssembly de PGlite dentro de las funciones.
  outputFileTracingIncludes: {
    "/**": [
      "./demo-db/**/*",
      "./node_modules/@electric-sql/pglite/dist/*.{wasm,data}",
      "./node_modules/@electric-sql/pglite/dist/{pgcrypto,btree_gist}.tar.gz",
    ],
  },
  // Fotografías de unidades (hasta 8 MB + sobrecarga multipart).
  experimental: { serverActions: { bodySizeLimit: "9mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
