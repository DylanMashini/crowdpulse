import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
