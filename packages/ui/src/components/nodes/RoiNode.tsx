import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { MdOutlineCrop } from "react-icons/md";
import { NodeProps, Position, useUpdateNodeInternals } from "reactflow";
import HandleWrapper from "../handles/HandleWrapper";
import { generateIdForHandle } from "../../utils/flowUtils";
import { NodeContext } from "../../providers/NodeProvider";
import { useIsPlaying } from "../../hooks/useIsPlaying";
import NodePlayButton from "./node-button/NodePlayButton";
import { useTranslation } from "react-i18next";
import { useFormFields } from "../../hooks/useFormFields";
import {
  NodeBand,
  NodeContainer,
  NodeContent,
  NodeForm,
  NodeHeader,
  NodeIcon,
  NodeLogs,
  NodeLogsText,
  NodeTitle,
} from "./Node.styles";
import { GenericNodeData } from "./types/node";
import {
  getOutputExtension,
  isStreamUrl,
  normalizeStreamOutputUrl,
} from "./node-output/outputUtils";
import { roiNodeConfig } from "../../nodes-configuration/roiNode";

interface RoiNodeProps extends NodeProps {
  data: GenericNodeData;
  id: string;
  selected: boolean;
}

type BoxPosition = {
  x: number;
  y: number;
};

const DEFAULT_WIDTH = 120;
const DEFAULT_HEIGHT = 120;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const toPositiveNumber = (value: any, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const getPreviewUrlFromOutput = (outputData: any): string => {
  if (!outputData) return "";
  if (typeof outputData === "string") return normalizeStreamOutputUrl(outputData);
  if (!Array.isArray(outputData)) return "";
  if (outputData.length === 0) return "";

  const first = outputData[0];
  return typeof first === "string" ? normalizeStreamOutputUrl(first) : "";
};

const isVideoPreviewUrl = (url: string): boolean => {
  if (!url) return false;
  if (isStreamUrl(url)) return false;
  return getOutputExtension(url) === "videoUrl";
};

const RoiNode: React.FC<RoiNodeProps> = ({ data, id, selected }) => {
  const { t } = useTranslation("flow");
  const { onUpdateNodeData, getIncomingEdges, findNode } = useContext(NodeContext);
  const updateNodeInternals = useUpdateNodeInternals();
  const [isPlaying, setIsPlaying] = useIsPlaying();
  const [showPreview, setShowPreview] = useState<boolean>(false);

  const previewRef = useRef<HTMLDivElement | null>(null);
  const dataRef = useRef<GenericNodeData>(data);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number } | null>(null);

  const [previewSize, setPreviewSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [boxPosition, setBoxPosition] = useState<BoxPosition>({ x: 0, y: 0 });

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    const currentFields = data?.config?.fields ?? [];
    const hasWidthField = currentFields.some((field: any) => field.name === "width");
    const hasHeightField = currentFields.some(
      (field: any) => field.name === "height",
    );

    if (hasWidthField && hasHeightField) {
      return;
    }

    onUpdateNodeData(id, {
      ...data,
      width: toPositiveNumber(data.width, DEFAULT_WIDTH),
      height: toPositiveNumber(data.height, DEFAULT_HEIGHT),
      x: data.x ?? 0,
      y: data.y ?? 0,
      w: data.w ?? 1,
      h: data.h ?? 1,
      config: {
        ...data.config,
        fields: roiNodeConfig.fields,
        inputNames: roiNodeConfig.inputNames,
      },
    });
  }, [data, id, onUpdateNodeData]);

  useEffect(() => {
    if (data.isDone) setIsPlaying(false);
    updateNodeInternals(id);
  }, [data.lastRun, data.outputData, data.isDone, id, updateNodeInternals, setIsPlaying]);

  useEffect(() => {
    if (!showPreview) return;
    const element = previewRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setPreviewSize({
        width: rect.width,
        height: rect.height,
      });
    };

    // Ensure initial measurement runs after DOM paint.
    requestAnimationFrame(updateSize);
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);

    return () => observer.disconnect();
  }, [showPreview, data.outputData, data.input_url, data.lastRun]);

  const incomingEdge = useMemo(() => {
    const incoming = getIncomingEdges(id) ?? [];
    return incoming.find((edge) => edge.targetHandle === generateIdForHandle(0)) ?? incoming[0];
  }, [getIncomingEdges, id, data.lastRun, data.input_url]);

  const resolvedInputUrl = useMemo(() => {
    if (incomingEdge) {
      const sourceNode = findNode(incomingEdge.source);
      return getPreviewUrlFromOutput(sourceNode?.data?.outputData);
    }
    return data.input_url ?? "";
  }, [incomingEdge, findNode, data.input_url, data.lastRun]);

  const boxWidth = toPositiveNumber(data.width, DEFAULT_WIDTH);
  const boxHeight = toPositiveNumber(data.height, DEFAULT_HEIGHT);

  const maxLeft = Math.max(0, previewSize.width - boxWidth);
  const maxTop = Math.max(0, previewSize.height - boxHeight);

  const persistRoiData = (x: number, y: number, width: number, height: number) => {
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);
    const normalizedX = previewSize.width > 0 ? clamp(x / previewSize.width, 0, 1) : 0;
    const normalizedY = previewSize.height > 0 ? clamp(y / previewSize.height, 0, 1) : 0;
    const normalizedW =
      previewSize.width > 0 ? clamp(safeWidth / previewSize.width, 0, 1) : 1;
    const normalizedH =
      previewSize.height > 0 ? clamp(safeHeight / previewSize.height, 0, 1) : 1;

    onUpdateNodeData(id, {
      ...dataRef.current,
      width: safeWidth,
      height: safeHeight,
      x: normalizedX,
      y: normalizedY,
      w: normalizedW,
      h: normalizedH,
    });
  };

  useEffect(() => {
    if (isDraggingRef.current) return;
    if (previewSize.width <= 0 || previewSize.height <= 0) return;

    const xNorm = Number(data.x ?? 0);
    const yNorm = Number(data.y ?? 0);

    const nextX = clamp(
      Number.isFinite(xNorm) ? xNorm * previewSize.width : 0,
      0,
      maxLeft,
    );
    const nextY = clamp(
      Number.isFinite(yNorm) ? yNorm * previewSize.height : 0,
      0,
      maxTop,
    );

    setBoxPosition({ x: nextX, y: nextY });
  }, [data.x, data.y, previewSize.width, previewSize.height, maxLeft, maxTop]);

  const handleNodeFieldChange = (fieldName: string, value: any) => {
    if (fieldName === "width" || fieldName === "height") {
      const nextWidth = fieldName === "width" ? toPositiveNumber(value, 1) : boxWidth;
      const nextHeight =
        fieldName === "height" ? toPositiveNumber(value, 1) : boxHeight;
      const nextX = clamp(
        boxPosition.x,
        0,
        Math.max(0, previewSize.width - nextWidth),
      );
      const nextY = clamp(
        boxPosition.y,
        0,
        Math.max(0, previewSize.height - nextHeight),
      );

      setBoxPosition({ x: nextX, y: nextY });
      persistRoiData(nextX, nextY, nextWidth, nextHeight);
      return;
    }

    onUpdateNodeData(id, {
      ...dataRef.current,
      [fieldName]: value,
    });
  };

  const handleDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    isDraggingRef.current = true;
    dragStartRef.current = {
      mouseX: event.clientX,
      mouseY: event.clientY,
      startX: boxPosition.x,
      startY: boxPosition.y,
    };

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = moveEvent.clientX - dragStartRef.current.mouseX;
      const dy = moveEvent.clientY - dragStartRef.current.mouseY;
      const nextX = clamp(dragStartRef.current.startX + dx, 0, maxLeft);
      const nextY = clamp(dragStartRef.current.startY + dy, 0, maxTop);

      setBoxPosition({ x: nextX, y: nextY });
      persistRoiData(nextX, nextY, boxWidth, boxHeight);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      dragStartRef.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handlePlayClick = () => {
    setIsPlaying(true);
  };

  const handleChangeHandlePosition = (newPosition: Position, handleId: string) => {
    onUpdateNodeData(id, {
      ...data,
      handles: {
        ...data.handles,
        [handleId]: newPosition,
      },
    });
    updateNodeInternals(id);
  };

  const previewUrl = getPreviewUrlFromOutput(data.outputData) || resolvedInputUrl;
  const canRenderPreview = !!previewUrl && !previewUrl.startsWith("stream://");
  const showVideoPreview = isVideoPreviewUrl(previewUrl);
  const formFields = useFormFields(
    data,
    id,
    handleNodeFieldChange,
    undefined,
    undefined,
    {
      showHandles: true,
      showLabels: true,
      specificFields: ["input_url", "width", "height"],
    },
  );

  return (
    <NodeContainer>
      <NodeHeader>
        <NodeIcon>
          <MdOutlineCrop />
        </NodeIcon>
        <NodeTitle>{data.appearance?.customName ?? "ROI"}</NodeTitle>
        <HandleWrapper
          id={generateIdForHandle(0, true)}
          position={
            !!data?.handles?.[generateIdForHandle(0, true)]
              ? data.handles[generateIdForHandle(0, true)]
              : Position.Right
          }
          isOutput
          onChangeHandlePosition={handleChangeHandlePosition}
        />
        <NodePlayButton
          isPlaying={isPlaying}
          hasRun={!!data.lastRun}
          onClick={handlePlayClick}
          nodeName={data.name}
        />
      </NodeHeader>
      <NodeBand selected={selected} color={data.appearance?.color} />

      <NodeContent>
        <NodeForm>{formFields}</NodeForm>
      </NodeContent>

      <NodeLogs
        showLogs={showPreview}
        noPadding={showPreview}
        onDoubleClick={() => setShowPreview(!showPreview)}
        onClick={!showPreview ? () => setShowPreview(true) : undefined}
        className={`relative flex h-auto w-full flex-grow justify-center ${
          showPreview ? "nodrag nowheel" : ""
        }`}
      >
        {!showPreview ? (
          <NodeLogsText className="flex h-auto w-full justify-center text-center">
            {t("ClickToShowOutput")}
          </NodeLogsText>
        ) : (
          <div
            ref={previewRef}
            className="relative min-h-[220px] w-full overflow-hidden rounded bg-slate-300"
          >
            {canRenderPreview ? (
              showVideoPreview ? (
                <video
                  className="block h-auto max-h-[320px] w-full bg-black"
                  src={previewUrl}
                  controls
                />
              ) : (
                <img
                  className="block h-auto max-h-[320px] w-full bg-black object-contain"
                  src={previewUrl}
                  alt="ROI preview"
                />
              )
            ) : (
              <div className="flex min-h-[220px] items-center justify-center px-3 text-center text-sm text-slate-700">
                Masukkan URL / stream yang valid untuk preview.
              </div>
            )}

            <div
              className="absolute cursor-move border-2 border-slate-900 bg-slate-100/20"
              style={{
                width: `${boxWidth}px`,
                height: `${boxHeight}px`,
                left: `${boxPosition.x}px`,
                top: `${boxPosition.y}px`,
              }}
              onMouseDown={handleDragStart}
            />
          </div>
        )}
      </NodeLogs>
    </NodeContainer>
  );
};

export default RoiNode;
