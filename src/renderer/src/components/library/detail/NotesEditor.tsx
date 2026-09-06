import { lazy, Suspense } from 'react';
import { LoadingNotice } from '../../ui/loading-notice';

export type NotesEditorProps = {
  // Read on mount. The editor owns its document until the modal closes;
  // refetches must never replace an in-progress draft.
  value: string;
  onChange: (markdown: string) => void;
  minHeightClass?: string;
};

const RichNotesEditor = lazy(() =>
  import('./RichNotesEditor').then((module) => ({ default: module.RichNotesEditor })),
);

// Every consumer uses this boundary: adding/editing a game and editing only
// its notes load the same editor chunk, only when their dialog content mounts.
// The shell and save state remain mounted while the editor is loading.
export const NotesEditor = (props: NotesEditorProps): React.JSX.Element => (
  <Suspense
    fallback={
      <LoadingNotice
        label="Loading notes editor…"
        className={`${props.minHeightClass ?? 'min-h-64'} rounded-[12px] border border-input`}
      />
    }
  >
    <RichNotesEditor {...props} />
  </Suspense>
);
