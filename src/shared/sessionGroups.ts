import { DAY_MS, monthKey, startOfDayMs } from './dateMath';
import { asDate, type DateValue } from './dateTypes';

// Only whole, closed months carry a scope for the desktop diary recap.
// Week buckets win even when their sessions fall in the previous month.
export type SessionBucket = { label: string; monthScopeKey: string | null };
export type SessionGroup<T> = SessionBucket & { sessions: T[] };

const createBucketReader = (now: Date): ((value: DateValue) => SessionBucket) => {
  const today = startOfDayMs(now);
  const currentMonth = monthKey(now);
  const currentYear = now.getFullYear();
  const months = new Map<number, SessionBucket>();

  return (value) => {
    const date = asDate(value);
    const diffDays = Math.round((today - startOfDayMs(date)) / DAY_MS);

    if (diffDays <= 0) return { label: 'Today', monthScopeKey: null };
    if (diffDays === 1) return { label: 'Yesterday', monthScopeKey: null };
    if (diffDays <= 7) return { label: 'This Week', monthScopeKey: null };
    if (diffDays <= 14) return { label: 'Last Week', monthScopeKey: null };

    const month = monthKey(date);
    if (month === currentMonth) return { label: 'This Month', monthScopeKey: null };

    const cached = months.get(month);
    if (cached) return cached;

    const bucket: SessionBucket = {
      label:
        month === currentMonth - 1
          ? 'Last Month'
          : date.toLocaleDateString('en-US', {
              month: 'long',
              ...(date.getFullYear() === currentYear ? {} : { year: 'numeric' }),
            }),
      monthScopeKey: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
    };
    months.set(month, bucket);
    return bucket;
  };
};

export const getSessionGroup = (date: DateValue, now: Date): SessionBucket =>
  createBucketReader(now)(date);

// Group only consecutive rows of this page: a page always starts with its
// own heading, even when the previous page ended in the same bucket.
export const groupPageByDate = <T extends { startedAt: DateValue }>(
  sessions: readonly T[],
  now: Date,
): SessionGroup<T>[] => {
  // The reference date and localized month labels are computed once per
  // page, instead of rebuilding them for every session in a long history.
  const bucketFor = createBucketReader(now);
  const groups: SessionGroup<T>[] = [];
  for (const session of sessions) {
    const bucket = bucketFor(session.startedAt);
    const last = groups[groups.length - 1];
    if (last && last.label === bucket.label) last.sessions.push(session);
    else groups.push({ ...bucket, sessions: [session] });
  }
  return groups;
};
