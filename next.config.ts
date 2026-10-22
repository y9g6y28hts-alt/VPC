import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // postgres.js, PGlite y @react-pdf/renderer se ejecutan sólo en el servidor (Node).
  serverExternalPackages: ["postgres", "@react-pdf/renderer", "@electric-sql/pglite", "@electric-sql/pglite-socket"],
  // Demo autónoma: binarios de PGlite que se cargan en tiempo de ejecución.
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/@electric-sql/pglite/dist/pglite.{wasm,data}",
      "./node_modules/@electric-sql/pglite/dist/initdb.wasm",
      "./node_modules/@electric-sql/pglite/dist/{pgcrypto,btree_gist}.tar.gz",
    ],
  },
  poweredByHeader: false,
  typedRoutes: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
