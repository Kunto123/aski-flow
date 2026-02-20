import React, { useContext, useEffect, useMemo, useState } from "react";
import {
  Position,
  NodeProps,
  useUpdateNodeInternals,
  ResizeParams,
  NodeResizeControl,
} from "reactflow";
import { generateIdForHandle } from "../../utils/flowUtils";
import { NodeContext } from "../../providers/NodeProvider";
import { useIsPlaying } from "../../hooks/useIsPlaying";
import NodePlayButton from "./node-button/NodePlayButton";
import HandleWrapper from "../handles/HandleWrapper";
import useHandlePositions from "../../hooks/useHandlePositions";
import { GenericNodeData } from "./types/node";
import {
  NodeBand,
  NodeContainer,
  NodeHeader,
  NodeIcon,
  NodeLogs,
  NodeTitle,
} from "./Node.styles";
import OutputDisplay from "./node-output/OutputDisplay";
import { useTranslation } from "react-i18next";
import { FaTv } from "react-icons/fa";

interface DisplayNodeData extends GenericNodeData {
  handles: any;
  id: string;
  name: string;
  processorType: string;
  nbOutput: number;
  input: string;
  input_key: string;
  outputData?: string[];
  lastRun: string;
}

interface DisplayNodeProps extends NodeProps {
  data: DisplayNodeData;
}

interface Dimensions {
  width: number;
  height: number;
}

const DISPLAY_DEFAULT_WIDTH = 450;
const DISPLAY_DEFAULT_HEIGHT = 260;
const DISPLAY_MIN_WIDTH = 320;
const DISPLAY_MIN_HEIGHT = 180;

function ResizeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="30"
      height="30"
      viewBox="0 0 24 24"
      strokeWidth="2"
      stroke="#F36788"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ position: "absolute", right: -4, bottom: -4 }}
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      <polyline points="16 20 20 20 20 16" />
      <line x1="14" y1="14" x2="20" y2="20" />
      <polyline points="8 4 4 4 4 8" />
      <line x1="4" y1="4" x2="10" y2="10" />
    </svg>
  );
}

