interface AvatarProps {
  emoji: string;
  color: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  speaking?: boolean;
  ring?: boolean;
}

const SIZES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-7 h-7 text-sm',
  sm: 'w-9 h-9 text-base',
  md: 'w-11 h-11 text-xl',
  lg: 'w-14 h-14 text-2xl',
  xl: 'w-20 h-20 text-4xl',
};

export function Avatar({ emoji, color, size = 'md', speaking, ring }: AvatarProps) {
  return (
    <div
      className={`${SIZES[size]} rounded-full flex items-center justify-center shrink-0 relative transition-all duration-200`}
      style={{
        backgroundColor: `${color}22`,
        border: `2px solid ${color}`,
        boxShadow: speaking ? `0 0 0 3px ${color}, 0 0 16px ${color}99` : ring ? `0 0 0 2px ${color}55` : 'none',
      }}
    >
      <span className="leading-none">{emoji}</span>
      {speaking && (
        <span
          className="absolute inset-0 rounded-full animate-ping opacity-30"
          style={{ border: `2px solid ${color}` }}
        />
      )}
    </div>
  );
}
