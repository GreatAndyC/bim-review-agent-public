import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Real IFC uploads are multipart requests, but Vinext still applies its
  // default 1 MiB request budget at the Worker entry point. Keep that budget
  // above the shared 50 MiB per-file contract plus bounded multipart overhead.
  experimental: {
    serverActions: {
      bodySizeLimit: "51mb",
    },
  },
};

export default nextConfig;
