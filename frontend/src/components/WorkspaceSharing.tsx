"use client";

import React, { useCallback, useEffect, useState } from "react";
import { buildApiUrl } from "@/lib/api";
import { Check, Copy, Loader2, Trash2, UserPlus, Users } from "lucide-react";

interface Membership {
  id: number;
  member_username: string;
  member_email: string;
  role: "viewer" | "editor";
  created_at: string;
}

interface Invitation {
  id: number;
  email: string;
  role: "viewer" | "editor";
  status: "pending" | "accepted" | "revoked" | "expired";
  created_at: string;
  expires_at: string;
}

interface SharedWithMe {
  owner_username: string;
  role: "viewer" | "editor";
}

const ROLE_LABELS: Record<string, string> = {
  viewer: "Lecture seule",
  editor: "Édition",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  accepted: "Acceptée",
  revoked: "Révoquée",
  expired: "Expirée",
};

/**
 * Sharing a plan list: invite someone, see who has access, take it back.
 *
 * The invitation link is shown once, right after it is created — the server
 * stores only its hash and can never return it again. That is deliberate, and
 * the panel says so rather than letting the user hunt for it later.
 */
export default function WorkspaceSharing({
  authHeaders,
  onAccessChanged,
}: {
  authHeaders: Record<string, string>;
  onAccessChanged?: () => void;
}) {
  const [members, setMembers] = useState<Membership[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<SharedWithMe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [inviting, setInviting] = useState(false);
  const [freshToken, setFreshToken] = useState("");
  const [copied, setCopied] = useState(false);

  const [joinToken, setJoinToken] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinMessage, setJoinMessage] = useState("");

  const hasAuth = "Authorization" in authHeaders;

  const load = useCallback(async () => {
    // Nothing to load without a token; the panel renders nothing in that case,
    // so the loading flag it would set is never read.
    if (!hasAuth) return;
    // No setState before the first await: on mount this runs inside an effect,
    // and a synchronous set there just cascades an extra render. `loading`
    // already starts true, and errors are cleared by whoever triggers a reload.
    try {
      const res = await fetch(buildApiUrl("/api/workspace/collaborators/"), {
        headers: authHeaders,
        cache: "no-store",
      });
      if (!res.ok) {
        setError("Impossible de charger les accès partagés.");
        return;
      }
      const data = await res.json();
      setMembers(data.members || []);
      setInvitations(data.invitations || []);
      setSharedWithMe(data.shared_with_me || []);
    } catch {
      setError("Erreur de communication avec le serveur.");
    } finally {
      setLoading(false);
    }
    // authHeaders is rebuilt on every render of the parent, so it is left out
    // deliberately: including it would reload this panel in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAuth]);

  useEffect(() => {
    // Deferred by a microtask so the fetch — and every setState it leads to —
    // lands after this effect has returned, instead of cascading a render.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    setInviting(true);
    setError("");
    setFreshToken("");
    setCopied(false);
    try {
      const res = await fetch(buildApiUrl("/api/workspace/collaborators/"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.email?.[0] || data.error || "L'invitation n'a pas pu être créée.");
        return;
      }
      setFreshToken(data.token || "");
      setEmail("");
      await load();
    } catch {
      setError("Erreur de communication avec le serveur.");
    } finally {
      setInviting(false);
    }
  };

  const revoke = async (payload: { invitation_id?: number; membership_id?: number }) => {
    try {
      const res = await fetch(buildApiUrl("/api/workspace/revoke/"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError("La révocation a échoué.");
        return;
      }
      setError("");
      await load();
      onAccessChanged?.();
    } catch {
      setError("Erreur de communication avec le serveur.");
    }
  };

  const handleJoin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!joinToken.trim()) return;
    setJoining(true);
    setJoinMessage("");
    try {
      const res = await fetch(buildApiUrl("/api/workspace/accept/"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ token: joinToken.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setJoinMessage(data.error || "Cette invitation est invalide.");
        return;
      }
      setJoinMessage(
        `Vous avez rejoint la liste de ${data.owner_username} (${ROLE_LABELS[data.role] || data.role}).`
      );
      setJoinToken("");
      await load();
      onAccessChanged?.();
    } catch {
      setJoinMessage("Erreur de communication avec le serveur.");
    } finally {
      setJoining(false);
    }
  };

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(freshToken);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (!hasAuth) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-brand-orange" />
        <h2 className="text-base font-semibold text-slate-950">Partage de la liste de plans</h2>
      </div>

      {error ? (
        <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <form onSubmit={handleInvite} className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[200px]">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Adresse e-mail à inviter
          </span>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="collegue@exemple.fr"
            className="w-full rounded border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-brand-ink outline-none focus:border-brand-orange"
          />
        </label>
        <label>
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Droits
          </span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as "viewer" | "editor")}
            className="rounded border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-brand-ink outline-none focus:border-brand-orange"
          >
            <option value="viewer">Lecture seule</option>
            <option value="editor">Édition</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={inviting}
          className="brand-action flex cursor-pointer items-center gap-1.5 rounded px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
          Inviter
        </button>
      </form>

      {freshToken ? (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-semibold text-amber-900">
            Code d&apos;invitation — copiez-le maintenant, il ne sera plus jamais affiché.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-white px-2 py-1.5 font-mono text-[11px] text-amber-900 border border-amber-200">
              {freshToken}
            </code>
            <button
              type="button"
              onClick={copyToken}
              className="flex shrink-0 cursor-pointer items-center gap-1 rounded bg-amber-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-500"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copié" : "Copier"}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-amber-800">
            Transmettez-le par un canal sûr. Il est utilisable une seule fois et expire au bout de 7 jours.
          </p>
        </div>
      ) : null}

      {loading ? (
        <p className="text-xs text-slate-500">Chargement...</p>
      ) : (
        <div className="space-y-4">
          <div>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Personnes ayant accès
            </h3>
            {members.length === 0 ? (
              <p className="text-xs text-slate-500">Personne pour l&apos;instant.</p>
            ) : (
              <ul className="space-y-1">
                {members.map((member) => (
                  <li
                    key={member.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <span className="text-sm text-slate-800">
                      {member.member_username}
                      <span className="ml-2 text-[10px] text-slate-500">
                        {ROLE_LABELS[member.role]}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => revoke({ membership_id: member.id })}
                      className="cursor-pointer rounded p-1 text-slate-500 transition-colors hover:bg-red-500/20 hover:text-red-300"
                      title="Retirer l'accès"
                      aria-label={`Retirer l'accès de ${member.member_username}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {invitations.length > 0 ? (
            <div>
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Invitations
              </h3>
              <ul className="space-y-1">
                {invitations.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <span className="text-sm text-slate-700">
                      {invitation.email}
                      <span className="ml-2 text-[10px] text-slate-500">
                        {ROLE_LABELS[invitation.role]} · {STATUS_LABELS[invitation.status]}
                      </span>
                    </span>
                    {invitation.status === "pending" ? (
                      <button
                        type="button"
                        onClick={() => revoke({ invitation_id: invitation.id })}
                        className="cursor-pointer rounded px-2 py-0.5 text-xs font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-safety-red"
                      >
                        Révoquer
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="border-t border-slate-200 pt-4">
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Rejoindre une liste partagée
            </h3>
            <form onSubmit={handleJoin} className="flex flex-wrap items-center gap-2">
              <input
                value={joinToken}
                onChange={(event) => setJoinToken(event.target.value)}
                placeholder="Collez le code d'invitation reçu"
                className="min-w-[200px] flex-1 rounded border border-stone-300 bg-white px-2.5 py-1.5 font-mono text-xs text-brand-ink outline-none focus:border-brand-orange"
              />
              <button
                type="submit"
                disabled={joining}
                className="flex cursor-pointer items-center gap-1.5 rounded border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
              >
                {joining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Rejoindre
              </button>
            </form>
            {joinMessage ? (
              <p className="mt-1.5 text-sm text-slate-600">{joinMessage}</p>
            ) : null}
            {sharedWithMe.length > 0 ? (
              <p className="mt-2 text-sm text-slate-600">
                Vous avez accès aux plans de{" "}
                {sharedWithMe
                  .map((item) => `${item.owner_username} (${ROLE_LABELS[item.role]})`)
                  .join(", ")}
                .
              </p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
