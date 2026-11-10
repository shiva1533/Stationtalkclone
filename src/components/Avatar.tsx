interface AvatarProps {
  emoji: string;
  color: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  speaking?: boolean;
  ring?: boolean;
}

const SIZES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'size-6 text-xs',
  sm: 'size-8 text-sm',
  md: 'size-10 text-lg',
  lg: 'w-14 h-14 text-2xl',
  xl: 'w-20 h-20 text-4xl',
};

export function Avatar({ emoji, color, size = 'md', speaking, ring }: AvatarProps) {
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full border transition-shadow ${SIZES[size]}`}
      style={{
        backgroundColor: `${color}22`,
        borderColor: `${color}55`,
        boxShadow: speaking ? '0 0 0 2px #285d52' : ring ? `0 0 0 1px ${color}` : 'none',
      }}
    >
      <span className="leading-none">{emoji}</span>
    </div>
  );
}
