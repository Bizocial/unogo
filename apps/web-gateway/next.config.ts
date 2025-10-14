import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    '@unogo/shared',
    '@unogo/events',
    '@unogo/channels',
    '@unogo/channels-whatsapp',
    '@unogo/llm',
    '@unogo/llm-openai',
    '@unogo/prompts',
    '@unogo/topics',
  ],
};

export default nextConfig;
