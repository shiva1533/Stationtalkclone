import { Building2, Gamepad2, GraduationCap, LayoutGrid, Music2, SlidersHorizontal } from 'lucide-react';
import { CATEGORY_META } from '@/lib/constants';
import type { JunctionCategory } from '@/types';

export type RoomCategoryFilter = 'all' | JunctionCategory;

const categories = [
  { key: 'all', label: 'All Rooms', icon: LayoutGrid },
  { key: 'city', label: 'City', icon: Building2 },
  { key: 'music', label: 'Music', icon: Music2 },
  { key: 'gaming', label: 'Gaming', icon: Gamepad2 },
  { key: 'study', label: 'Study', icon: GraduationCap },
] as const;

interface RoomFiltersProps {
  category: RoomCategoryFilter;
  onCategory: (category: RoomCategoryFilter) => void;
}

export function CategoryNavigation({ category, onCategory }: RoomFiltersProps) {
  return (
    <div className="category-scroll" role="group" aria-label="Room categories">
      {categories.map(({ key, label, icon: Icon }) => (
        <button key={key} onClick={() => onCategory(key)} aria-pressed={category === key} className={`category-chip ${category === key ? 'is-active' : ''}`}>
          <Icon size={17} strokeWidth={1.8} aria-hidden="true" />{label}
        </button>
      ))}
    </div>
  );
}

interface RoomFilterMenuProps extends RoomFiltersProps {
  onlineOnly: boolean;
  onOnlineOnly: (value: boolean) => void;
}

export function RoomFilterMenu({ category, onCategory, onlineOnly, onOnlineOnly }: RoomFilterMenuProps) {
  return (
    <details className="room-filter-menu" onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.open = false; }}>
      <summary className={`button button-secondary filter-button ${onlineOnly || category !== 'all' ? 'text-accent' : ''}`}>
        <SlidersHorizontal size={18} /><span>Filters</span>{(onlineOnly || category !== 'all') && <span className="filter-dot" />}
      </summary>
      <div className="filter-panel">
        <p className="text-sm font-semibold">Filter rooms</p>
        <label className="mt-4 flex cursor-pointer items-center justify-between gap-4 text-sm text-muted">
          Online rooms only
          <input type="checkbox" checked={onlineOnly} onChange={(event) => onOnlineOnly(event.target.checked)} className="size-4 accent-accent" />
        </label>
        <label htmlFor="category-filter" className="mb-1.5 mt-4 block text-xs font-medium text-muted">Category</label>
        <select id="category-filter" className="field w-full" value={category} onChange={(event) => onCategory(event.target.value as RoomCategoryFilter)}>
          <option value="all">All Rooms</option>
          {Object.entries(CATEGORY_META).map(([key, { label }]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
    </details>
  );
}
