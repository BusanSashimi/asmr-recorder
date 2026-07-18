# vite-plugin-asmr-recorder

Reports successful Vite development HMR updates and full reloads to a running
ASMR Recorder desktop app. Production builds are intentionally ignored.

```sh
npm install -D vite-plugin-asmr-recorder
```

```ts
import { defineConfig } from "vite";
import buildSoundMonitor from "vite-plugin-asmr-recorder";

export default defineConfig({
  plugins: [buildSoundMonitor()],
  server: {
    port: 5174,
    strictPort: true,
  },
});
```

ASMR Recorder discovers the project through an authenticated, user-private file
in its platform app-data directory. The plugin rereads that file on each send,
so it reconnects automatically when the app restarts. `discoveryFile` may be
overridden for local development and tests.

## Manual fixture

With ASMR Recorder open, run `npm install && npm run dev` in `fixture/`. The
fixture reserves port 5174 with `strictPort: true`; edit `src/main.js` or
`src/style.css` while recording to exercise the end-to-end bridge.
