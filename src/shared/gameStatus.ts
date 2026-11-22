export type StatusKey =
  'playing' | 'beaten' | 'dropped' | 'on_hold' | 'resting' | 'unplayed' | 'plan';

type StatusIconName = 'Play' | 'Trophy' | 'XCircle' | 'Pause' | 'Moon' | 'Circle' | 'Bookmark';

export type StatusMeta<Icon> = {
  label: string;
  color: string;
  Icon: Icon;
  filled: boolean;
};

// Fósforo status LEDs: the same values as --color-st-* in
// src/shared/theme/fosforo.css. They stay as hex here because callers append
// alpha suffixes (`${color}1f`). The design has five LED tones, so On Hold
// shares Resting's and Unplayed and Plan to play share Backlog's.
// Icon names keep this module free of React and of either app's dependencies.
const STATUS_DEFINITIONS = {
  playing: { label: 'Playing', color: '#ffb347', icon: 'Play', filled: true },
  beaten: { label: 'Beaten', color: '#9bd67a', icon: 'Trophy', filled: false },
  dropped: { label: 'Dropped', color: '#8a9496', icon: 'XCircle', filled: false },
  on_hold: { label: 'On Hold', color: '#b9a6ff', icon: 'Pause', filled: false },
  resting: { label: 'Resting', color: '#b9a6ff', icon: 'Moon', filled: false },
  unplayed: { label: 'Unplayed', color: '#5fd3e0', icon: 'Circle', filled: false },
  plan: { label: 'Plan to play', color: '#5fd3e0', icon: 'Bookmark', filled: false },
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
