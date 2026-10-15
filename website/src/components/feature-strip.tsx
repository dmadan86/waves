import type { Dictionary } from '@/i18n/dictionaries';
import { BarChart, Groups, Lock, ScanFrame, Users } from './icons';

const tiles = [
  { Icon: ScanFrame, color: '#f59e0b' },
  { Icon: Users, color: '#3b82f6' },
  { Icon: BarChart, color: '#22a06b' },
  { Icon: Groups, color: '#8b5cf6' },
  { Icon: Lock, color: '#ec4899' },
];

export function FeatureStrip({ t }: { t: Dictionary['features'] }) {
  return (
    <section
      id="features"
      aria-label={t.label}
      className="relative z-10 -mt-2 scroll-mt-20 lg:-mt-14"
    >
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <ul className="grid grid-cols-2 gap-x-3 gap-y-6 rounded-[1.75rem] bg-surface p-5 shadow-[var(--w-shadow-card)] sm:grid-cols-3 lg:grid-cols-5 lg:p-6">
          {t.items.map((item, i) => {
            const { Icon, color } = tiles[i]!;
            return (
              <li
                key={item.title}
                className="flex flex-col items-center text-center max-sm:last:col-span-2"
              >
                <span
                  className="grid h-14 w-14 place-items-center rounded-2xl"
                  style={{
                    background: `color-mix(in srgb, ${color} 14%, var(--w-surface))`,
                    color,
                  }}
                >
                  <Icon className="h-6 w-6" />
                </span>
                <h3 className="mt-3 text-[0.95rem] font-semibold text-ink">{item.title}</h3>
                <p className="mt-1 max-w-[11rem] text-[0.8rem] leading-snug text-ink-3">
                  {item.body}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
