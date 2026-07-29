export function ProfilePageSkeleton() {
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-paper overflow-y-auto animate-pulse">
      <ProfileHeaderSkeleton />
      <ProfileTabsSkeleton />
      <ProfileContentSkeleton />
    </div>
  );
}

export function ProfileHeaderSkeleton() {
  return (
    <div className="relative">
      <div className="h-[280px] bg-gradient-to-br from-bamboo-mist/70 via-paper-warm to-ink-faint/10" />
      <div className="relative px-8 -mt-20">
        <div className="flex items-end gap-6">
          <div className="w-24 h-24 rounded-full ring-4 ring-paper bg-paper-warm shadow-lg shrink-0" />
          <div className="flex-1 min-w-0 pb-2 space-y-2">
            <div className="h-6 w-40 rounded bg-paper-deep/25" />
            <div className="h-3 w-72 max-w-full rounded bg-paper-deep/20" />
            <div className="h-3 w-48 rounded bg-paper-deep/15" />
          </div>
          <div className="h-9 w-24 rounded-xl bg-paper-warm border border-paper-deep/20 pb-2 shrink-0" />
        </div>
      </div>
      <div className="flex items-center gap-8 px-8 mt-4 pb-4 border-b border-paper-deep/10">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="text-center space-y-1">
            <div className="h-5 w-10 rounded bg-paper-deep/25" />
            <div className="h-3 w-8 rounded bg-paper-deep/15" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileTabsSkeleton() {
  return (
    <div className="flex items-center gap-1 px-8 py-2 border-b border-paper-deep/10">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-9 w-20 rounded-lg bg-paper-warm/70" />
      ))}
    </div>
  );
}

function ProfileContentSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 p-4">
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <div
          key={item}
          className="rounded-xl border border-paper-deep/20 bg-paper px-4 py-4 space-y-3"
        >
          <div className="h-36 rounded-lg bg-paper-warm/80" />
          <div className="h-4 w-3/4 rounded bg-paper-deep/25" />
          <div className="h-3 w-full rounded bg-paper-deep/15" />
          <div className="h-3 w-2/3 rounded bg-paper-deep/15" />
        </div>
      ))}
    </div>
  );
}
