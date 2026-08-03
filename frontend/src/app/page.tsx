"use client";

import Link from "next/link";
import { ArrowRight, FilePlus2, ShieldCheck } from "lucide-react";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-950">
      <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-safety-green font-bold text-white shadow-md">
              P
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-950">Plan intervention et évacuation</span>
          </div>

          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-semibold text-slate-600 transition-colors hover:text-safety-green">
              Connexion
            </Link>
            <Link href="/register" className="inline-flex items-center justify-center rounded-lg bg-safety-green px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-safety-green/10 transition-all hover:bg-green-600">
              Créer un compte
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-16">
        <section className="max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-4 py-1.5 text-xs font-semibold text-safety-green">
            <ShieldCheck className="h-4 w-4" />
            <span>Création de plans d&apos;intervention et d&apos;évacuation</span>
          </div>

          <h1 className="text-4xl font-extrabold leading-tight tracking-normal text-slate-950 sm:text-6xl">
            Créez, annotez et exportez vos plans d&apos;intervention et d&apos;évacuation.
          </h1>

          <p className="max-w-2xl text-lg leading-8 text-slate-500">
            Importez un plan en image ou PDF, ajoutez les pictogrammes réglementaires, ajustez leur position, puis exportez le rendu final en PNG ou PDF.
          </p>

          <div className="flex flex-col gap-4 pt-4 sm:flex-row">
            <Link href="/register" className="inline-flex items-center justify-center gap-2 rounded-lg bg-safety-green px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-safety-green/20 transition-all hover:bg-green-600">
              Démarrer
              <ArrowRight className="h-5 w-5" />
            </Link>
            <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-lg border border-green-200 bg-green-50 px-6 py-3.5 text-sm font-semibold text-safety-green transition-all hover:bg-green-100">
              Accéder à mes plans
            </Link>
          </div>
        </section>

        <section className="mt-14 grid gap-5 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <FilePlus2 className="h-6 w-6 text-safety-green" />
            <h2 className="mt-4 text-lg font-bold text-slate-950">Import rapide</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">Image ou PDF en fond de plan, avec nettoyage OpenCV disponible côté backend.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <ShieldCheck className="h-6 w-6 text-safety-green" />
            <h2 className="mt-4 text-lg font-bold text-slate-950">Éditeur interactif</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">Canvas React Konva, pictogrammes, zoom, rotation et exports haute définition.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
