'use client';

import { Segmented } from './primitives';
import { useTheme, type ThemePreference } from '@/lib/client/theme';

export function ThemePicker() {
  const { preference, setPreference } = useTheme();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-medium">Theme</p>
        <p className="text-[13px] text-muted">Remembered on this device.</p>
      </div>
      <Segmented<ThemePreference>
        value={preference}
        onChange={setPreference}
        ariaLabel="Theme"
        options={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
          { value: 'system', label: 'System' },
        ]}
      />
    </div>
  );
}
