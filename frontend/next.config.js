/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['localhost', 'api.indas.app', 'exhibitionvisitingcard.indusanalytics.co.in'],
  },
  async rewrites() {
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5008';
    return [
      {
        source: '/api/:path*',
        destination: apiBaseUrl + '/api/:path*',
      },
    ];
  },
};

module.exports = nextConfig;

