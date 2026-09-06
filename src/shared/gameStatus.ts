export type StatusKey =
  'playing' | 'beaten' | 'dropped' | 'on_hold' | 'resting' | 'unplayed' | 'plan';

type StatusIconName = 'Play' | 'Trophy' | 'XCircle' | 'Pause' | 'Moon' | 'Circle' | 'Bookmark';

export type StatusMeta<Icon> = {
  label: string;
  color: string;
  Icon: Icon;
  filled: boolean;
};

// SPEC 10.2: fixed status colors, independent from the semantic UI accents.
// Icon names keep this module free of React and of either app's dependencies.
const STATUS_DEFINITIONS = {
  playing: { label: 'Playing', color: '#2fdc7e', icon: 'Play', filled: true },
  beaten: { label: 'Beaten', color: '#e3b24a', icon: 'Trophy', filled: false },
  dropped: { label: 'Dropped', color: '#e85d72', icon: 'XCircle', filled: false },
  on_hold: { label: 'On Hold', color: '#8b93a3', icon: 'Pause', filled: false },
  resting: { label: 'Resting', color: '#7c86c8', icon: 'Moon', filled: false },
  unplayed: { label: 'Unplayed', color: '#888f8a', icon: 'Circle', filled: false },
  plan: { label: 'Plan to play', color: '#85a3d6', icon: 'Bookmark', filled: false },
} satisfies Record<
  StatusKey,
  { label: string; color: string; icon: StatusIconName; filled: boolean }
>;

export const STATE_TO_STATUS_KEY = {
  started: 'playing',
  completed: 'beaten',
  dropped: 'dropped',
  on_hold: 'on_hold',
  resting: 'resting',
  plan_to_play: 'plan',
} satisfies Record<string, StatusKey>;

export const createStatusMeta = <Icon>(
  icons: Record<StatusIconName, Icon>,
): Record<StatusKey, StatusMeta<Icon>> =>
  Object.fromEntries(
    Object.entries(STATUS_DEFINITIONS).map(([key, { icon, ...meta }]) => [
      key,
      { ...meta, Icon: icons[icon] },
    ]),
  ) as Record<StatusKey, StatusMeta<Icon>>;
