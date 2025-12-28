/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/Chad-Powers-Tron',
  trailingSlash: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
 
}

export default nextConfig
