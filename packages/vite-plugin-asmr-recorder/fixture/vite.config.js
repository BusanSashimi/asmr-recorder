import buildSoundMonitor from "../src/index.js";

export default {
  plugins: [buildSoundMonitor()],
  server: {
    port: 5174,
    strictPort: true,
  },
};
