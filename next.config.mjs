/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Signed-copy uploads (plan 019 A5) arrive through a server action as a
  // phone photo or scan; the default 1 MB action body would reject them.
  experimental: { serverActions: { bodySizeLimit: "25mb" } },

  // pdfjs-dist ships its Worker as a separate .mjs file that our parser
  // loads at runtime via GlobalWorkerOptions.workerSrc. Vercel's serverless
  // bundler doesn't statically detect that dynamic path, so the file gets
  // omitted from the deployed Lambda. Explicitly trace-include both the
  // library entry AND the worker so the fake-worker bootstrap can find
  // pdf.worker.mjs at runtime.
  outputFileTracingIncludes: {
    "app/api/valuation-rolls/**": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },
};

export default nextConfig;
