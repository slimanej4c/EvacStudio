export type IconType = string;

export interface SafetyIconDefinition {
  type: IconType;
  label: string;
  color: string;
  svg?: string;
  imageUrl?: string;
  fileName?: string;
}

export const SAFETY_ICONS: Record<IconType, SafetyIconDefinition> = {
  extincteur: {
    type: "extincteur",
    label: "Extincteur",
    color: "#ef4444", // Red
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="35" y="30" width="30" height="55" rx="5" fill="#ef4444" stroke="white" stroke-width="4"/>
      <path d="M42 20H58M50 20V30" stroke="white" stroke-width="5" stroke-linecap="round"/>
      <path d="M58 20C65 20 70 25 70 32C70 36 67 40 62 42" stroke="white" stroke-width="4" stroke-linecap="round"/>
      <rect x="42" y="40" width="16" height="8" rx="2" fill="white"/>
      <line x1="50" y1="55" x2="50" y2="75" stroke="white" stroke-width="3"/>
    </svg>`
  },
  ria: {
    type: "ria",
    label: "RIA",
    color: "#ef4444", // Red
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="15" width="70" height="70" rx="8" fill="#ef4444" stroke="white" stroke-width="4"/>
      <circle cx="50" cy="50" r="22" stroke="white" stroke-width="5" fill="none"/>
      <path d="M35 50H65M50 35V65" stroke="white" stroke-width="4"/>
      <circle cx="50" cy="50" r="10" fill="white"/>
    </svg>`
  },
  issue_de_secours: {
    type: "issue_de_secours",
    label: "Issue de secours",
    color: "#22c55e", // Green
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="15" width="70" height="70" rx="8" fill="#22c55e" stroke="white" stroke-width="4"/>
      <rect x="35" y="30" width="30" height="50" fill="white"/>
      <path d="M50 55L60 45M60 45H52M60 45V53" stroke="#22c55e" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="42" cy="45" r="4" fill="#22c55e"/>
      <path d="M38 65H46" stroke="#22c55e" stroke-width="3"/>
    </svg>`
  },
  alarme_incendie: {
    type: "alarme_incendie",
    label: "Alarme incendie",
    color: "#ef4444",
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="15" width="70" height="70" rx="8" fill="#ef4444" stroke="white" stroke-width="4"/>
      <circle cx="50" cy="45" r="16" fill="white"/>
      <rect x="42" y="62" width="16" height="16" rx="2" fill="white"/>
      <path d="M42 45H58" stroke="#ef4444" stroke-width="4"/>
    </svg>`
  },
  detecteur_incendie: {
    type: "detecteur_incendie",
    label: "Détecteur fumée",
    color: "#3b82f6", // Blue
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="35" fill="#3b82f6" stroke="white" stroke-width="4"/>
      <circle cx="50" cy="50" r="22" stroke="white" stroke-width="3" stroke-dasharray="6 4" fill="none"/>
      <circle cx="50" cy="50" r="8" fill="white"/>
    </svg>`
  },
  eclairage_de_secours: {
    type: "eclairage_de_secours",
    label: "Bloc Secours",
    color: "#22c55e",
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="30" width="70" height="40" rx="6" fill="#22c55e" stroke="white" stroke-width="4"/>
      <circle cx="35" cy="50" r="8" fill="white"/>
      <circle cx="65" cy="50" r="8" fill="white"/>
      <path d="M35 45V55M30 50H40" stroke="#22c55e" stroke-width="3"/>
      <path d="M65 45V55M60 50H70" stroke="#22c55e" stroke-width="3"/>
    </svg>`
  },
  point_rassemblement: {
    type: "point_rassemblement",
    label: "Point rassemblement",
    color: "#22c55e",
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="15" width="70" height="70" rx="8" fill="#22c55e" stroke="white" stroke-width="4"/>
      <circle cx="50" cy="50" r="12" fill="white"/>
      <path d="M28 28L40 40M72 28L60 40M28 72L40 60M72 72L60 60" stroke="white" stroke-width="5" stroke-linecap="round"/>
    </svg>`
  },
  fleche_evacuation: {
    type: "fleche_evacuation",
    label: "Flèche évacuation",
    color: "#22c55e",
    svg: `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="15" y="25" width="70" height="50" rx="6" fill="#22c55e" stroke="white" stroke-width="4"/>
      <path d="M30 50H65M65 50L52 37M65 50L52 63" stroke="white" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
  }
};

export function getSvgDataUrl(type: IconType): string {
  const definition = SAFETY_ICONS[type];
  if (!definition?.svg) return "";
  return `data:image/svg+xml;utf8,${encodeURIComponent(definition.svg)}`;
}

export function getIconImageSource(
  type: IconType,
  definitions: Record<string, SafetyIconDefinition> = SAFETY_ICONS
): string {
  const definition = definitions[type];
  if (!definition) return "";
  if (definition.imageUrl) return definition.imageUrl;
  if (definition.svg) return `data:image/svg+xml;utf8,${encodeURIComponent(definition.svg)}`;
  return "";
}
