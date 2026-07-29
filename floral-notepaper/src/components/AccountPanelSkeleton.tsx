export function AccountPanelSkeleton() {
  return (
    <ScrollFrame center>
      <div className="max-w-[360px] w-full pt-4">
        <div className="mb-4 px-4 py-3.5 rounded-xl bg-paper/30 border border-paper-deep/25 max-w-[600px] animate-pulse">
          <div className="h-4 w-20 rounded bg-paper-deep/25 mb-4" />
          <div className="space-y-3">
            <div>
              <div className="h-2.5 w-10 rounded bg-paper-deep/20 mb-1.5" />
              <div className="h-9 w-full rounded-lg bg-paper-warm/80 border border-paper-deep/25" />
            </div>
            <div>
              <div className="h-2.5 w-10 rounded bg-paper-deep/20 mb-1.5" />
              <div className="h-9 w-full rounded-lg bg-paper-warm/80 border border-paper-deep/25" />
            </div>
            <div className="h-10 w-full rounded-xl bg-bamboo/20 mt-1" />
          </div>
          <div className="h-3 w-36 rounded bg-paper-deep/20 mx-auto mt-4" />
        </div>
      </div>
    </ScrollFrame>
  );
}

function ScrollFrame({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className={`px-6 py-5 ${center ? "flex flex-col items-center" : ""}`}>
        {children}
        <div className="h-8" />
      </div>
    </div>
  );
}
