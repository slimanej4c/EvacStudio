"use client";

import React, { useRef } from "react";
import type Konva from "konva";
import { Group, Rect, Text, Line, Ellipse, Circle, Image as KonvaImage, Path } from "react-konva";
import { SheetBlock } from "@/lib/sheetTemplates";
import { IconType, normalizePictogramColorOverride } from "@/utils/safetyIcons";
import { buildCurvePathData } from "@/lib/curvePath";
import { normalizeCanvasIconSizeToAspectRatio } from "@/lib/canvasIconDimensions";
import { hasVisibleShapeFill, shapeHitStrokeWidth } from "@/lib/shapeFill";
import {
  PLAN_SITUATION_FRAME_ID,
  isPlanSituationBlock,
  isPlanSituationMovableElement,
} from "@/lib/planSituation";

export interface SheetLegendEntry {
  type: IconType;
  label: string;
  image: HTMLImageElement | null;
}

interface SheetBlockNodeProps {
  block: SheetBlock;
  isSelected: boolean;
  /** Blocks only move and resize in select mode, like every other object. */
  editable: boolean;
  legendEntries: SheetLegendEntry[];
  images: Partial<Record<string, HTMLImageElement | null>>;
  /** Pictogram artwork, keyed by icon type, for `picto` blocks. */
  pictoImages: Partial<Record<string, HTMLImageElement | null>>;
  /** Recoloured pictograms, keyed by `iconType|#rrggbb`. */
  recoloredPictoImages?: Partial<Record<string, HTMLImageElement | null>>;
  /** Current canvas zoom, used to keep thin contour hit targets screen-sized. */
  interactionScale?: number;
  /** Stable Konva name used to reorder this block with the other sheet layers. */
  layerName?: string;
  onSelect: (id: string, meta?: { shiftKey?: boolean; ctrlKey?: boolean }) => void;
  onChange: (id: string, patch: Partial<SheetBlock>) => void;
  /** Double-click opens the in-place text editor on blocks that carry copy. */
  onEditText?: (id: string) => void;
  /** Notifies parent when dragging handles starts or ends */
  onDragStateChange?: (dragging: boolean) => void;
}

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/** Body copy of a block, with the regulatory capitals applied when asked. */
function bodyText(block: SheetBlock) {
  const text = block.text ?? "";
  return block.uppercase ? text.toUpperCase() : text;
}

/**
 * One sheet block on the Konva stage: the same node the user drags with the
 * mouse and the export captures. Everything is drawn in the block's own
 * coordinates so moving it never touches its content.
 */
