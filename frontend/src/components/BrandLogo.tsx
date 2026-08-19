type BrandLogoProps = {
  compact?: boolean;
  className?: string;
  priority?: boolean;
};

/** PREV' INC & CIE identity, shared by public pages and the application shell. */
export function BrandLogo({ compact = false, className = "", priority = false }: BrandLogoProps) {
  return (
    <img
      src={compact ? "/prev-inc-cie-mark.png" : "/prev-inc-cie-logo.png"}
      alt="PREV' INC & CIE"
      className={["block object-contain", className].filter(Boolean).join(" ")}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
