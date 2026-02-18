import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { MdOutlineCrop } from "react-icons/md";
import { NodeProps, Position, useUpdateNodeInternals } from "reactflow";
import HandleWrapper from "../handles/HandleWrapper";
import { generateIdForHandle } from "../../utils/flowUtils";
import { NodeContext } from "../../providers/NodeProvider";
import { useIsPlaying } from "../../hooks/useIsPlaying";
import NodePlayButton from "./node-button/NodePlayButton";
import { useTranslation } from "react-i18next";
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
import { getOutputExtension, isStreamUrl } from "./node-output/outputUtils";

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
  if (typeof outputData === "string") return outputData;
  if (!Array.isArray(outputData)) return "";
  if (outputData.length === 0) return "";

  const first = outputData[0];
  if (typeof first === "string" && first.startsWith("stream://")) {
    return typeof outputData[1] === "string" ? outputData[1] : "";
  }

  return typeof first === "string" ? first : "";
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

  const [urlValue, setUrlValue] = useState<string>(data.input_url ?? "");
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
    setUrlValue(data.input_url ?? "");
  }, [data]);

  useEffect(() => {
    if (data.isDone) setIsPlaying(false);
    updateNodeInternals(id);
  }, [data.lastRun, data.outputData, data.isDone, id, updateNodeInternals, setIsPlaying]);

  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setPreviewSize({
        width: rect.width,
        height: rect.height,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

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

  const handleUrlCommit = () => {
    onUpdateNodeData(id, {
      ...dataRef.current,
      input_url: urlValue,
    });
  };

  const handleDimensionChange = (key: "width" | "height", rawValue: string) => {
    const parsed = Number(rawValue);
    const nextValue = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    const nextWidth = key === "width" ? nextValue : boxWidth;
    const nextHeight = key === "height" ? nextValue : boxHeight;
    const nextX = clamp(boxPosition.x, 0, Math.max(0, previewSize.width - nextWidth));
    const nextY = clamp(boxPosition.y, 0, Math.max(0, previewSize.height - nextHeight));

    setBoxPosition({ x: nextX, y: nextY });
    persistRoiData(nextX, nextY, nextWidth, nextHeight);
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

  const previewUrl = resolvedInputUrl;
  const canRenderPreview = !!previewUrl && !previewUrl.startsWith("stream://");
  const showVideoPreview = isVideoPreviewUrl(previewUrl);

  return (
    <NodeContainer>
      <NodeHeader>
        <HandleWrapper
          id={generateIdForHandle(0)}
          position={!!data?.handles?.[generateIdForHandle(0)] ? data.handles[generateIdForHandle(0)] : Position.Left}
          onChangeHandlePosition={handleChangeHandlePosition}
        />
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
        <NodeForm>
          <div>
            <label className="mb-1 block text-sm">url video / ref video</label>
            <input
              className="nodrag nowheel w-full rounded bg-slate-200 px-2 py-2 text-slate-900"
              value={urlValue}
              placeholder="/asset/<image|video> or stream://<id>"
              onChange={(event) => setUrlValue(event.target.value)}
              onBlur={handleUrlCommit}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm">width</label>
            <input
              type="number"
              min={1}
              className="nodrag nowheel w-full rounded bg-slate-200 px-2 py-2 text-slate-900"
              value={boxWidth}
              onChange={(event) => handleDimensionChange("width", event.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm">height</label>
            <input
              type="number"
              min={1}
              className="nodrag nowheel w-full rounded bg-slate-200 px-2 py-2 text-slate-900"
              value={boxHeight}
              onChange={(event) => handleDimensionChange("height", event.target.value)}
            />
          </div>
        </NodeForm>
      </NodeContent>

      <NodeLogs
        showLogs={showPreview}
        onDoubleClick={() => setShowPreview(!showPreview)}
        onClick={!showPreview ? () => setShowPreview(true) : undefined}
        className={`relative flex h-auto w-full flex-grow justify-center p-4 ${
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
