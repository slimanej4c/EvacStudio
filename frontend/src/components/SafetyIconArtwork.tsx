"use client";

import { useEffect, useState } from "react";
import { buildIconPreviewSource, SafetyIconDefinition } from "@/utils/safetyIcons";

interface SafetyIconArtworkProps {
  definition?: SafetyIconDefinition;
  alt?: string;
  className?: string;
}

export function SafetyIconArtwork({
  definition,
  alt = "",
  className = "h-full w-full",
}: SafetyIconArtworkProps) {
  const [resolved, setResolved] = useState<{
    definition?: SafetyIconDefinition;
    source: string;
  }>({ definition: undefined, source: "" });

  useEffect(() => {
    let cancelled = false;

    void buildIconPreviewSource(definition).then((source) => {
      if (!cancelled) setResolved({ definition, source });
    });

    return () => {
      cancelled = true;
    };
  }, [definition]);

  const source = resolved.definition === definition ? resolved.source : "";

  if (!source) {
    return <span aria-hidden="true" className={`${className} animate-pulse rounded bg-black/10`} />;
  }

  // These sources are signed media URLs or local data-images; Next/Image would
  // add an unnecessary optimization request for every toolbar pictogram.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={source} alt={alt} className={`${className} object-contain`} />;
}
