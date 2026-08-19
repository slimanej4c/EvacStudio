"use client";

import Link from "next/link";
import { ArrowRight, FilePlus2, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";

const SHOW_REGISTER_ENTRY_POINTS = true;

export default function Home() {
  return (
    <div className="brand-page-bg flex min-h-screen flex-col text-brand-ink">
      <header className="sticky top-0 z-40 w-full border-b border-brand-orange/15 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
          <BrandLogo className="h-14 w-40 rounded-lg bg-white" priority />

          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-semibold text-stone-600 transition-colors hover:text-brand-red">
              Connexion
            </Link>
            {SHOW_REGISTER_ENTRY_POINTS && (
              <Link href="/register" className="brand-action inline-flex items-center justify-center rounded-lg px-4 py-2 text-xs font-semibold text-white transition-transform hover:-translate-y-0.5">
                Créer un compte
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-16">
        <section className="grid items-center gap-12 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-orange/25 bg-white/75 px-4 py-1.5 text-xs font-semibold text-brand-red shadow-sm">
              <ShieldCheck className="h-4 w-4" />
              <span>Prévention incendie · Intervention · Évacuation</span>
            </div>

            <h1 className="text-4xl font-extrabold leading-[1.08] tracking-tight text-brand-ink sm:text-6xl">
              Vos plans de sécurité,
              <span className="block bg-gradient-to-r from-brand-red via-brand-orange to-brand-gold bg-clip-text text-transparent">
                clairs et prêts à agir.
              </span>
            </h1>

            <p className="max-w-2xl text-lg leading-8 text-stone-600">
              Importez un plan en image ou PDF, ajoutez les pictogrammes réglementaires, composez votre mise en page, puis exportez un rendu professionnel en PNG ou PDF.
            </p>

            <div className="flex flex-col gap-4 pt-4 sm:flex-row">
              {SHOW_REGISTER_ENTRY_POINTS && (
                <Link href="/register" className="brand-action inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5">
                  Démarrer
                  <ArrowRight className="h-5 w-5" />
                </Link>
              )}
              <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-orange/25 bg-white px-6 py-3.5 text-sm font-semibold text-brand-red shadow-sm transition-all hover:border-brand-orange/50 hover:bg-brand-cream">
                Accéder à mes plans
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>
          </div>

          <div className="relative mx-auto flex aspect-square w-full max-w-sm items-center justify-center rounded-[2.5rem] border border-brand-orange/15 bg-white/75 p-12 shadow-[0_30px_80px_rgba(180,65,10,0.14)] backdrop-blur">
            <div className="absolute inset-7 rounded-[2rem] bg-gradient-to-br from-brand-gold/20 via-brand-orange/10 to-brand-red/15" />
            <BrandLogo compact className="relative h-full w-full drop-shadow-[0_18px_20px_rgba(180,45,10,0.18)]" priority />
          </div>
        </section>

        <section className="mt-14 grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-brand-orange/15 bg-white/85 p-6 shadow-sm">
            <div className="inline-flex rounded-xl bg-brand-cream p-3 text-brand-orange"><FilePlus2 className="h-6 w-6" /></div>
            <h2 className="mt-4 text-lg font-bold text-brand-ink">Import rapide</h2>
            <p className="mt-2 text-sm leading-6 text-stone-500">Image ou PDF en fond de plan, avec nettoyage assisté disponible directement dans l&apos;éditeur.</p>
          </div>
          <div className="rounded-2xl border border-brand-red/15 bg-white/85 p-6 shadow-sm">
            <div className="inline-flex rounded-xl bg-red-50 p-3 text-brand-red"><ShieldCheck className="h-6 w-6" /></div>
            <h2 className="mt-4 text-lg font-bold text-brand-ink">Éditeur interactif</h2>
            <p className="mt-2 text-sm leading-6 text-stone-500">Pictogrammes, textes, formes, templates, zoom, rotation et exports haute définition.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
