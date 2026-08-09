"use client";

import React from "react";
import { Group, Rect, Text, Line, Image as KonvaImage } from "react-konva";
import { SheetBlock } from "@/lib/sheetTemplates";
import { IconType } from "@/utils/safetyIcons";

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
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<SheetBlock>) => void;
  /** Double-click opens the in-place text editor on blocks that carry copy. */
  onEditText?: (id: string) => void;
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
  onSelect,
  onChange,
  onEditText
}: SheetBlockNodeProps) {
  if (!block.visible) return null;

  const width = Math.max(1, block.width);
  const height = Math.max(1, block.height);
  const titleHeight = block.title ? block.titleHeight ?? 30 : 0;
  const padding = block.padding ?? 8;

  const select = () => onSelect(block.id);

  const frame =
    block.fill || block.stroke ? (
      <Rect
        width={width}
        height={height}
        fill={block.fill}
        stroke={isSelected ? "#3b82f6" : block.stroke}
        strokeWidth={isSelected ? Math.max(2, block.strokeWidth ?? 1) : block.strokeWidth ?? 0}
        cornerRadius={block.cornerRadius ?? 0}
      />
    ) : (
      // Blocks with no frame of their own still need a surface to grab.
      <Rect
        width={width}
        height={height}
        fill="transparent"
        stroke={isSelected ? "#3b82f6" : undefined}
        strokeWidth={isSelected ? 1.5 : 0}
        dash={isSelected ? undefined : [4, 4]}
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
          listening={false}
        />
      )}
    </>
  ) : null;

  let content: React.ReactNode = null;

  if (block.kind === "legend") {
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
    const image = block.iconType ? pictoImages[block.iconType] ?? null : null;
    content = image ? (
      <KonvaImage image={image} width={width} height={height} listening={false} />
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
          text={block.imageKey === "studioLogo" ? "Logo studio" : "Logo client"}
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

  return (
    <Group
      id={block.id}
      name={block.id}
      x={block.x}
      y={block.y}
      rotation={block.rotation}
      draggable={editable}
      onMouseDown={select}
      onTouchStart={select}
      onClick={select}
      onTap={select}
      onDblClick={() => onEditText?.(block.id)}
      onDblTap={() => onEditText?.(block.id)}
      onDragEnd={(event) =>
        onChange(block.id, { x: Math.round(event.target.x()), y: Math.round(event.target.y()) })
      }
      onTransformEnd={(event) => {
        const node = event.target;
        const scaleX = Math.abs(node.scaleX());
        const scaleY = Math.abs(node.scaleY());
        node.scaleX(1);
        node.scaleY(1);
        onChange(block.id, {
          x: Math.round(node.x()),
          y: Math.round(node.y()),
          width: Math.max(20, Math.round(width * scaleX)),
          height: Math.max(16, Math.round(height * scaleY)),
          rotation: node.rotation()
        });
      }}
    >
      {/* Nothing spills outside the block the user sized. */}
      <Group clipX={0} clipY={0} clipWidth={width} clipHeight={height}>
        {frame}
        {titleBar}
        {content}
      </Group>
    </Group>
  );
}

export default SheetBlockNode;
