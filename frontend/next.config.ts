import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The default bottom-left spot covers the sidebar footer (model status, Paper link).
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
