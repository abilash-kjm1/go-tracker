'use client';

import { PlannerForm, PlannerResults, useTripPlanner } from './TripPlanner';
import type { TransitStop } from '@/lib/transit/types';

/** The standalone planner page. The home screen embeds the same planner. */
export function PlanScreen({ stops }: { stops: TransitStop[] }) {
  const planner = useTripPlanner(stops);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-safe">
      <header className="pr-dangle pt-6 pb-4">
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Plan a trip</h1>
        <p className="mt-1 text-small text-muted">
          Direct GO services, or up to three changes when there is no through service.
        </p>
      </header>

      {/* The planner stands on the page, exactly as it does on the home
          screen. It used to sit on a hard-coded teal-to-cyan gradient left
          behind by an older palette: two blues and a jade that belong to no
          token in the app, under fields the warm-neutral theme had moved on
          from. The same form on two screens should not be two colours. */}
      <PlannerForm planner={planner} stops={stops} />

      <div className="pb-10">
        <PlannerResults planner={planner} />
      </div>
    </div>
  );
}
