import type { UserStats } from "../types";

interface ProfileStatsProps {
  stats: UserStats;
}

export function ProfileStats({ stats }: ProfileStatsProps) {
  return (
    <div className="flex items-center gap-8 px-8 py-4 border-b border-paper-deep/10">
      <StatItem value={stats.articleCount} label="文章" />
      <StatItem value={stats.followerCount} label="粉丝" />
      <StatItem value={stats.followingCount} label="关注" />
      <StatItem value={stats.likeCount} label="获赞" />
      <StatItem value={stats.viewCount} label="浏览" />
    </div>
  );
}

function StatItem({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-[18px] font-semibold text-ink-soft">{value}</div>
      <div className="text-[11px] text-ink-ghost/60">{label}</div>
    </div>
  );
}
