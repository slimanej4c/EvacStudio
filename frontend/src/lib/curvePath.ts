export interface CurvePathPoint {
  x: number;
  y: number;
}

interface VertexControls {
  incoming: CurvePathPoint;
  outgoing: CurvePathPoint;
}

function controlsAtVertex(
  points: CurvePathPoint[],
  index: number,
  closed: boolean,
  tension: number
): VertexControls | null {
  const count = points.length;
  if (count < 3 || (!closed && (index === 0 || index === count - 1))) return null;

  const previous = points[(index - 1 + count) % count];
  const current = points[index];
  const next = points[(index + 1) % count];
  const previousDistance = Math.hypot(current.x - previous.x, current.y - previous.y);
  const nextDistance = Math.hypot(next.x - current.x, next.y - current.y);
  const totalDistance = previousDistance + nextDistance;
  if (!totalDistance) {
    return { incoming: { ...current }, outgoing: { ...current } };
  }

  const incomingFactor = tension * previousDistance / totalDistance;
  const outgoingFactor = tension * nextDistance / totalDistance;
  return {
    incoming: {
      x: current.x - incomingFactor * (next.x - previous.x),
      y: current.y - incomingFactor * (next.y - previous.y),
    },
    outgoing: {
      x: current.x + outgoingFactor * (next.x - previous.x),
      y: current.y + outgoingFactor * (next.y - previous.y),
    },
  };
}

/**
 * Builds the same smooth path as Konva's tension line, while allowing selected
 * segments to stay genuinely straight and individual quadratic handles to
 * override the automatic curve.
 */
export function buildCurvePathData(
  points: CurvePathPoint[],
  options: {
    closed?: boolean;
    tension?: number;
    controlPoints?: Record<number, CurvePathPoint>;
    straightSegments?: number[];
  } = {}
): string {
  if (!points.length) return "";

  const closed = options.closed ?? true;
  const tension = options.tension ?? 0.35;
  const segmentCount = closed ? points.length : Math.max(0, points.length - 1);
  const straightSegments = new Set(options.straightSegments || []);
  const controls = points.map((_, index) => controlsAtVertex(points, index, closed, tension));
  let data = `M ${points[0].x} ${points[0].y}`;

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const destinationIndex = (segmentIndex + 1) % points.length;
    const destination = points[destinationIndex];
    const customControl = options.controlPoints?.[segmentIndex];

    if (straightSegments.has(segmentIndex)) {
      data += ` L ${destination.x} ${destination.y}`;
    } else if (customControl) {
      data += ` Q ${customControl.x} ${customControl.y} ${destination.x} ${destination.y}`;
    } else if (tension === 0) {
      data += ` L ${destination.x} ${destination.y}`;
    } else {
      const outgoing = controls[segmentIndex]?.outgoing;
      const incoming = controls[destinationIndex]?.incoming;
      if (!closed && segmentIndex === 0 && incoming) {
        data += ` Q ${incoming.x} ${incoming.y} ${destination.x} ${destination.y}`;
      } else if (!closed && segmentIndex === segmentCount - 1 && outgoing) {
        data += ` Q ${outgoing.x} ${outgoing.y} ${destination.x} ${destination.y}`;
      } else if (outgoing && incoming) {
        data += ` C ${outgoing.x} ${outgoing.y} ${incoming.x} ${incoming.y} ${destination.x} ${destination.y}`;
      } else {
        data += ` L ${destination.x} ${destination.y}`;
      }
    }
  }

  if (closed && points.length >= 3) data += " Z";
  return data;
}
