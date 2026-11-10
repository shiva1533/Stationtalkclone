import { lazy, Suspense } from 'react';
import { supabaseConfig } from './lib/supabaseConfig';

const App = lazy(() => import('./App'));

export default function Startup() {
  if (supabaseConfig) {
    return (
      <Suspense fallback={<p role="status" className="p-6 text-muted">Opening Junction…</p>}>
        <App />
      </Suspense>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Junction</h1>
      <section className="mt-4 space-y-2 rounded-lg border border-line bg-surface p-4" aria-labelledby="setup-title">
        <h2 id="setup-title" className="text-base font-semibold">Junction needs a database connection</h2>
        <p className="text-muted">Connect Supabase to browse rooms, chat, and use voice.</p>
        {import.meta.env.DEV && (
          <p className="break-words text-muted">
            Copy <code>.env.example</code> to <code>.env.local</code> in the project folder.
            Set <code>VITE_SUPABASE_URL</code> to your project URL and <code>VITE_SUPABASE_ANON_KEY</code> to its
            publishable or anon key. Then restart the dev server.
          </p>
        )}
      </section>
    </main>
  );
}
