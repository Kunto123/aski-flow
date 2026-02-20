import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MdOutlineCrop } from "react-icons/md";
import {
  NodeProps,
  Position,
  useReactFlow,
  useUpdateNodeInternals,
} from "reactflow";
import HandleWrapper from "../handles/HandleWrapper";
import { generateIdForHandle, getTargetHandleKey } from "../../utils/flowUtils";
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
import { updateRoiStreamParams } from "../../api/stream";

interface RoiNodeProps extends NodeProps {
  data: GenericNodeData;
  id: string;
  selected: boolean;
}

type BoxPosition = {
  x: number;
  y: number;
};

type MediaBox = {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
};

const DEFAULT_WIDTH = 120;
const DEFAULT_HEIGHT = 120;
const LIVE_ROI_UPDATE_INTERVAL_MS = 120;

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

  // Prefer the first item that looks like a URL/stream ref.
  for (const item of outputData) {
    if (typeof item !== "string") continue;
    const s = item.trim();
    if (!s) continue;
    if (s.startsWith("stream://")) return normalizeStreamOutputUrl(s);
    if (s.includes("/stream/") || s.includes("/asset/") || s.startsWith("http")) {
      return normalizeStreamOutputUrl(s);
    }
  }

  const first = outputData[0];
  return typeof first === "string" ? normalizeStreamOutputUrl(first) : "";
};

const extractStreamIdFromOutput = (outputData: any): string => {
  const parse = (raw: string) => {
    if (!raw) return "";
    if (raw.startsWith("stream://")) {
      return raw.replace("stream://", "");
    }
    const match = raw.match(/\/stream\/([^/.?]+)\.(mjpg|mjpeg)/i);
    return match?.[1] ?? "";
  };

  if (!outputData) return "";
  if (typeof outputData === "string") return parse(outputData);
  if (!Array.isArray(outputData)) return "";

  for (const item of outputData) {
    if (typeof item !== "string") continue;
    const streamId = parse(item.trim());
    if (streamId) return streamId;
  }
  return "";
};

const isVideoPreviewUrl = (url: string): boolean => {
  if (!url) return false;
  if (isStreamUrl(url)) return false;
  return getOutputExtension(url) === "videoUrl";
};

