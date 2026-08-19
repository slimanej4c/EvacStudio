"use client";

import React from "react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/context/AuthContext";
import WorkspaceSharing from "@/components/WorkspaceSharing";

/**
 * Sharing lives on its own page rather than on top of the plan list: it is an
 * occasional administrative task, and the list should open straight onto the
 * plans.
 */
export default function WorkspaceSharingPage() {
  const { token } = useAuth();

  const authHeaders = (): Record<string, string> => {
    const authToken = token || (typeof window !== "undefined" ? localStorage.getItem("token") : null);
    return authToken ? { Authorization: `Bearer ${authToken}` } : {};
  };

  return (
    <AppShell>
      <PageHeader
        title="Partage & collaborateurs"
        description="Invitez une personne à travailler sur votre liste de plans, et gérez les accès accordés."
      />

      <section className="brand-page-bg min-h-[calc(100vh-97px)] p-8 text-brand-ink">
        <div className="max-w-3xl">
          <WorkspaceSharing authHeaders={authHeaders()} />
        </div>
      </section>
    </AppShell>
  );
}
