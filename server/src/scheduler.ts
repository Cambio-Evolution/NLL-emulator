/**
 * Daily patient growth scheduler.
 *
 * Keeps the database growing by +DAILY_GROWTH patients per calendar day,
 * counting from GROWTH_START_DATE.  On every server start it recalculates the
 * expected total (so a restarted or previously-idle server catches up
 * automatically) and then re-checks every 24 hours while running.
 *
 * Override via env vars:
 *   DAILY_GROWTH        patients to add per day  (default: 50)
 *   GROWTH_START_DATE   ISO date of day-0        (default: 2026-08-11)
 *   BASE_PATIENT_COUNT  seed floor               (default: 1005)
 */
import { seedBulk } from './seed-bulk';

const DAILY_GROWTH = Number(process.env.DAILY_GROWTH ?? 50);
const BASE_COUNT = Number(process.env.BASE_PATIENT_COUNT ?? 1005);
const START_DATE = new Date(process.env.GROWTH_START_DATE ?? '2026-08-11');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function expectedTotal(): number {
  const daysSinceStart = Math.max(
    0,
    Math.floor((Date.now() - START_DATE.getTime()) / MS_PER_DAY),
  );
  return BASE_COUNT + DAILY_GROWTH * daysSinceStart;
}

async function runGrowth(): Promise<void> {
  const target = expectedTotal();
  await seedBulk(target);
}

export function startDailyGrowth(): void {
  // Run once immediately at startup (catches up if server was down)
  runGrowth().catch((err) =>
    console.error('Daily growth (startup):', err),
  );

  // Then repeat every 24 hours
  setInterval(() => {
    runGrowth().catch((err) =>
      console.error('Daily growth (scheduled):', err),
    );
  }, MS_PER_DAY);

  console.log(
    `Daily growth active: +${DAILY_GROWTH} patients/day from ${START_DATE.toISOString().slice(0, 10)}`,
  );
}
