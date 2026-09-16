import type { NextConfig } from "next";

const isGitHubPagesBuild = process.env.GITHUB_PAGES_BUILD === "true";

const nextConfig: NextConfig = isGitHubPagesBuild
  ? {
      output: "export",
      basePath: "/machi-no-jakuten",
      trailingSlash: true,
      pageExtensions: ["tsx"],
      typescript: {
        tsconfigPath: "tsconfig.pages.json",
      },
    }
  : {};

export default nextConfig;
