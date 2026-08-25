type BrandLogoProps = {
  compact?: boolean;
  className?: string;
  priority?: boolean;
};

const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const basePath = rawBasePath
  ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

/** PREV' INC & CIE identity, shared by public pages and the application shell. */
export function BrandLogo({ compact = false, className = "", priority = false }: BrandLogoProps) {
  const logoPath = compact ? "/prev-inc-cie-mark.png" : "/prev-inc-cie-logo.png";

  return (
    <img
      src={`${basePath}${logoPath}`}
      alt="PREV' INC & CIE"
      className={["block object-contain", className].filter(Boolean).join(" ")}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
