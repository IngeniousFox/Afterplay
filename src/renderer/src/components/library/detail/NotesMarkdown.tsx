import { lazy, Suspense } from 'react';
import { LoadingNotice } from '../../ui/loading-notice';

const Markdown = lazy(() => import('react-markdown'));

// Desktop and TV share the same parser and loading boundary. Notes typography
// stays with each caller so the TV view keeps its existing em-based scale.
export const NotesMarkdown = ({ children }: { children: string }): React.JSX.Element => (
  <Suspense fallback={<LoadingNotice label="Loading notes…" className="min-h-8" />}>
    <Markdown>{children}</Markdown>
  </Suspense>
);
