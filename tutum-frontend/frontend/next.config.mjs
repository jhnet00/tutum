/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  // 환경 변수를 서버 사이드에서 사용 가능하게 설정
  env: {
    API_BASE_URL: process.env.API_BASE_URL || "http://localhost:8000",
  },
};

export default nextConfig;
