import type { NextConfig } from "next";

// Sent with every response, pages and API alike. There is deliberately no content policy for
// scripts and styles here: Next.js inlines both, and a policy that allowed that would add little.
const securityHeaders = [
  // Browsers honour this over HTTPS only, so it does nothing on http://localhost.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // The dashboards hold patient names and one-click actions; no other site may frame them.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Each agent runs its own dev server with its own port and dist dir: see docs/CONTRACTS.md.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The contracts package ships TypeScript source.
  transpilePackages: ["@triagecam/contracts"],
  // The phone reaches this server through an ngrok tunnel during testing.
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app", "*.ngrok.dev", "*.ngrok.io"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
