import cors from 'cors';
import express from 'express';
import { migrate } from './db';
import { nllHeaders, requireBearer, tokenRouter } from './middleware/auth';
import { fhirRouter } from './routes/fhir';
import { seed } from './seed';
import { startDailyGrowth } from './scheduler';

const PORT = Number(process.env.PORT || 8080);

async function main(): Promise<void> {
  await migrate();
  if (process.env.SEED_ON_START === 'true') {
    await seed();
  }
  startDailyGrowth();

  const app = express();
  app.use(cors());
  app.use(express.json({ type: ['application/json', 'application/fhir+json'] }));
  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Mock OAuth2
  app.use('/auth', tokenRouter);

  // FHIR endpoint: metadata and $ping are open (like a real CapabilityStatement);
  // everything else requires a bearer token.
  app.use(
    '/fhir',
    (req, res, next) => {
      if (req.path === '/metadata' || req.path === '/$ping') return next();
      requireBearer(req, res, next);
    },
    nllHeaders,
    fhirRouter
  );

  // FHIR JSON content type on all /fhir responses
  app.use('/fhir', (_req, res, next) => {
    res.type('application/fhir+json');
    next();
  });

  app.listen(PORT, () => {
    console.log(`NLL mock server listening on http://localhost:${PORT}`);
    console.log(`  FHIR base:  http://localhost:${PORT}/fhir`);
    console.log(`  Token:      POST http://localhost:${PORT}/auth/token`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
