import React from 'react';

const Shimmer = ({ className = '' }) => (
  <div className={`relative overflow-hidden bg-stone-100 rounded-2xl ${className}`}>
    <div 
      className="absolute inset-0"
      style={{
        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%)',
        animation: 'shimmer 1.5s infinite',
      }}
    />
  </div>
);

// Stat card skeleton for Dashboard
export function SkeletonStat() {
  return (
    <div className="bg-white border border-stone-100 p-6 rounded-[32px] flex items-center justify-between">
      <div className="space-y-3 flex-1">
        <Shimmer className="h-3 w-24 rounded-lg" />
        <Shimmer className="h-7 w-32 rounded-xl" />
        <Shimmer className="h-3 w-20 rounded-lg" />
      </div>
      <Shimmer className="w-14 h-14 rounded-2xl shrink-0" />
    </div>
  );
}

// Order card skeleton
export function SkeletonCard() {
  return (
    <div className="bg-white border border-stone-100 rounded-[32px] p-6 space-y-6">
      <div className="flex justify-between items-start">
        <div className="space-y-2">
          <Shimmer className="h-6 w-20 rounded-xl" />
          <Shimmer className="h-4 w-32 rounded-lg" />
          <Shimmer className="h-3 w-24 rounded-lg" />
        </div>
        <Shimmer className="h-7 w-24 rounded-xl" />
      </div>
      <div className="space-y-2">
        <Shimmer className="h-9 w-full rounded-xl" />
        <Shimmer className="h-9 w-full rounded-xl" />
      </div>
      <div className="pt-5 border-t border-stone-50 flex items-center justify-between">
        <div className="space-y-2">
          <Shimmer className="h-3 w-20 rounded-lg" />
          <Shimmer className="h-6 w-28 rounded-xl" />
        </div>
        <Shimmer className="h-8 w-28 rounded-xl" />
      </div>
    </div>
  );
}

// Chart skeleton for Dashboard
export function SkeletonChart() {
  return (
    <div className="bg-white border border-stone-100 p-8 rounded-[40px] space-y-8">
      <div className="flex items-center justify-between">
        <Shimmer className="h-5 w-40 rounded-xl" />
        <Shimmer className="h-6 w-32 rounded-full" />
      </div>
      <div className="h-[300px] flex items-end gap-3 px-4">
        {[40, 65, 45, 80, 55, 70, 50].map((h, i) => (
          <Shimmer key={i} className="flex-1 rounded-xl" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}

// Product card skeleton
export function SkeletonProduct() {
  return (
    <div className="bg-white border border-stone-100 rounded-[32px] overflow-hidden">
      <Shimmer className="aspect-square w-full rounded-none" />
      <div className="p-5 space-y-4">
        <div className="space-y-2">
          <Shimmer className="h-5 w-3/4 rounded-lg" />
          <Shimmer className="h-6 w-1/2 rounded-xl" />
        </div>
        <div className="pt-4 border-t border-stone-50">
          <Shimmer className="h-10 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

export default Shimmer;
