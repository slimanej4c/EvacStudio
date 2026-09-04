"use client";

import React, { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  Compass,
  Eye,
  EyeOff,
  FileUp,
  ImagePlus,
  Lock,
  Map,
  MapPin,
  RefreshCw,
  SquareParking,
  Route,
  ShieldAlert,
  Trash2,
  Type,
  Waypoints,
  X,
} from "lucide-react";
import type { PlanDocumentType } from "@/lib/planCompliance";
import {
  evaluatePlanSituationAudit,
  planSituationFrame,
  type PlanSituationRole,
  type PlanSituationState,
} from "@/lib/planSituation";
import type { IconType, SafetyIconDefinition } from "@/utils/safetyIcons";

interface PlanSituationModalProps {
  open: boolean;
  state: PlanSituationState;
  documentType: PlanDocumentType;
  iconDefinitions: Record<string, SafetyIconDefinition>;
  backgroundPresent: boolean;
  uploading: boolean;
  canEdit: boolean;
  onClose: () => void;
  onCreate: () => void;
  onStateChange: (state: PlanSituationState) => void;
  onToggleTitle: () => void;
  onUpload: (file: File) => void;
  onUseMainPlan: () => void;
  onRemoveBackground: () => void;
  onTraceOutline: () => void;
  onRefreshVisibleArea: () => void;
  onTraceZone: () => void;
  onFitChange: (changes: Partial<Pick<PlanSituationState, "content_width_percent" | "content_height_percent" | "zone_opacity_percent">>) => void;
  onAddElement: (role: "represented_zone" | "road" | "parking" | "building" | "other_building" | "text" | "arrow") => void;
  onAddPictogram: (type: IconType, role?: PlanSituationRole) => void;
  onSetOrientation: (angle: number) => void;
  onOrientFromObserver: () => void;
  onDelete: () => void;
}

const normalize = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

