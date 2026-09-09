import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const withMDX = createMDX();

const config: NextConfig = {
  agentRules: false,
  turbopack: {
    rules: {
      "*.wgsl": {
        as: "*.js",
        loaders: ["@vgpu/wgsl/loader-webpack"],
      },
    },
  },
};

export default withMDX(config);
