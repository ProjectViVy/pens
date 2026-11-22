import analyzer from '@next/bundle-analyzer';

const isProd = process.env.NODE_ENV === 'production';

const withBundleAnalyzer = analyzer({
  enabled: process.env.ANALYZE === 'true',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: isProd,
  pageExtensions: ['tsx', 'ts'],
  experimental: {
    optimizePackageImports: [
      '@lobehub/ui',
      '@lobehub/icons',
      'chroma-js',
      'shiki',
      '@icons-pack/react-simple-icons',
      'gpt-tokenizer',
    ],
  },
  reactStrictMode: true,
  /*
   * 逃生阀：这台机器上 next build 的 type-check 步骤要 fork jest-worker，
   * 沙箱里会以 spawn EPERM 直接失败（和代码无关）。
   * 类型检查用 `npx tsc --noEmit` 单独跑，跑完再带这个环境变量出构建。
   * 不设环境变量时行为和原来完全一样：构建里照样类型检查 + lint。
   */
  eslint: { ignoreDuringBuilds: process.env.DIVA_SKIP_LINT === '1' },
  typescript: { ignoreBuildErrors: process.env.DIVA_SKIP_TYPECHECK === '1' },
  /*
   * 构建产物目录可以用环境变量改写。
   * 用途只有一个：dev 服务器正在跑（占着 .next）的时候，还要另外出一个生产包做性能实测。
   * 不设环境变量时就是默认的 .next。
   */
  distDir: process.env.DIVA_DIST_DIR || '.next',
  webpack(config) {
    config.experiments = {
      asyncWebAssembly: true,
      layers: true,
    };

    // to fix shikiji compile error
    // refs: https://github.com/antfu/shikiji/issues/23
    config.module.rules.push(
      {
        test: /\.m?js$/,
        type: 'javascript/auto',
        resolve: {
          fullySpecified: false,
        },
      },
      {
        test: /\.(glsl|vs|fs|vert|frag)$/,
        type: 'asset/source',
      },
    );

    config.resolve.alias = {
      ...config.resolve.alias,
      'sharp$': false,
      'onnxruntime-node$': false,
    };

    return config;
  },
};

export default isProd ? withBundleAnalyzer(nextConfig) : nextConfig;