export function SheetBlockNode({
  block,
  isSelected,
  editable,
  legendEntries,
  images,
  pictoImages,
  recoloredPictoImages = {},
  interactionScale = 1,
  layerName,
  onSelect,
  onChange,
  onEditText,
  onDragStateChange,
}: SheetBlockNodeProps) {
  const situationDragOrigins = useRef(new WeakMap<Konva.Node, { x: number; y: number }>());
  if (!block.visible) return null;

  const width = Math.max(1, block.width);
  const height = Math.max(1, block.height);
  const pictogramColorOverride = block.kind === "picto"
    ? normalizePictogramColorOverride(block.color)
    : "";
  const pictogramImage = block.kind === "picto" && block.iconType
    ? (pictogramColorOverride
        ? recoloredPictoImages[`${block.iconType}|${pictogramColorOverride}`] ?? pictoImages[block.iconType]
        : pictoImages[block.iconType]) ?? null
    : null;
  const titleHeight = block.title ? block.titleHeight ?? 30 : 0;
  const padding = block.padding ?? 8;
  const showInlineSelection = isSelected && !editable;

  const select = (e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const isMulti = Boolean(e?.evt?.shiftKey || e?.evt?.ctrlKey || e?.evt?.metaKey);
    onSelect(block.id, { shiftKey: isMulti });
  };

  const isSituationBlock = isPlanSituationBlock(block);
  const isSituationFrame = block.id === PLAN_SITUATION_FRAME_ID || block.situationRole === "frame";
  const isPassiveSituationElement = isSituationBlock && !isPlanSituationMovableElement(block) && !isSituationFrame;

  const frame =
    block.kind === "shape" ? null : block.fill || block.stroke ? (
      <Rect
        width={width}
        height={height}
        fill={block.fill ?? (isSituationFrame ? "#ffffff" : "transparent")}
        stroke={block.stroke}
        strokeWidth={block.strokeWidth ?? 0}
        strokeScaleEnabled={false}
        cornerRadius={block.cornerRadius ?? 0}
      />
    ) : (
      // Blocks with no frame of their own still need a surface to grab.
      <Rect
        width={width}
        height={height}
        fill="transparent"
        stroke={undefined}
        strokeWidth={0}
        strokeScaleEnabled={false}
        dash={[4, 4]}
      />
    );

  const titleBar = block.title ? (
    <>
      <Rect
        width={width}
        height={titleHeight}
        fill={block.titleFill}
        cornerRadius={
          block.cornerRadius
            ? [block.cornerRadius, block.cornerRadius, 0, 0]
            : 0
        }
      />
      <Text
        // Kept verbatim: the plate sets its headings in capitals but its numbers
        // as "18 ou 112", so the case belongs to the copy, not to the renderer.
        text={block.title || ""}
        width={width}
        height={titleHeight}
        align={block.titleAlign ?? "center"}
        verticalAlign="middle"
        fill={block.titleColor ?? "#ffffff"}
        fontSize={block.titleFontSize ?? 16}
        fontFamily={FONT}
        fontStyle="bold"
        letterSpacing={block.titleLetterSpacing ?? 0}
        listening={false}
      />
      {/* Ruled tables — the legend — separate their heading with a line rather
          than a colour change. */}
      {block.titleRule && (
        <Line
          points={[0, titleHeight, width, titleHeight]}
          stroke={block.stroke ?? "#1a1a1a"}
          strokeWidth={block.strokeWidth ?? 1}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
    </>
  ) : null;

  let content: React.ReactNode = null;

  if (block.kind === "shape") {
    const stroke = block.stroke ?? block.color ?? "#000000";
    const fillOpacity = block.fillOpacity ?? (block.shapeType === "zone" ? 0.28 : 0.35);
    const hasFill = hasVisibleShapeFill(block.fill, fillOpacity);
    const fill = hasFill ? block.fill! : undefined;
    const points = (block.shapePoints ?? []).flatMap((point) => [
      point.x * width,
      point.y * height
    ]);
    const strokeWidth = block.strokeWidth ?? 1;

    if (block.shapeType === "circle") {
      content = (
        <Ellipse
          x={width / 2}
          y={height / 2}
          radiusX={width / 2}
          radiusY={height / 2}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeScaleEnabled={false}
          fill={fill}
          fillEnabled={hasFill}
          fillOpacity={hasFill ? fillOpacity : undefined}
          hitStrokeWidth={shapeHitStrokeWidth(strokeWidth, interactionScale)}
        />
      );
    } else if (block.shapeType === "rect" || block.shapeType === "zone") {
      content = (
        <Rect
          width={width}
          height={height}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeScaleEnabled={false}
          fill={fill}
          fillEnabled={hasFill}
          fillOpacity={hasFill ? fillOpacity : undefined}
          hitStrokeWidth={shapeHitStrokeWidth(strokeWidth, interactionScale)}
          dash={block.shapeType === "zone" ? [10, 6] : undefined}
        />
      );
    } else if (block.shapeType === "curve_polygon_zone") {
      const closed = block.shapeClosed ?? true;
      const curvePoints = (block.shapePoints ?? []).map((point) => ({
        x: point.x * width,
        y: point.y * height,
      }));
      const curveControlPoints = block.shapeControlPoints
        ? Object.fromEntries(Object.entries(block.shapeControlPoints).map(([index, point]) => [
            Number(index),
            { x: point.x * width, y: point.y * height }
          ]))
        : undefined;
      content = (
        <Path
          data={buildCurvePathData(curvePoints, {
            closed,
            tension: 0,
            controlPoints: curveControlPoints,
            straightSegments: block.shapeStraightSegments,
          })}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeScaleEnabled={false}
          fill={closed ? fill : undefined}
          fillEnabled={closed && hasFill}
          fillOpacity={closed && hasFill ? fillOpacity : undefined}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={shapeHitStrokeWidth(strokeWidth, interactionScale)}
        />
      );
    } else {
      const closed = block.shapeType !== "line"
        && block.shapeType !== "polyline"
        && (block.shapeClosed ?? true);
      content = (
        <Line
          points={points}
          closed={closed}
          tension={block.shapeTension ?? 0}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeScaleEnabled={false}
          fill={closed ? fill : undefined}
          fillEnabled={closed && hasFill}
          fillOpacity={closed && hasFill ? fillOpacity : undefined}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={shapeHitStrokeWidth(strokeWidth, interactionScale)}
        />
      );
    }
  } else if (block.kind === "legend") {
    const rows = legendEntries.length;
    const available = height - titleHeight - padding;
    // Rows share the space left under the title, capped so a short legend does
    // not stretch into oversized bands.
    const rowHeight = rows > 0 ? Math.min(30, Math.max(14, available / rows)) : 0;
    const iconSize = Math.max(10, rowHeight - 6);

    content = (
      <>
        {legendEntries.map((entry, index) => {
          const rowY = titleHeight + index * rowHeight;
          return (
            <React.Fragment key={`${entry.type}-${index}`}>
              {entry.image && (
                <KonvaImage
                  image={entry.image}
                  x={padding}
                  y={rowY + (rowHeight - iconSize) / 2}
                  width={iconSize}
                  height={iconSize}
                  listening={false}
                />
              )}
              <Text
                text={entry.label}
                x={padding + iconSize + 8}
                y={rowY}
                width={Math.max(10, width - padding * 2 - iconSize - 8)}
                height={rowHeight}
                verticalAlign="middle"
                fill={block.color ?? "#1a1a1a"}
                fontSize={block.fontSize ?? 11}
                fontFamily={FONT}
                wrap="none"
                ellipsis
                listening={false}
              />
              {index < rows - 1 && (
                <Line
                  points={[padding, rowY + rowHeight, width - padding, rowY + rowHeight]}
                  stroke="rgba(0,0,0,0.25)"
                  strokeWidth={0.75}
                  listening={false}
                />
              )}
            </React.Fragment>
          );
        })}
        {rows === 0 && (
          <Text
            text="Aucun pictogramme placé"
            y={titleHeight + 10}
            width={width}
            align="center"
            fill="rgba(0,0,0,0.4)"
            fontSize={12}
            fontFamily={FONT}
            listening={false}
          />
        )}
      </>
    );
  } else if (block.kind === "picto") {
    const artworkWidth = Math.max(1, pictogramImage?.naturalWidth || pictogramImage?.width || width);
    const artworkHeight = Math.max(1, pictogramImage?.naturalHeight || pictogramImage?.height || height);
    content = pictogramImage ? (
      <KonvaImage
        image={pictogramImage}
        x={block.flipX ? width : 0}
        y={block.flipY ? height : 0}
        width={artworkWidth}
        height={artworkHeight}
        scaleX={(block.flipX ? -1 : 1) * width / artworkWidth}
        scaleY={(block.flipY ? -1 : 1) * height / artworkHeight}
        listening={false}
      />
    ) : (
      <Rect width={width} height={height} fill="rgba(0,0,0,0.06)" listening={false} />
    );
  } else if (block.kind === "image") {
    const image = block.imageKey ? images[block.imageKey] ?? null : null;
    if (image && image.width && image.height) {
      // Contain: the logo keeps its aspect ratio inside the block the user sized.
      const scale = Math.min(width / image.width, height / image.height);
      const drawW = image.width * scale;
      const drawH = image.height * scale;
      content = (
        <KonvaImage
          image={image}
          x={(width - drawW) / 2}
          y={(height - drawH) / 2}
          width={drawW}
          height={drawH}
          listening={false}
        />
      );
    } else {
      content = (
        <Text
          text={block.imageKey === "studioLogo"
            ? "Logo studio"
            : block.imageKey === "planSituationBackground"
              ? "Fond du plan de situation"
              : "Logo client"}
          width={width}
          height={height}
          align="center"
          verticalAlign="middle"
          fill="rgba(0,0,0,0.35)"
          fontSize={13}
          fontFamily={FONT}
          listening={false}
        />
      );
    }
  } else if (block.kind === "plan") {
    content = null;
  } else {
    content = (
      <Text
        text={bodyText(block)}
        x={padding}
        y={titleHeight + (block.kind === "text" && block.title ? padding : 0)}
        width={Math.max(10, width - padding * 2)}
        height={Math.max(10, height - titleHeight - (block.title ? padding * 2 : 0))}
        align={block.align ?? "left"}
        verticalAlign={block.verticalAlign ?? "top"}
        fill={block.color ?? "#1a1a1a"}
        fontSize={block.fontSize ?? 14}
        fontFamily={FONT}
        fontStyle={block.fontStyle ?? "normal"}
        lineHeight={block.lineHeight ?? 1.3}
        letterSpacing={block.letterSpacing ?? 0}
        wrap="word"
        listening={false}
      />
    );
  }

  const editableShapePoints = block.kind === "shape"
    ? (block.shapePoints ?? []).map((point) => ({
        x: point.x * width,
        y: point.y * height,
      }))
    : [];
  const showShapePointHandles = Boolean(
    block.kind === "shape" &&
    isSelected &&
    editable &&
    editableShapePoints.length >= 2
  );
  const inverseInteractionScale = 1 / Math.max(interactionScale, 0.05);
  const vertexRadius = 5.5 * inverseInteractionScale;
  const curveHandleRadius = 5 * inverseInteractionScale;
  const handleStroke = block.stroke ?? block.color ?? "#2563eb";

  const updateShapeVertex = (index: number, x: number, y: number) => {
    if (!block.shapePoints?.[index]) return;
    onChange(block.id, {
      shapePoints: block.shapePoints.map((point, pointIndex) => pointIndex === index
        ? { x: x / width, y: y / height }
        : point)
    });
  };

  const updateCurveHandle = (segmentIndex: number, x: number | null, y: number | null) => {
    const nextControlPoints = { ...(block.shapeControlPoints ?? {}) };
    if (x === null || y === null) {
      delete nextControlPoints[segmentIndex];
    } else {
      nextControlPoints[segmentIndex] = { x: x / width, y: y / height };
    }
    onChange(block.id, {
      shapeControlPoints: nextControlPoints,
      shapeStraightSegments: x === null || y === null
        ? block.shapeStraightSegments
        : (block.shapeStraightSegments ?? []).filter((index) => index !== segmentIndex),
    });
  };

  const shapePointHandles = showShapePointHandles ? (
    <>
      {block.shapeType === "curve_polygon_zone" && (() => {
        const count = editableShapePoints.length;
        const closed = block.shapeClosed ?? true;
        const segmentCount = closed ? count : count - 1;
        return editableShapePoints.slice(0, segmentCount).map((start, segmentIndex) => {
          const end = closed
            ? editableShapePoints[(segmentIndex + 1) % count]
            : editableShapePoints[segmentIndex + 1];
          const storedControl = block.shapeControlPoints?.[segmentIndex];
          const control = storedControl
            ? { x: storedControl.x * width, y: storedControl.y * height }
            : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

          return (
            <Group key={`${block.id}-sheet-curve-${segmentIndex}`}>
              {storedControl && (
                <Line
                  points={[start.x, start.y, control.x, control.y, end.x, end.y]}
                  stroke="#f59e0b"
                  strokeWidth={1}
                  strokeScaleEnabled={false}
                  dash={[3 * inverseInteractionScale, 3 * inverseInteractionScale]}
                  listening={false}
                />
              )}
              <Circle
                x={control.x}
                y={control.y}
                radius={curveHandleRadius}
                fill={storedControl ? "#f59e0b" : "#38bdf8"}
                stroke="#ffffff"
                strokeWidth={1.5}
                strokeScaleEnabled={false}
                shadowColor="#000000"
                shadowBlur={3 * inverseInteractionScale}
                shadowOpacity={0.3}
                draggable
                onMouseDown={(event) => { event.cancelBubble = true; }}
                onTouchStart={(event) => { event.cancelBubble = true; }}
                onClick={(event) => { event.cancelBubble = true; }}
                onDblClick={(event) => {
                  event.cancelBubble = true;
                  updateCurveHandle(segmentIndex, null, null);
                }}
                onDragStart={(event) => {
                  event.cancelBubble = true;
                  onDragStateChange?.(true);
                  const stage = event.target.getStage();
                  if (stage) stage.container().style.cursor = "grabbing";
                }}
                onDragMove={(event) => {
                  event.cancelBubble = true;
                  updateCurveHandle(segmentIndex, event.target.x(), event.target.y());
                }}
                onDragEnd={(event) => {
                  event.cancelBubble = true;
                  const stage = event.target.getStage();
                  if (stage) stage.container().style.cursor = "pointer";
                  updateCurveHandle(segmentIndex, event.target.x(), event.target.y());
                  onDragStateChange?.(false);
                }}
                onMouseEnter={(event) => {
                  const stage = event.target.getStage();
                  if (stage) stage.container().style.cursor = "pointer";
                }}
                onMouseLeave={(event) => {
                  const stage = event.target.getStage();
                  if (stage) stage.container().style.cursor = "default";
                }}
              />
            </Group>
          );
        });
      })()}

      {editableShapePoints.map((point, index) => (
        <Circle
          key={`${block.id}-sheet-vertex-${index}`}
          x={point.x}
          y={point.y}
          radius={vertexRadius}
          fill="#ffffff"
          stroke={handleStroke}
          strokeWidth={2}
          strokeScaleEnabled={false}
          shadowColor="#000000"
          shadowBlur={4 * inverseInteractionScale}
          shadowOpacity={0.3}
          draggable
          onMouseDown={(event) => { event.cancelBubble = true; }}
          onTouchStart={(event) => { event.cancelBubble = true; }}
          onClick={(event) => { event.cancelBubble = true; }}
          onDragStart={(event) => {
            event.cancelBubble = true;
            onDragStateChange?.(true);
            const stage = event.target.getStage();
            if (stage) stage.container().style.cursor = "grabbing";
          }}
          onDragMove={(event) => {
            event.cancelBubble = true;
            updateShapeVertex(index, event.target.x(), event.target.y());
          }}
          onDragEnd={(event) => {
            event.cancelBubble = true;
            const stage = event.target.getStage();
            if (stage) stage.container().style.cursor = "grab";
            updateShapeVertex(index, event.target.x(), event.target.y());
            onDragStateChange?.(false);
          }}
          onMouseEnter={(event) => {
            const stage = event.target.getStage();
            if (stage) stage.container().style.cursor = "grab";
          }}
          onMouseLeave={(event) => {
            const stage = event.target.getStage();
            if (stage) stage.container().style.cursor = "default";
          }}
        />
      ))}
    </>
  ) : null;

  return (
    <Group
      id={block.id}
      name={[block.id, layerName, isSituationBlock ? "situationBlock" : ""].filter(Boolean).join(" ")}
      x={block.x}
      y={block.y}
      rotation={block.rotation}
      draggable={editable && !isPassiveSituationElement}
      listening={!isPassiveSituationElement}
      onMouseDown={select}
      onTouchStart={select}
      onClick={select}
      onTap={select}
      onDblClick={() => block.kind !== "shape" && onEditText?.(block.id)}
      onDblTap={() => block.kind !== "shape" && onEditText?.(block.id)}
      onDragStart={() => {
        situationDragOrigins.current = new WeakMap();
        onDragStateChange?.(true);
      }}
      onDragMove={(event) => {
        if (isSituationFrame) {
          const dx = event.target.x() - block.x;
          const dy = event.target.y() - block.y;
          const stage = event.target.getStage();
          if (stage) {
            const situationNodes = stage.find(".situationBlock");
            situationNodes.forEach((node) => {
              if (node.id() === block.id) return;
              const origin = situationDragOrigins.current.get(node) ?? node.position();
              situationDragOrigins.current.set(node, origin);
              node.position({ x: origin.x + dx, y: origin.y + dy });
            });
            event.target.getLayer()?.batchDraw();
          }
        }
      }}
      onDragEnd={(event) => {
        onDragStateChange?.(false);
        if (isSituationFrame) {
          situationDragOrigins.current = new WeakMap();
        }
        onChange(block.id, { x: Math.round(event.target.x()), y: Math.round(event.target.y()) });
      }}
      onTransformEnd={(event) => {
        const node = event.target;
        const scaleX = Math.abs(node.scaleX());
        const scaleY = Math.abs(node.scaleY());
        node.scaleX(1);
        node.scaleY(1);
        const transformedWidth = Math.max(20, Math.round(width * scaleX));
        const transformedHeight = Math.max(16, Math.round(height * scaleY));
        const transformedSize = block.kind === "picto" && block.lockAspectRatio !== false
          ? normalizeCanvasIconSizeToAspectRatio(
              transformedWidth,
              transformedHeight,
              Math.max(1, pictogramImage?.naturalWidth || pictogramImage?.width || width)
                / Math.max(1, pictogramImage?.naturalHeight || pictogramImage?.height || height),
              { width, height }
            )
          : { width: transformedWidth, height: transformedHeight };
        const transformedFontSize = block.kind === "text" && block.fontSize
          ? Math.max(6, Math.round(block.fontSize * Math.min(scaleX, scaleY)))
          : undefined;
        onChange(block.id, {
          x: Math.round(node.x()),
          y: Math.round(node.y()),
          width: transformedSize.width,
          height: transformedSize.height,
          rotation: node.rotation(),
          ...(transformedFontSize ? { fontSize: transformedFontSize } : {})
        });
      }}
    >
      {block.kind === "shape" ? content : (
        /* Nothing spills outside the block the user sized. */
        <Group clipX={0} clipY={0} clipWidth={width} clipHeight={height}>
          {frame}
          {titleBar}
          {content}
        </Group>
      )}
      {shapePointHandles}
      {showInlineSelection && (
        <Rect
          width={width}
          height={height}
          stroke="#3b82f6"
          strokeWidth={1}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
    </Group>
  );
}

export default SheetBlockNode;