const DisplayNode: React.FC<DisplayNodeProps> = React.memo(
  ({ data, id, selected }) => {
    const { t } = useTranslation("flow");
    const { onUpdateNodeData, getIncomingEdges, findNode } = useContext(NodeContext);
    const [dimensions, setDimensions] = useState<Dimensions>({
      width: data.nodeDimensions?.width ?? DISPLAY_DEFAULT_WIDTH,
      height: data.nodeDimensions?.height ?? DISPLAY_DEFAULT_HEIGHT,
    });
    const [isPlaying, setIsPlaying] = useIsPlaying();
    const updateNodeInternals = useUpdateNodeInternals();

    const inputHandleId = useMemo(() => generateIdForHandle(0), []);
    const outputHandleId = useMemo(() => generateIdForHandle(0, true), []);
    const { allHandlePositions } = useHandlePositions(data, 1, [
      outputHandleId,
    ]);

    useEffect(() => {
      setIsPlaying(false);
      updateNodeInternals(id);
    }, [data.lastRun, id, setIsPlaying, updateNodeInternals]);

    useEffect(() => {
      if (!data.nodeDimensions) return;
      setDimensions((prev) => ({
        width: data.nodeDimensions?.width ?? prev.width,
        height: data.nodeDimensions?.height ?? prev.height,
      }));
    }, [data.nodeDimensions?.width, data.nodeDimensions?.height]);

    useEffect(() => {
      updateNodeInternals(id);
    }, [id, dimensions.width, dimensions.height, updateNodeInternals]);

    const incomingEdge = useMemo(() => {
      const incoming = getIncomingEdges?.(id) ?? [];
      return (
        incoming.find((edge: any) => edge.targetHandle === inputHandleId) ??
        incoming[0]
      );
    }, [getIncomingEdges, id, inputHandleId, data.lastRun]);

    const upstreamNode = useMemo(() => {
      if (!incomingEdge) return undefined;
      return findNode?.(incomingEdge.source);
    }, [incomingEdge, findNode]);

    const upstreamOutput = useMemo(() => {
      return upstreamNode?.data?.outputData;
    }, [upstreamNode]);

    const normalizedOutput = useMemo(() => {
      const hasMeaningfulOutput = (value: any) => {
        if (value == null) return false;
        if (typeof value === "string") return value.trim().length > 0;
        if (Array.isArray(value)) {
          const nonEmpty = value.filter(
            (item) =>
              item != null &&
              (typeof item !== "string" || item.trim().length > 0),
          );
          return nonEmpty.length > 0;
        }
        return true;
      };

      const hasIncoming = !!incomingEdge;
      const outputClearedAt = Number(data.outputClearedAt ?? 0);
      const upstreamLastRunAt = (() => {
        if (!upstreamNode?.data?.lastRun) return 0;
        const parsed = new Date(upstreamNode.data.lastRun as any).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
      })();
      const upstreamBlockedByClear =
        outputClearedAt > 0 &&
        (upstreamLastRunAt <= 0 || upstreamLastRunAt <= outputClearedAt);

      // Prefer the currently connected upstream output so Display isn't stuck showing stale data
      // after rewiring (e.g., Camera → Display then ROI → Display).
      const raw =
        hasIncoming &&
        !upstreamBlockedByClear &&
        hasMeaningfulOutput(upstreamOutput)
          ? upstreamOutput
          : hasMeaningfulOutput(data.outputData)
            ? data.outputData
            : undefined;
      if (raw == null) return null;

      // Normalize to a string array so OutputDisplay is stable.
      if (Array.isArray(raw)) {
        return raw
          .flatMap((item) => (item == null ? [] : [item]))
          .map((item) =>
            typeof item === "string" ? item : JSON.stringify(item, null, 2),
          );
      }

      return [typeof raw === "string" ? raw : JSON.stringify(raw, null, 2)];
    }, [incomingEdge, data.outputData, data.outputClearedAt, upstreamOutput, upstreamNode?.data?.lastRun]);

    const displayData = useMemo(
      () => ({
        ...data,
        outputData: normalizedOutput ?? undefined,
      }),
      [data, normalizedOutput],
    );

    const handlePlayClick = () => {
      setIsPlaying(true);
    };

    const handleChangeHandlePosition = (
      newPosition: Position,
      handleId: string,
    ) => {
      onUpdateNodeData(id, {
        ...data,
        handles: {
          ...data.handles,
          [handleId]: newPosition,
        },
      });
      updateNodeInternals(id);
    };

    const toDisplayDimensions = (params: ResizeParams): Dimensions => {
      return {
        width: Math.max(DISPLAY_MIN_WIDTH, Math.round(params.width)),
        height: Math.max(DISPLAY_MIN_HEIGHT, Math.round(params.height)),
      };
    };

    const handleResize = (params: ResizeParams) => {
      setDimensions(toDisplayDimensions(params));
    };

    const handleSaveDimensions = (params: ResizeParams) => {
      const next = toDisplayDimensions(params);
      setDimensions(next);

      // Persist so the size survives re-renders / reloads.
      onUpdateNodeData(id, {
        ...data,
        nodeDimensions: next,
      });
    };

    return (
      <NodeContainer
        key={id}
        width={dimensions.width}
        height={dimensions.height}
        style={{
          minWidth: DISPLAY_MIN_WIDTH,
          minHeight: DISPLAY_MIN_HEIGHT,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {selected && (
          <NodeResizeControl
            minWidth={DISPLAY_MIN_WIDTH}
            minHeight={DISPLAY_MIN_HEIGHT}
            onResize={(_, params) => {
              handleResize(params);
            }}
            onResizeEnd={(_, params) => {
              handleSaveDimensions(params);
            }}
            style={{
              backgroundColor: "transparent",
              border: "none",
            }}
          >
            <ResizeIcon />
          </NodeResizeControl>
        )}

        <NodeHeader>
          <NodeIcon>
            <FaTv />
          </NodeIcon>
          <NodeTitle>{data.appearance?.customName ?? t("Display")}</NodeTitle>
          <NodePlayButton
            isPlaying={isPlaying}
            hasRun={!!data.lastRun}
            onClick={handlePlayClick}
            nodeName={data.name}
          />
        </NodeHeader>
        <NodeBand
          selected={selected}
          color={data.appearance?.color}
          className={`${selected ? "animate-pulse" : ""}`}
        />
        <HandleWrapper
          id={inputHandleId}
          position={
            !!data?.handles && data.handles[inputHandleId]
              ? data.handles[inputHandleId]
              : Position.Left
          }
          linkedHandlePositions={allHandlePositions}
          onChangeHandlePosition={handleChangeHandlePosition}
        />

        <HandleWrapper
          id={outputHandleId}
          position={
            !!data?.handles && data.handles[outputHandleId]
              ? data.handles[outputHandleId]
              : Position.Right
          }
          linkedHandlePositions={allHandlePositions}
          onChangeHandlePosition={handleChangeHandlePosition}
          isOutput
        />

        <NodeLogs
          className="nodrag nowheel flex h-full min-h-0 w-full flex-1 overflow-hidden"
          showLogs={true}
          noPadding
          style={{ maxHeight: "none", overflowY: "hidden" }}
        >
          {normalizedOutput != null ? (
            <OutputDisplay
              data={displayData as any}
              fitInContainer
              fitMode="contain"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center p-3 text-sm text-slate-300">
              {t("ConnectOutputToDisplay", "Connect an output to display")}
            </div>
          )}
        </NodeLogs>
      </NodeContainer>
    );
  },
);
export default DisplayNode;
