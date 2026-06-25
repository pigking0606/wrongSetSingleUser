import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sql.js", "sharp"],
  turbopack: {
    root: process.cwd(),
  },
};
module.exports = {
allowedDevOrigins: ['43.134.234.119','066112.xyz'],
}
export default nextConfig;
