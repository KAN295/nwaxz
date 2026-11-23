import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.mjs";
import { attachCoopSockets } from "./coop-socket.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilePath=process.env.NWAXZ_PROFILE_DB??(process.env.NODE_ENV==='production'?undefined:path.join(root,'.local','guest-social-v1.sqlite'));
if(!profilePath||process.env.NODE_ENV==='production'&&profilePath===':memory:')throw new Error('NWAXZ_PROFILE_DB must point to persistent nwaxz storage in production');
const app = createApp({
  distDir: path.join(root, "dist"),
  revision: process.env.APP_REVISION,
  profilePath,
});
const server = app.listen(
  Number(process.env.PORT ?? 3000),
  process.env.HOST ?? "127.0.0.1",
  () => console.log("nwaxz server ready"),
);
let stopping = false;
const closeSockets = attachCoopSockets(server,app.locals.coop,undefined,app.locals.social);
function stop() {
  if (stopping) return;
  stopping = true;
  closeSockets();
  app.locals.coop?.shutdown();
  app.locals.social?.close();
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 10000);
  deadline.unref();
  server.close(() => {
    clearTimeout(deadline);
    process.exit(0);
  });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