export default function PlanSituationModal({
  open,
  state,
  documentType,
  iconDefinitions,
  backgroundPresent,
  uploading,
  canEdit,
  onClose,
  onCreate,
  onStateChange,
  onToggleTitle,
  onUpload,
  onUseMainPlan,
  onRemoveBackground,
  onTraceOutline,
  onRefreshVisibleArea,
  onTraceZone,
  onFitChange,
  onAddElement,
  onAddPictogram,
  onSetOrientation,
  onOrientFromObserver,
  onDelete,
}: PlanSituationModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIconType, setSelectedIconType] = useState("");
  const definitions = useMemo(
    () => Object.values(iconDefinitions).sort((left, right) => left.label.localeCompare(right.label, "fr")),
    [iconDefinitions],
  );
  const audit = useMemo(
    () => evaluatePlanSituationAudit(state, documentType),
    [state, documentType],
  );
  const frame = planSituationFrame(state);
  const titleVisible = Boolean(frame?.title);
  const outlinePresent = state.blocks.some((block) => block.situationRole === "building_outline");
  const tracedZonePresent = state.blocks.some(
    (block) => block.situationRole === "represented_zone" && (block.situationSourcePoints?.length ?? 0) >= 3,
  );

  const findIcon = (terms: string[]) => definitions.find((definition) => {
    const haystack = normalize(`${definition.type} ${definition.label}`);
    return terms.some((term) => haystack.includes(normalize(term)));
  });
  const addKnownIcon = (terms: string[], role: PlanSituationRole) => {
    const definition = findIcon(terms);
    if (!definition) {
      alert("Ce pictogramme n’est pas disponible dans la bibliothèque active.");
      return;
    }
    onAddPictogram(definition.type, role);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#242426] text-neutral-100 shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300">
              <Map className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold">Plan de situation</h2>
              <p className="text-[11px] text-neutral-400">Calque propre à ce plan, intégré à la feuille exportée.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-neutral-400 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!state.enabled ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
            <Map className="h-12 w-12 text-sky-300" />
            <div>
              <p className="text-sm font-semibold">Aucun plan de situation sur cette feuille</p>
              <p className="mt-2 max-w-lg text-xs leading-relaxed text-neutral-400">
                Ajoutez une zone indépendante pour représenter le site, les accès, le secteur couvert et les équipements déportés.
              </p>
            </div>
            <button type="button" disabled={!canEdit} onClick={onCreate} className="rounded-xl bg-sky-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-45">
              + Ajouter le plan de situation
            </button>
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-neutral-300">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={state.sectorial}
                onChange={() => onStateChange({ ...state, sectorial: !state.sectorial })}
                className="accent-sky-500"
              />
              Le plan principal représente un secteur
            </label>
            <div className="w-full max-w-lg space-y-2">
              {audit.map((item, index) => (
                <div key={`${item.severity}-${index}`} className={`flex gap-2 rounded-lg border p-2.5 text-left text-[10px] leading-relaxed ${item.severity === "error" ? "border-red-500/30 bg-red-500/10 text-red-100" : "border-sky-500/25 bg-sky-500/10 text-sky-100"}`}>
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{item.message}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <fieldset disabled={!canEdit} className="min-h-0 flex-1 overflow-y-auto p-5 disabled:opacity-60">
            {!canEdit && (
              <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-100">
                Consultation seule : les droits de modification de cet espace de travail sont inchangés.
              </p>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-xl border border-white/10 bg-black/20 p-4">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">Calque</h3>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onStateChange({ ...state, visible: !state.visible })}
                    className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-semibold ${state.visible ? "border-sky-400/40 bg-sky-500/15 text-sky-200" : "border-white/10 text-neutral-400"}`}
                  >
                    {state.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    {state.visible ? "Visible" : "Masqué"}
                  </button>
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-200">
                    <Lock className="h-4 w-4" />
                    Intérieur protégé
                  </div>
                </div>
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px] text-neutral-300">
                  <input type="checkbox" checked={titleVisible} onChange={onToggleTitle} className="accent-sky-500" />
                  Afficher le titre « Plan de situation »
                </label>
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-neutral-300">
                  <input
                    type="checkbox"
                    checked={state.sectorial}
                    onChange={() => onStateChange({ ...state, sectorial: !state.sectorial })}
                    className="accent-sky-500"
                  />
                  Le plan principal représente un secteur
                </label>
              </section>

              <section className="rounded-xl border border-white/10 bg-black/20 p-4">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">Fond</h3>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onUpload(file);
                    event.target.value = "";
                  }}
                />
                <div className="mt-3 grid gap-2">
                  <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-emerald-500 disabled:opacity-50">
                    <FileUp className="h-4 w-4" />
                    {uploading ? "Import en cours…" : "Importer PNG, JPG ou SVG"}
                  </button>
                  <button type="button" disabled={uploading} onClick={onUseMainPlan} className="flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold text-neutral-300 hover:bg-white/10">
                    <ImagePlus className="h-4 w-4" />
                    Réutiliser le fond du plan principal
                  </button>
                  {backgroundPresent && (
                    <button type="button" onClick={onRemoveBackground} className="text-[10px] font-semibold text-red-300 hover:text-red-200">
                      Retirer le fond de situation
                    </button>
                  )}
                </div>
              </section>
            </div>

            <section className="mt-4 rounded-xl border border-sky-400/30 bg-sky-500/10 p-4">
              <div className="flex items-start gap-3">
                <Waypoints className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-200">
                    Créer depuis le plan principal
                  </h3>
                  <p className="mt-1 text-[10px] leading-relaxed text-sky-100/70">
                    Tracez uniquement le contour extérieur. Le bouton d’actualisation calcule ensuite la partie réellement visible dans la fenêtre du plan principal et la remplit en gris. Le résultat reste figé jusqu’à la prochaine actualisation.
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={onTraceOutline} className="flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-sky-500">
                      <Waypoints className="h-4 w-4" />
                      {outlinePresent ? "Retracer la silhouette" : "Tracer la silhouette"}
                    </button>
                    <button type="button" disabled={!outlinePresent} onClick={onRefreshVisibleArea} className="flex items-center justify-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-[11px] font-bold text-emerald-100 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-35">
                      <RefreshCw className="h-4 w-4" />
                      Actualiser le champ visible
                    </button>
                    <button type="button" disabled={!outlinePresent} onClick={onTraceZone} className="sm:col-span-2 flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[10px] font-semibold text-neutral-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      {tracedZonePresent ? "Corriger la zone manuellement" : "Tracer la zone manuellement (optionnel)"}
                    </button>
                  </div>

                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-neutral-200">
                    <input
                      type="checkbox"
                      disabled={!outlinePresent}
                      checked={state.auto_refresh_visible_area}
                      onChange={() => onStateChange({ ...state, auto_refresh_visible_area: !state.auto_refresh_visible_area })}
                      className="accent-sky-500"
                    />
                    <span>Actualiser automatiquement le champ visible (déplacement / zoom)</span>
                  </label>

                  <p className="mt-1.5 text-[10px] leading-relaxed text-emerald-100/70">
                    {state.auto_refresh_visible_area
                      ? "La zone représentée s’ajuste automatiquement et en direct dès que le plan principal est déplacé ou zoomé."
                      : "Déplacez ou zoomez d’abord le plan principal, puis cliquez sur « Actualiser ». Aucun recalcul n’est effectué en temps réel."}
                  </p>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <label className="text-[10px] font-semibold text-neutral-300">
                      <span className="flex justify-between"><span>Largeur max.</span><span className="tabular-nums text-sky-300">{Math.round(state.content_width_percent)} %</span></span>
                      <input type="range" min={20} max={100} step={1} value={state.content_width_percent} onChange={(event) => onFitChange({ content_width_percent: Number(event.target.value) })} className="mt-2 h-1 w-full cursor-pointer accent-sky-500" />
                    </label>
                    <label className="text-[10px] font-semibold text-neutral-300">
                      <span className="flex justify-between"><span>Hauteur max.</span><span className="tabular-nums text-sky-300">{Math.round(state.content_height_percent)} %</span></span>
                      <input type="range" min={20} max={100} step={1} value={state.content_height_percent} onChange={(event) => onFitChange({ content_height_percent: Number(event.target.value) })} className="mt-2 h-1 w-full cursor-pointer accent-sky-500" />
                    </label>
                    <label className="text-[10px] font-semibold text-neutral-300">
                      <span className="flex justify-between"><span>Opacité zone</span><span className="tabular-nums text-sky-300">{Math.round(state.zone_opacity_percent)} %</span></span>
                      <input type="range" min={5} max={100} step={1} value={state.zone_opacity_percent} onChange={(event) => onFitChange({ zone_opacity_percent: Number(event.target.value) })} className="mt-2 h-1 w-full cursor-pointer accent-sky-500" />
                    </label>
                  </div>
                  <p className="mt-3 text-[10px] leading-relaxed text-neutral-400">
                    Exemple : 50 % × 30 % limite l’encombrement maximal. Les proportions du bâtiment restent toujours conservées.
                  </p>
                </div>
              </div>
            </section>

            <section className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">Éléments</h3>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                <button type="button" onClick={() => addKnownIcon(["point de rassemblement"], "assembly_point")} className="situation-tool"><MapPin className="h-4 w-4" />Point de rassemblement</button>
                <button type="button" onClick={() => addKnownIcon(["vous etes ici"], "observer")} className="situation-tool"><Compass className="h-4 w-4" />Vous êtes ici</button>
                <button type="button" onClick={() => onAddElement("represented_zone")} className="situation-tool"><ShieldAlert className="h-4 w-4" />Zone représentée</button>
                <button type="button" onClick={() => onAddElement("road")} className="situation-tool"><Route className="h-4 w-4" />Route</button>
                <button type="button" onClick={() => onAddElement("parking")} className="situation-tool"><SquareParking className="h-4 w-4" />Parking</button>
                <button type="button" onClick={() => onAddElement("building")} className="situation-tool"><Building2 className="h-4 w-4" />Bâtiment concerné</button>
                <button type="button" onClick={() => onAddElement("other_building")} className="situation-tool"><Building2 className="h-4 w-4" />Autre bâtiment</button>
                <button type="button" onClick={() => onAddElement("text")} className="situation-tool"><Type className="h-4 w-4" />Texte</button>
                <button type="button" onClick={() => onAddElement("arrow")} className="situation-tool"><span className="text-lg">➜</span>Flèche</button>
                {documentType === "intervention" && (
                  <>
                    <button type="button" onClick={() => addKnownIcon(["poteau d'incendie", "poteau incendie"], "remote_equipment")} className="situation-tool">Poteau incendie</button>
                    <button type="button" onClick={() => addKnownIcon(["coupure gaz"], "remote_equipment")} className="situation-tool">Coupure gaz</button>
                    <button type="button" onClick={() => addKnownIcon(["coupure electricite"], "remote_equipment")} className="situation-tool">Coupure électrique</button>
                    <button type="button" onClick={() => addKnownIcon(["barrage"], "remote_equipment")} className="situation-tool">Barrage</button>
                  </>
                )}
              </div>
              <p className="mt-3 text-[10px] leading-relaxed text-neutral-400">
                Les éléments sont placés automatiquement et protégés contre les déplacements à la souris. Sur la feuille, sélectionnez le cadre extérieur puis agrandissez-le pour créer de la place pour le parking et les points de rassemblement.
              </p>
              <div className="mt-3 flex gap-2">
                <select value={selectedIconType} onChange={(event) => setSelectedIconType(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#171719] px-3 py-2 text-[11px] text-neutral-200">
                  <option value="">
                    {documentType === "intervention"
                      ? "Autre équipement déporté de la bibliothèque…"
                      : "Autre pictogramme de la bibliothèque…"}
                  </option>
                  {definitions.map((definition) => <option key={definition.type} value={definition.type}>{definition.label}</option>)}
                </select>
                <button
                  type="button"
                  disabled={!selectedIconType}
                  onClick={() => {
                    const definition = iconDefinitions[selectedIconType];
                    if (definition) onAddPictogram(
                      definition.type,
                      documentType === "intervention" ? "remote_equipment" : "pictogram",
                    );
                  }}
                  className="rounded-lg bg-violet-600 px-3 text-[11px] font-bold text-white disabled:opacity-40"
                >
                  Ajouter
                </button>
              </div>
            </section>

            <section className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">Orientation</h3>
                <span className="text-xs font-bold text-sky-300">{Math.round(state.orientation)}°</span>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {[0, 90, 180, 270].map((angle) => (
                  <button key={angle} type="button" onClick={() => onSetOrientation(angle)} className={`rounded-lg border py-2 text-[11px] font-bold ${state.orientation === angle ? "border-sky-400 bg-sky-500/20 text-sky-200" : "border-white/10 text-neutral-300 hover:bg-white/10"}`}>{angle}°</button>
                ))}
              </div>
              <button type="button" onClick={onOrientFromObserver} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 py-2 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/20">
                <Compass className="h-4 w-4" /> Orienter selon « Vous êtes ici »
              </button>
              <p className="mt-2 text-[10px] leading-relaxed text-neutral-500">Aucune rotation automatique n’est appliquée tant que vous ne lancez pas cette commande.</p>
            </section>

            <section className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">Pré-audit NF X 08-070</h3>
              <div className="mt-3 space-y-2">
                {audit.map((item, index) => (
                  <div key={`${item.severity}-${index}`} className={`flex gap-2 rounded-lg border p-2.5 text-[10px] leading-relaxed ${item.severity === "error" ? "border-red-500/30 bg-red-500/10 text-red-100" : item.severity === "warning" ? "border-amber-500/30 bg-amber-500/10 text-amber-100" : item.severity === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100" : "border-sky-500/25 bg-sky-500/10 text-sky-100"}`}>
                    {item.severity === "ok" ? <Check className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
                    <span>{item.message}</span>
                  </div>
                ))}
              </div>
            </section>

            <button type="button" onClick={onDelete} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 py-2 text-[11px] font-bold text-red-200 hover:bg-red-500/20">
              <Trash2 className="h-4 w-4" /> Supprimer le plan de situation
            </button>
          </fieldset>
        )}
      </div>
      <style jsx>{`
        .situation-tool {
          display: flex;
          min-height: 44px;
          align-items: center;
          justify-content: center;
          gap: 6px;
          border: 1px solid rgba(255,255,255,.1);
          border-radius: 8px;
          padding: 7px;
          color: #d4d4d8;
          font-size: 10px;
          font-weight: 600;
          text-align: center;
          transition: background .15s ease;
        }
        .situation-tool:hover { background: rgba(255,255,255,.08); color: white; }
      `}</style>
    </div>
  );
}
