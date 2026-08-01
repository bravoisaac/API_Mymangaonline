import { app } from './app';
import { env } from './config/env';

const server = app.listen(env.port, () => {
  console.log(`API_Mymangaonline running on port ${env.port}`);
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 30_000;

function shutdown(signal: NodeJS.Signals) {
  console.log(`${signal} received; shutting down HTTP server`);
  server.close((error) => {
    if (error) {
      console.error('HTTP server shutdown failed', error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
