import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'ojnerbyocqmihdrggvzp.supabase.co',
        port: '',
        pathname: '/**',
      }
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb', // Reverted to a more standard limit
    },
  },
  // This is deprecated in Next.js 15 and functions is the new way
  // Keeping both for compatibility with different Vercel build versions
  functions: {
      maxDuration: 120,
  }
};

export default nextConfig;

    