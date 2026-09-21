'use client';

import { PlannerForm, PlannerResults, useTripPlanner } from './TripPlanner';
import type { TransitStop } from '@/lib/transit/types';

/** The standalone planner page. The home screen embeds the same planner. */
export function PlanScreen({ stops }: { stops: TransitStop[] }) {
  const planner = useTripPlanner(stops);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe">
      <header className="pt-6 pb-4">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Plan a trip</h1>
        <p className="mt-1 text-[13px] text-muted">
          Direct GO services, or one change when there is no through service.
        </p>
      </header>

      <div
        className="rounded-[28px] p-4 shadow-[var(--shadow-card)]"
        style={{
          background:
            'radial-gradient(120% 90% at 100% 0%, #38bdf8 0%, transparent 55%), linear-gradient(140deg, #047857 0%, #0f766e 48%, #0c4a6e 100%)',
        }}
      >
        <PlannerForm planner={planner} stops={stops} />
      </div>

      <div className="pb-10">
        <PlannerResults planner={planner} />
      </div>
    </div>
  );
}
