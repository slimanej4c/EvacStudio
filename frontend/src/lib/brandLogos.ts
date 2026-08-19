export const DEFAULT_STUDIO_LOGO = "/prev-inc-cie-logo.png";
export const STUDIO_LOGO_STORAGE_KEY = "prev-inc-cie.studio-logo";

const MAX_LOGO_FILE_BYTES = 5 * 1024 * 1024;
const MAX_LOGO_SIDE = 1000;

/** Prepare an uploaded logo for offline export and local preference storage. */
export function prepareLogoFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("Sélectionnez une image PNG, JPEG, SVG ou WebP."));
  }
  if (file.size > MAX_LOGO_FILE_BYTES) {
    return Promise.reject(new Error("Le logo ne doit pas dépasser 5 Mo."));
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    const cleanup = () => URL.revokeObjectURL(objectUrl);

    image.onload = () => {
      try {
        const naturalWidth = image.naturalWidth || image.width || 1;
        const naturalHeight = image.naturalHeight || image.height || 1;
        const scale = Math.min(1, MAX_LOGO_SIDE / Math.max(naturalWidth, naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Impossible de préparer le logo.");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/webp", 0.9);
        canvas.width = 0;
        canvas.height = 0;
        cleanup();
        resolve(dataUrl);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("Ce fichier logo ne peut pas être lu."));
    };
    image.src = objectUrl;
  });
}

/** The studio preference is shared by every plan in this browser. */
export function getStoredStudioLogo(fallback = DEFAULT_STUDIO_LOGO): string {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(STUDIO_LOGO_STORAGE_KEY) || fallback;
  } catch {
    return fallback;
  }
}

export function storeStudioLogo(source: string): void {
  if (typeof window === "undefined") return;
  try {
    if (!source || source === DEFAULT_STUDIO_LOGO) {
      window.localStorage.removeItem(STUDIO_LOGO_STORAGE_KEY);
    } else {
      window.localStorage.setItem(STUDIO_LOGO_STORAGE_KEY, source);
    }
  } catch {
    // Storage can be disabled or full; the current editor state still works.
  }
}
