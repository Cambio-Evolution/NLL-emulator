import { migrate, pool } from './db';

migrate()
  .then(() => {
    console.log('Schema created.');
    return pool.end();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
