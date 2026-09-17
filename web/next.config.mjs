const config = {
  allowedDevOrigins: ["*.trycloudflare.com"],

  // This runs on a small machine beside the driver and the agents it spawns, and a
  // dev server that grows without bound starves them. None of this changes what is
  // served — only how much it keeps while serving it.
  onDemandEntries: { maxInactiveAge: 60_000, pagesBufferLength: 2 },

  experimental: {
    proxyTimeout: 600000,
    webpackMemoryOptimizations: true,
    preloadEntriesOnStart: false,
    serverComponentsHmrCache: false,
  },
};

export default config;
