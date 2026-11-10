import { useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/SessionContext';
import { CATEGORY_META } from '@/lib/constants';
import type { JunctionCategory } from '@/types';

interface CreateJunctionModalProps {
  onClose: () => void;
  onCreated: (slug: string) => void;
}

export function CreateJunctionModal({ onClose, onCreated }: CreateJunctionModalProps) {
  const { session } = useSession();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<JunctionCategory>('random');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim() || !session) return;
    setCreating(true);
    setError('');
    const slug =
      name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') +
      '-' +
      Math.random().toString(36).slice(2, 6);
    const { data, error: insertError } = await supabase
      .from('junctions')
      .insert({
        name: name.trim(),
        slug,
        category,
        description: description.trim() || 'A new Junction for meeting people.',
        image_url: '',
        is_permanent: false,
        creator_session_id: session.sessionId,
      })
      .select('slug')
      .single();
    setCreating(false);
    if (insertError) {
      setError('Could not create Junction. Try a different name.');
      return;
    }
    onCreated(data.slug);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/35 animate-in fade-in duration-200">
      <section role="dialog" aria-modal="true" aria-labelledby="create-room-title" className="dialog space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="create-room-title" className="text-base font-semibold">Create a room</h2>
          <button onClick={onClose} aria-label="Close create room" className="button button-secondary !px-2">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="room-name" className="block text-xs font-medium text-muted">Name</label>
          <input
            id="room-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="e.g. Midnight Coders"
            className="field w-full"
          />
        </div>

        <div className="space-y-1.5">
          <p id="room-category" className="text-xs font-medium text-muted">Category</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="room-category">
            {Object.entries(CATEGORY_META).map(([key, { label }]) => (
              <button
                key={key}
                onClick={() => setCategory(key as JunctionCategory)}
                aria-pressed={category === key}
                className={`min-h-9 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                  category === key
                    ? 'border-accent-line bg-accent-soft text-accent'
                    : 'border-line bg-surface text-muted hover:border-outline hover:bg-subtle'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="room-description" className="block text-xs font-medium text-muted">Description</label>
          <textarea
            id="room-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={120}
            rows={2}
            placeholder="What is this Junction about?"
            className="field block w-full resize-y"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          onClick={handleCreate}
          disabled={creating || name.trim().length < 2}
          className="button button-primary w-full"
        >
          {creating ? 'Creating…' : 'Create and enter'}
        </button>
      </section>
    </div>
  );
}
