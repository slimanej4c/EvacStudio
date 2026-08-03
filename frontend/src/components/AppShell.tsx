"use client";

import type { ReactNode } from "react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppSidebar } from "@/components/AppSidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <div className="flex h-screen overflow-hidden bg-white text-slate-950">
        <AppSidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </ProtectedRoute>
  );
}