const RoiNode: React.FC<RoiNodeProps> = ({ data, id, selected }) => {
  const { t } = useTranslation("flow");
  const { onUpdateNodeData, getIncomingEdges, getOutgoingEdges, findNode, runNode, currentNodesRunning } = useContext(NodeContext);
  const { getViewport } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const [isPlaying, setIsPlaying] = useIsPlaying();
  const [showPreview, setShowPreview] = useState<boolean>(false);

  const previewRef = useRef<HTMLDivElement | null>(null);
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  const mediaIntrinsicRef = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const dataRef = useRef<GenericNodeData>(data);
  const lastAutoRunRef = useRef<string>("");
  const hasInitializedAutoRunRef = useRef<boolean>(false);
  const liveUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLiveParamsRef = useRef<{
    x: number;
    y: number;
    w: number;
    h: number;
    width?: number;
    height?: number;
  } | null>(null);
  const lastLiveParamsKeyRef = useRef<string>("");
  const dragStateRef = useRef<
    | {
        mode: "move" | "resize";
        pointerOffsetX: number;
        pointerOffsetY: number;
        startWidth: number;
        startHeight: number;
      }
    | null
  >(null);

  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [mediaBox, setMediaBox] = useState<MediaBox>({
    width: 0,
    height: 0,
    offsetX: 0,
    offsetY: 0,
  });
  const [boxPosition, setBoxPosition] = useState<BoxPosition>({ x: 0, y: 0 });

  const updatePreviewSize = useCallback(() => {
    const element = previewRef.current;
    if (!element) return;

    const width = element.clientWidth;
    const height = element.clientHeight;
    setContainerSize({ width, height });

    const intrinsic = mediaIntrinsicRef.current;
    const iw = intrinsic.width;
    const ih = intrinsic.height;
    if (iw > 0 && ih > 0 && width > 0 && height > 0) {
      const scale = Math.min(width / iw, height / ih);
      const displayedW = Math.max(1, Math.floor(iw * scale));
      const displayedH = Math.max(1, Math.floor(ih * scale));
      setMediaBox({
        width: displayedW,
        height: displayedH,
        offsetX: (width - displayedW) / 2,
        offsetY: (height - displayedH) / 2,
      });
      return;
    }

    // Fallback when intrinsic size is not available (e.g., some MJPEG streams).
    setMediaBox({ width, height, offsetX: 0, offsetY: 0 });
  }, []);

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

    // Ensure initial measurement runs after DOM paint.
    requestAnimationFrame(updatePreviewSize);
    const observer = new ResizeObserver(updatePreviewSize);
    observer.observe(element);

    return () => observer.disconnect();
  }, [showPreview, data.outputData, data.input_url, data.lastRun, updatePreviewSize]);

  const incomingEdge = useMemo(() => {
    const incoming = getIncomingEdges(id) ?? [];
    return incoming.find((edge) => edge.targetHandle === generateIdForHandle(0)) ?? incoming[0];
  }, [getIncomingEdges, id, data.lastRun, data.input_url]);

  const outgoingEdges = useMemo(() => {
    return getOutgoingEdges?.(id) ?? [];
  }, [getOutgoingEdges, id]);

  const hasDownstream = outgoingEdges.length > 0;

  const resolvedInputUrl = useMemo(() => {
    if (incomingEdge) {
      const sourceNode = findNode(incomingEdge.source);
      return getPreviewUrlFromOutput(sourceNode?.data?.outputData);
    }
    return data.input_url ?? "";
  }, [incomingEdge, findNode, data.input_url, data.lastRun]);

  const sourceIsStreamInput = useMemo(() => {
    const input = (resolvedInputUrl ?? "").toString();
    if (!input) return false;
    if (input.startsWith("stream://")) return true;
    return isStreamUrl(input);
  }, [resolvedInputUrl]);

  const roiOutputStreamId = useMemo(
    () => extractStreamIdFromOutput(data.outputData),
    [data.outputData],
  );

  const canLiveUpdateRoiStream = sourceIsStreamInput && !!roiOutputStreamId;

  const flushLiveRoiUpdate = useCallback(async () => {
    if (!canLiveUpdateRoiStream || !roiOutputStreamId) return;
    const payload = pendingLiveParamsRef.current;
    if (!payload) return;
    pendingLiveParamsRef.current = null;
    await updateRoiStreamParams(roiOutputStreamId, payload);
  }, [canLiveUpdateRoiStream, roiOutputStreamId]);

  const scheduleLiveRoiUpdate = useCallback(
    (payload: {
      x: number;
      y: number;
      w: number;
      h: number;
      width?: number;
      height?: number;
    }) => {
      if (!canLiveUpdateRoiStream || !roiOutputStreamId) return;

      const payloadKey = JSON.stringify(payload);
      if (lastLiveParamsKeyRef.current === payloadKey) return;
      lastLiveParamsKeyRef.current = payloadKey;
      pendingLiveParamsRef.current = payload;

      if (liveUpdateTimerRef.current) return;
      liveUpdateTimerRef.current = setTimeout(async () => {
        liveUpdateTimerRef.current = null;
        await flushLiveRoiUpdate();
      }, LIVE_ROI_UPDATE_INTERVAL_MS);
    },
    [canLiveUpdateRoiStream, roiOutputStreamId, flushLiveRoiUpdate],
  );

  useEffect(() => {
    return () => {
      if (liveUpdateTimerRef.current) {
        clearTimeout(liveUpdateTimerRef.current);
        liveUpdateTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const isFirstAutoRunPass = !hasInitializedAutoRunRef.current;
    if (isFirstAutoRunPass) {
      hasInitializedAutoRunRef.current = true;
    }

    if (!hasDownstream) return;
    if (!resolvedInputUrl) return;
    const hasExistingOutput = Array.isArray(data.outputData)
      ? data.outputData.length > 0
      : !!data.outputData;
    // Avoid surprise execution on first wire-up. Auto-run is only for nodes
    // that have already produced output at least once.
    if (!hasExistingOutput) return;

    // Auto-run ROI when it has a connected downstream and a valid upstream input.
    // This makes Camera → ROI → Display work without requiring manual "play" on ROI.
    if (currentNodesRunning?.includes(data.name)) return;

    const key = sourceIsStreamInput
      ? [resolvedInputUrl].join("|")
      : [
          resolvedInputUrl,
          data.x ?? 0,
          data.y ?? 0,
          data.w ?? 1,
          data.h ?? 1,
          data.width ?? "",
          data.height ?? "",
        ].join("|");

    // Do not auto-run immediately when the node is first mounted on canvas.
    if (isFirstAutoRunPass) {
      lastAutoRunRef.current = key;
      return;
    }

    if (lastAutoRunRef.current === key) return;
    lastAutoRunRef.current = key;

    try {
      runNode?.(data.name);
    } catch (e) {
      // ignore
    }
  }, [
    hasDownstream,
    resolvedInputUrl,
    sourceIsStreamInput,
    data.x,
    data.y,
    data.w,
    data.h,
    data.width,
    data.height,
    data.outputData,
    data.name,
    runNode,
    currentNodesRunning,
  ]);

  useEffect(() => {
    const currentFields = data?.config?.fields ?? [];
    if (currentFields.length === 0) return;

    const handleFields = currentFields.filter((field: any) => field.hasHandle);
    if (handleFields.length === 0) return;

    const incomingEdges = getIncomingEdges(id) ?? [];
    const linkedFieldNames = new Set<string>();

    incomingEdges.forEach((edge: any) => {
      const key = getTargetHandleKey(edge);
      const numericKey = Number(key);
      if (!Number.isFinite(numericKey)) return;
      const fieldName = handleFields[numericKey]?.name;
      if (fieldName) linkedFieldNames.add(fieldName);
    });

    let hasChanged = false;
    const updatedFields = currentFields.map((field: any) => {
      const shouldLinked = linkedFieldNames.has(field.name);
      const currentlyLinked = !!field.isLinked;
      if (currentlyLinked !== shouldLinked) {
        hasChanged = true;
        return {
          ...field,
          isLinked: shouldLinked,
        };
      }
      return field;
    });

    const patchedData: any = {};
    linkedFieldNames.forEach((fieldName) => {
      if (data[fieldName] !== undefined) {
        hasChanged = true;
        patchedData[fieldName] = undefined;
      }
    });

    if (!hasChanged) return;

    onUpdateNodeData(id, {
      ...data,
      ...patchedData,
      config: {
        ...data.config,
        fields: updatedFields,
      },
    });
  }, [data, id, getIncomingEdges, onUpdateNodeData]);

  const boxWidth = toPositiveNumber(data.width, DEFAULT_WIDTH);
  const boxHeight = toPositiveNumber(data.height, DEFAULT_HEIGHT);

  const effectiveBoxWidth =
    mediaBox.width > 0 ? Math.min(boxWidth, mediaBox.width) : boxWidth;
  const effectiveBoxHeight =
    mediaBox.height > 0 ? Math.min(boxHeight, mediaBox.height) : boxHeight;

  const maxLeft = Math.max(0, mediaBox.width - effectiveBoxWidth);
  const maxTop = Math.max(0, mediaBox.height - effectiveBoxHeight);

  const persistRoiData = (
    x: number,
    y: number,
    widthForNormalization: number,
    heightForNormalization: number,
    explicitWidth?: number,
    explicitHeight?: number,
  ) => {
    const safeWidthForNorm = Math.max(1, widthForNormalization);
    const safeHeightForNorm = Math.max(1, heightForNormalization);
    const normalizedX =
      mediaBox.width > 0 ? clamp(x / mediaBox.width, 0, 1) : 0;
    const normalizedY =
      mediaBox.height > 0 ? clamp(y / mediaBox.height, 0, 1) : 0;
    const normalizedW =
      mediaBox.width > 0
        ? clamp(safeWidthForNorm / mediaBox.width, 0, 1)
        : 1;
    const normalizedH =
      mediaBox.height > 0
        ? clamp(safeHeightForNorm / mediaBox.height, 0, 1)
        : 1;
    const safeExplicitWidth =
      explicitWidth != null ? Math.max(1, explicitWidth) : undefined;
    const safeExplicitHeight =
      explicitHeight != null ? Math.max(1, explicitHeight) : undefined;

    onUpdateNodeData(id, {
      ...dataRef.current,
      ...(safeExplicitWidth != null ? { width: safeExplicitWidth } : {}),
      ...(safeExplicitHeight != null ? { height: safeExplicitHeight } : {}),
      x: normalizedX,
      y: normalizedY,
      w: normalizedW,
      h: normalizedH,
    });

    // Keep the existing ROI output stream alive and update crop params in-place.
    // This avoids stream recreation + downstream reruns during drag/resize.
    scheduleLiveRoiUpdate({
      x: normalizedX,
      y: normalizedY,
      w: normalizedW,
      h: normalizedH,
      ...(safeExplicitWidth != null ? { width: safeExplicitWidth } : {}),
      ...(safeExplicitHeight != null ? { height: safeExplicitHeight } : {}),
    });
  };

  useEffect(() => {
    if (dragStateRef.current) return;
    if (mediaBox.width <= 0 || mediaBox.height <= 0) return;

    const xNorm = Number(data.x ?? 0);
    const yNorm = Number(data.y ?? 0);

    const nextX = clamp(
      Number.isFinite(xNorm) ? xNorm * mediaBox.width : 0,
      0,
      maxLeft,
    );
    const nextY = clamp(
      Number.isFinite(yNorm) ? yNorm * mediaBox.height : 0,
      0,
      maxTop,
    );

    setBoxPosition({ x: nextX, y: nextY });
  }, [data.x, data.y, mediaBox.width, mediaBox.height, maxLeft, maxTop]);

  const handleNodeFieldChange = (fieldName: string, value: any) => {
    if (fieldName === "width" || fieldName === "height") {
      const requestedWidth =
        fieldName === "width" ? toPositiveNumber(value, 1) : boxWidth;
      const requestedHeight =
        fieldName === "height" ? toPositiveNumber(value, 1) : boxHeight;
      const nextWidth =
        mediaBox.width > 0
          ? Math.min(requestedWidth, mediaBox.width)
          : requestedWidth;
      const nextHeight =
        mediaBox.height > 0
          ? Math.min(requestedHeight, mediaBox.height)
          : requestedHeight;
      const nextX = clamp(
        boxPosition.x,
        0,
        Math.max(0, mediaBox.width - nextWidth),
      );
      const nextY = clamp(
        boxPosition.y,
        0,
        Math.max(0, mediaBox.height - nextHeight),
      );

      setBoxPosition({ x: nextX, y: nextY });
      persistRoiData(
        nextX,
        nextY,
        nextWidth,
        nextHeight,
        requestedWidth,
        requestedHeight,
      );
      return;
    }

    onUpdateNodeData(id, {
      ...dataRef.current,
      [fieldName]: value,
    });
  };

  const getZoom = () => {
    try {
      const vp = getViewport();
      return Number.isFinite(vp?.zoom) && vp.zoom > 0 ? vp.zoom : 1;
    } catch {
      return 1;
    }
  };

  const handleMovePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const container = previewRef.current;
    if (!container) return;

    const zoom = getZoom();
    const rect = container.getBoundingClientRect();
    const pointerX = (event.clientX - rect.left) / zoom;
    const pointerY = (event.clientY - rect.top) / zoom;
    const localX = pointerX - mediaBox.offsetX;
    const localY = pointerY - mediaBox.offsetY;

    dragStateRef.current = {
      mode: "move",
      pointerOffsetX: localX - boxPosition.x,
      pointerOffsetY: localY - boxPosition.y,
      startWidth: effectiveBoxWidth,
      startHeight: effectiveBoxHeight,
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const state = dragStateRef.current;
      const containerEl = previewRef.current;
      if (!state || state.mode !== "move" || !containerEl) return;

      const z = getZoom();
      const r = containerEl.getBoundingClientRect();
      const px = (moveEvent.clientX - r.left) / z;
      const py = (moveEvent.clientY - r.top) / z;
      const lx = px - mediaBox.offsetX;
      const ly = py - mediaBox.offsetY;

      const nextX = clamp(lx - state.pointerOffsetX, 0, maxLeft);
      const nextY = clamp(ly - state.pointerOffsetY, 0, maxTop);

      setBoxPosition({ x: nextX, y: nextY });
      persistRoiData(nextX, nextY, effectiveBoxWidth, effectiveBoxHeight);
    };

    const onPointerUp = () => {
      dragStateRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      void flushLiveRoiUpdate();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const container = previewRef.current;
    if (!container) return;

    const zoom = getZoom();
    const rect = container.getBoundingClientRect();
    const pointerX = (event.clientX - rect.left) / zoom;
    const pointerY = (event.clientY - rect.top) / zoom;
    const localX = pointerX - mediaBox.offsetX;
    const localY = pointerY - mediaBox.offsetY;

    dragStateRef.current = {
      mode: "resize",
      pointerOffsetX: localX,
      pointerOffsetY: localY,
      startWidth: effectiveBoxWidth,
      startHeight: effectiveBoxHeight,
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const state = dragStateRef.current;
      const containerEl = previewRef.current;
      if (!state || state.mode !== "resize" || !containerEl) return;

      const z = getZoom();
      const r = containerEl.getBoundingClientRect();
      const px = (moveEvent.clientX - r.left) / z;
      const py = (moveEvent.clientY - r.top) / z;
      const lx = px - mediaBox.offsetX;
      const ly = py - mediaBox.offsetY;

      const dx = lx - state.pointerOffsetX;
      const dy = ly - state.pointerOffsetY;

      const maxW = Math.max(1, mediaBox.width - boxPosition.x);
      const maxH = Math.max(1, mediaBox.height - boxPosition.y);
      const nextW = clamp(state.startWidth + dx, 1, maxW);
      const nextH = clamp(state.startHeight + dy, 1, maxH);

      const explicitW = Math.max(1, Math.round(nextW));
      const explicitH = Math.max(1, Math.round(nextH));
      persistRoiData(boxPosition.x, boxPosition.y, nextW, nextH, explicitW, explicitH);
    };

    const onPointerUp = () => {
      dragStateRef.current = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      void flushLiveRoiUpdate();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
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

  const outputClearedAt = Number(data.outputClearedAt ?? 0);
  const lastRunAt = (() => {
    if (!data.lastRun) return 0;
    const parsed = new Date(data.lastRun as any).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  })();
  const previewBlockedByClear =
    outputClearedAt > 0 && (lastRunAt <= 0 || lastRunAt <= outputClearedAt);
  const previewUrl = previewBlockedByClear ? "" : resolvedInputUrl;
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
        
<HandleWrapper
  id={generateIdForHandle(0, false)}
  position={
    !!data?.handles?.[generateIdForHandle(0, false)]
      ? data.handles[generateIdForHandle(0, false)]
      : Position.Left
  }
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
                  ref={(el) => {
                    mediaRef.current = el;
                  }}
                  onLoadedMetadata={(e) => {
                    const el = e.currentTarget;
                    mediaIntrinsicRef.current = {
                      width: el.videoWidth || 0,
                      height: el.videoHeight || 0,
                    };
                    updatePreviewSize();
                  }}
                  onLoadedData={updatePreviewSize}
                />
              ) : (
                <img
                  className="block h-auto max-h-[320px] w-full bg-black object-contain"
                  src={previewUrl}
                  alt="ROI preview"
                  ref={(el) => {
                    mediaRef.current = el;
                  }}
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    mediaIntrinsicRef.current = {
                      width: el.naturalWidth || 0,
                      height: el.naturalHeight || 0,
                    };
                    updatePreviewSize();
                  }}
                />
              )
            ) : (
              <div className="flex min-h-[220px] items-center justify-center px-3 text-center text-sm text-slate-700">
                {previewBlockedByClear
                  ? "Output dihapus. Jalankan node untuk menampilkan lagi."
                  : "Masukkan URL / stream yang valid untuk preview."}
              </div>
            )}

            <div
              className="absolute z-10 cursor-move border-2 border-slate-900 bg-slate-100/20"
              style={{
                width: `${effectiveBoxWidth}px`,
                height: `${effectiveBoxHeight}px`,
                left: `${mediaBox.offsetX + boxPosition.x}px`,
                top: `${mediaBox.offsetY + boxPosition.y}px`,
                touchAction: "none",
              }}
              onPointerDown={handleMovePointerDown}
            >
              <div className="pointer-events-none absolute left-1 top-1 rounded bg-slate-900/60 px-1 py-0.5 text-[10px] text-white">
                {Math.round(effectiveBoxWidth)}×{Math.round(effectiveBoxHeight)}
              </div>
              <div
                className="absolute bottom-[-6px] right-[-6px] h-3 w-3 rounded-sm border border-slate-900 bg-slate-200 cursor-se-resize"
                style={{ touchAction: "none" }}
                onPointerDown={handleResizePointerDown}
              />
            </div>
          </div>
        )}
      </NodeLogs>
    </NodeContainer>
  );
};

export default RoiNode;
