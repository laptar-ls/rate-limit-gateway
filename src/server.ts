import { buildApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST ?? '127.0.0.1';

const app = buildApp({ logger: true });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
