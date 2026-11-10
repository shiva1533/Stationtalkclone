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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-white/10 p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Create a Junction</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="e.g. Midnight Coders"
            className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-400"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Category</label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(CATEGORY_META).map(([key, meta]) => (
              <button
                key={key}
                onClick={() => setCategory(key as JunctionCategory)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-all ${
                  category === key
                    ? 'bg-white text-slate-900 border-white'
                    : 'bg-white/5 text-white/70 border-white/10 hover:border-white/30'
                }`}
              >
                {meta.emoji} {meta.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-white/60 uppercase tracking-wide">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={120}
            rows={2}
            placeholder="What is this Junction about?"
            className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-400 resize-none"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          onClick={handleCreate}
          disabled={creating || name.trim().length < 2}
          className="w-full py-2.5 rounded-xl bg-indigo-500 text-white font-medium hover:bg-indigo-400 disabled:opacity-40 transition-colors"
        >
          {creating ? 'Creating…' : 'Create & Enter'}
        </button>
      </div>
    </div>
  );
}
