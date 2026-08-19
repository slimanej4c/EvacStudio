import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-brand-orange/15 bg-[linear-gradient(110deg,#fffdf9_0%,#fff5e8_70%,#ffe9d6_100%)] px-8 py-6 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="mb-2 h-1 w-12 rounded-full bg-gradient-to-r from-brand-red via-brand-orange to-brand-gold" />
        <h1 className="text-2xl font-bold tracking-tight text-brand-ink">{title}</h1>
        {description ? <p className="mt-1 text-sm text-stone-500">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}
