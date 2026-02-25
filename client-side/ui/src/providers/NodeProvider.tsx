import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Node, Edge } from "reactflow";
import { nodesTopologicalSort, convertFlowToJson } from "../utils/flowUtils";
import { FlowEvent, SocketContext } from "./SocketProvider";
import { useTranslation } from "react-i18next";
import { toastErrorMessage, toastFastInfoMessage } from "../utils/toastUtils";
import {
  createErrorMessageForMissingFields,
  getNodeInError,
} from "../utils/flowChecker";
import { createUniqNodeId } from "../utils/nodeUtils";
import { NodeAppearance, NodeData } from "../components/nodes/types/node";
import { NodeConfig } from "../nodes-configuration/types";
import { getDefaultOptions } from "../utils/nodeConfigurationUtils";
import { FlowMetadata } from "../layout/main-layout/AppLayout";
import {
  stopAllCameraStreams,
  stopCameraStreamsByIndex,
  stopStream,
  stopStreamsByOwner,
} from "../api/stream";
import {
  prewarmClientCameraPublishers,
  stopAllClientCameraPublishers,
  stopClientCameraPublisherByIndex,
} from "../services/clientCameraPublishers";

function extractStreamIdsFromValue(value: any): string[] {
  const streamIds = new Set<string>();

  const parseString = (raw: string) => {
    if (!raw) return;
    if (raw.startsWith("stream://")) {
      streamIds.add(raw.replace("stream://", ""));
      return;
    }

    const streamMatch = raw.match(/\/stream\/([^/.?]+)\.(mjpg|mjpeg)/i);
    if (streamMatch?.[1]) {
      streamIds.add(streamMatch[1]);
    }
  };

  if (typeof value === "string") {
    parseString(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => {
      if (typeof item === "string") parseString(item);
    });
  }

  return Array.from(streamIds);
}

function isLikelyCameraNode(node: any): boolean {
  const processorType = String(node?.data?.processorType || "").toLowerCase();
  const nodeName = String(node?.data?.name || "").toLowerCase();
  const hasCameraIndex =
    node?.data?.camera_index !== undefined &&
    node?.data?.camera_index !== null &&
    node?.data?.camera_index !== "";
  return (
    processorType === "camera-input" ||
    processorType.includes("camera") ||
    nodeName.endsWith("#camera-input") ||
    hasCameraIndex
  );
}

export type NodeDimensions = {
  width?: number | null;
  height?: number | null;
};

interface NodeContextType {
  runNode: (nodeName: string) => boolean;
  runAllNodes: () => void;
  hasParent: (id: string) => boolean;
  getIncomingEdges: (id: string) => Edge[] | undefined;
  getOutgoingEdges: (id: string) => Edge[] | undefined;
  removeNodeIncomingEdges: (id: string) => void;
  removeEdgesByIds: (id: string[]) => void;
  getEdgeIndex: (id: string) => Edge | undefined;
  showOnlyOutput?: boolean;
  onUpdateNodeData: (nodeId: string, data: any) => void;
  onUpdateNodes: (nodesUpdated: Node[], edgesUpdated: Edge[]) => void;
  getNodeDimensions: (nodeId: string) => NodeDimensions | undefined;
  duplicateNode: (nodeId: string) => void;
  createNodeRef: (nodeId: string) => void;
  clearNodeOutput: (nodeId: string) => void;
  clearAllOutput: () => void;
  updateNodeAppearance: (nodeId: string, appearance: NodeAppearance) => void;
  overrideConfigForNode: (
    nodeId: string,
    newConfig: NodeConfig,
    newData: NodeData,
  ) => void;
  removeNode: (nodeId: string) => void;
  removeAll: () => void;
  findNode: (nodeId: string) => Node | undefined;
  currentNodeIdSelected: string;
  setCurrentNodeIdSelected: (id: string) => void;
}

interface NodeRuntimeContextType {
  isRunning: boolean;
  currentNodesRunning: string[];
  errorCount: number;
}

const DUPLICATED_NODE_OFFSET = 100;

export const NodeContext = createContext<NodeContextType>({
  runNode: () => false,
  runAllNodes: () => undefined,
  hasParent: () => false,
  getIncomingEdges: () => undefined,
  getOutgoingEdges: () => undefined,
  removeNodeIncomingEdges: () => undefined,
  removeEdgesByIds: () => undefined,
  getEdgeIndex: () => undefined,
  showOnlyOutput: false,
  onUpdateNodeData: () => undefined,
  onUpdateNodes: () => undefined,
  getNodeDimensions: () => undefined,
  duplicateNode: () => undefined,
  createNodeRef: () => undefined,
  clearNodeOutput: () => undefined,
  clearAllOutput: () => undefined,
  updateNodeAppearance: () => undefined,
  overrideConfigForNode: () => undefined,
  removeNode: () => undefined,
  removeAll: () => undefined,
  findNode: () => undefined,
  currentNodeIdSelected: "",
  setCurrentNodeIdSelected: () => undefined,
});

export const NodeRuntimeContext = createContext<NodeRuntimeContextType>({
  isRunning: false,
  currentNodesRunning: [],
  errorCount: 0,
});

export const NodeProvider = ({
  nodes,
  edges,
  metadata,
  showOnlyOutput,
  isRunning,
  currentNodesRunning,
  errorCount,
  onUpdateNodeData,
  onUpdateNodes,
  children,
}: {
  nodes: Node[];
  edges: Edge[];
  metadata?: FlowMetadata;
  showOnlyOutput?: boolean;
  isRunning: boolean;
  currentNodesRunning: string[];
  errorCount: number;
  onUpdateNodeData: (nodeId: string, data: any) => void;
  onUpdateNodes: (nodesUpdated: Node[], edgesUpdated: Edge[]) => void;
  children: ReactNode;
}) => {
  const { t } = useTranslation("flow");
  const { emitEvent, socket, connect } = useContext(SocketContext);
  const [currentNodeIdSelected, setCurrentNodeIdSelected] =
    useState<string>("");

  const nodesById = useMemo(() => {
    const map = new Map<string, Node>();
    nodes.forEach((node) => {
      map.set(node.id, node);
    });
    return map;
  }, [nodes]);

  const incomingEdgesByTarget = useMemo(() => {
    const map = new Map<string, Edge[]>();
    edges.forEach((edge) => {
      const key = String(edge.target || "");
      const existing = map.get(key);
      if (existing) {
        existing.push(edge);
      } else {
        map.set(key, [edge]);
      }
    });
    return map;
  }, [edges]);

  const outgoingEdgesBySource = useMemo(() => {
    const map = new Map<string, Edge[]>();
    edges.forEach((edge) => {
      const key = String(edge.source || "");
      const existing = map.get(key);
      if (existing) {
        existing.push(edge);
      } else {
        map.set(key, [edge]);
      }
    });
    return map;
  }, [edges]);

  const edgeByTarget = useMemo(() => {
    const map = new Map<string, Edge>();
    edges.forEach((edge) => {
      if (!map.has(edge.target)) {
        map.set(edge.target, edge);
      }
    });
    return map;
  }, [edges]);

  const runNode = useCallback((name: string) => {
    const nodesSorted = nodesTopologicalSort(nodes, edges);
    // Runtime execution should not include canvas coordinates.
    // Some processors legitimately use fields named `x` / `y` (e.g. ROI),
    // and serializing node positions here can overwrite those values.
    const flowFile = convertFlowToJson(nodesSorted, edges, false, true);

    const nodesInError = getNodeInError(flowFile, nodesSorted, name);

    if (nodesInError.length > 0) {
      let errorMessage = createErrorMessageForMissingFields(nodesInError, t);
      toastErrorMessage(errorMessage);
      return false;
    }

    const event: FlowEvent = {
      name: "run_node",
      data: {
        jsonFile: JSON.stringify(flowFile),
        nodeName: name,
        metadata: metadata,
      },
    };
    void (async () => {
      try {
        await prewarmClientCameraPublishers({
          nodes: nodesSorted,
          socket,
          connect,
        });
      } finally {
        emitEvent(event);
      }
    })();
    return true;
  }, [nodes, edges, t, metadata, socket, connect, emitEvent]);

  const runAllNodes = useCallback(() => {
    if (nodes.length === 0) {
      toastFastInfoMessage(t("NoNodesToRun"));
      return;
    }

    const nodesSorted = nodesTopologicalSort(nodes, edges);
    // Same rationale as runNode(): avoid overwriting processor config fields
    // with canvas coordinates during runtime execution.
    const flowFile = convertFlowToJson(nodesSorted, edges, false, true);

    const nodesInError = getNodeInError(flowFile, nodesSorted);

    if (nodesInError.length > 0) {
      let errorMessage = createErrorMessageForMissingFields(nodesInError, t);
      toastErrorMessage(errorMessage);
      return;
    }

    const event: FlowEvent = {
      name: "process_file",
      data: {
        jsonFile: JSON.stringify(flowFile),
        metadata: metadata,
      },
    };
    void (async () => {
      try {
        await prewarmClientCameraPublishers({
          nodes: nodesSorted,
          socket,
          connect,
        });
      } finally {
        emitEvent(event);
      }
    })();
  }, [nodes, edges, t, metadata, socket, connect, emitEvent]);

  const hasParent = useCallback((id: string) => {
    return !!incomingEdgesByTarget.get(id)?.length;
  }, [incomingEdgesByTarget]);

  const getIncomingEdges = useCallback((id: string) => {
    const found = incomingEdgesByTarget.get(id);
    return found ? [...found] : [];
  }, [incomingEdgesByTarget]);

  const getOutgoingEdges = useCallback((id: string) => {
    const found = outgoingEdgesBySource.get(id);
    return found ? [...found] : [];
  }, [outgoingEdgesBySource]);

  const removeNodeIncomingEdges = (id: string) => {
    const edgesUpdated = edges.filter((edge) => edge.target !== id);
    onUpdateNodes(nodes, edgesUpdated);
  };

  const removeEdgesByIds = (ids: string[]) => {
    const edgesUpdated = edges.filter((edge) => !ids.includes(edge.id));
    onUpdateNodes(nodes, edgesUpdated);
  };

  const overrideConfigForNode = (
    id: string,
    newConfig: NodeConfig,
    newData: NodeData,
  ) => {
    const nodesUpdated = nodes.map((node) => {
      if (node.id === id) {
        const defaultOptions: any = getDefaultOptions(
          newConfig.fields,
          newData,
        );
        console.log(newData);
        node.data = {
          ...newData,
          ...defaultOptions,
          config: {
            ...newConfig,
            isDynamicallyGenerated: false,
          },
        };
      }
      return node;
    });

    const edgesUpdated = edges.filter((edge) => edge.target !== id);
    onUpdateNodes(nodesUpdated, edgesUpdated);
  };

  const getEdgeIndex = useCallback((id: string) => {
    return edgeByTarget.get(id);
  }, [edgeByTarget]);

  const getNodeDimensions = useCallback((id: string) => {
    const node = nodesById.get(id);
    let dimensions: NodeDimensions = { width: undefined, height: undefined };
    if (!!node) {
      dimensions = { width: node.width, height: node.height };
    }

    return dimensions;
  }, [nodesById]);

  const createNodeRef = (nodeId: string) => {
    const nodeToDuplicate = nodes.find((node) => node.id === nodeId);

    if (nodeToDuplicate) {
      const newNodeId = createUniqNodeId(nodeToDuplicate.data.processorType);
      if (nodeToDuplicate.data.nodeRef) {
        nodeId = nodeToDuplicate.data.nodeRef;
      }

      nodeToDuplicate.data.metadata = {
        refList: nodeToDuplicate.data.metadata?.refList
          ? [...nodeToDuplicate.data.metadata.refList, newNodeId]
          : [newNodeId],
      };

      const newNode = {
        ...nodeToDuplicate,
        id: newNodeId,
        selected: false,
        data: {
          ...nodeToDuplicate.data,
          name: newNodeId,
          isDone: false,
          lastRun: undefined,
          nodeRef: nodeId,
        },
        position: {
          x: nodeToDuplicate.position.x + DUPLICATED_NODE_OFFSET,
          y: nodeToDuplicate.position.y + DUPLICATED_NODE_OFFSET,
        },
      };
      const nodesUpdated = [...nodes, newNode];
      const edgesUpdated = [...edges];
      onUpdateNodes(nodesUpdated, edgesUpdated);
    }
  };

  const duplicateNode = (nodeId: string) => {
    const nodeToDuplicate = nodes.find((node) => node.id === nodeId);
    if (nodeToDuplicate) {
      const newNodeId = createUniqNodeId(nodeToDuplicate.data.processorType);

      const deepClone = structuredClone(nodeToDuplicate);
      deepClone.id = newNodeId;
      deepClone.selected = false;
      deepClone.data.name = newNodeId;
      deepClone.data.isDone = false;
      deepClone.data.lastRun = undefined;
      deepClone.position.x += DUPLICATED_NODE_OFFSET;
      deepClone.position.y += DUPLICATED_NODE_OFFSET;

      const nodesUpdated = [...nodes, deepClone];
      const edgesUpdated = [...edges];
      onUpdateNodes(nodesUpdated, edgesUpdated);
    }
  };

  const clearNodeOutput = (nodeId: string) => {
    const nodeToUpdate = nodes.find((node) => node.id === nodeId);
    if (nodeToUpdate) {
      const outputClearedAt = Date.now();
      const outputStreamIds = extractStreamIdsFromValue(nodeToUpdate.data?.outputData);
      const configStreamIds = extractStreamIdsFromValue(nodeToUpdate.data?.stream_ref);
      const streamIds = [...new Set([...outputStreamIds, ...configStreamIds])];
      const isCameraNode = isLikelyCameraNode(nodeToUpdate);

      // Clearing output should actively stop running streams instead of waiting
      // for browser refresh/idle timeout.
      void (async () => {
        const clientSessionId = socket?.getId();
        if (isCameraNode) {
          stopClientCameraPublisherByIndex(nodeToUpdate.data?.camera_index, socket);
        }
        await stopStreamsByOwner(nodeToUpdate.data?.name);
        const streamStopResults = await Promise.all(
          streamIds.map((streamId) => stopStream(streamId)),
        );
        const anyByIdStopped = streamStopResults.some(Boolean);
        const byCameraIndexStopped = isCameraNode
          ? await stopCameraStreamsByIndex(
              nodeToUpdate.data?.camera_index,
              clientSessionId,
            )
          : false;

        // Only use the global camera stop as a fallback.
        // Stopping everything on every clear/remove makes webcam usage feel
        // "flaky" (stop/start loops) when the UI re-runs nodes.
        if (isCameraNode && !byCameraIndexStopped && !anyByIdStopped) {
          await stopAllCameraStreams(clientSessionId);
        }
      })();

      const nodesUpdated = nodes.map((node) => {
        if (node.id === nodeId) {
          return {
            ...node,
            data: {
              ...node.data,
              outputData: undefined,
              lastRun: undefined,
              isDone: false,
              outputClearedAt,
            },
          };
        }
        return node;
      });
      onUpdateNodes(nodesUpdated, edges);
    }
  };

  function clearAllOutput() {
    const outputClearedAt = Date.now();
    // Stop any running streams (camera + transforms) so devices/resources aren't left active
    // when users clear outputs or reset the canvas.
    void (async () => {
      const clientSessionId = socket?.getId();
      stopAllClientCameraPublishers(socket);
      await Promise.all(nodes.map((node) => stopStreamsByOwner(node.data?.name)));

      await Promise.all(
        nodes.map(async (node) => {
          const outputStreamIds = extractStreamIdsFromValue(node.data?.outputData);
          const configStreamIds = extractStreamIdsFromValue(node.data?.stream_ref);
          const streamIds = [...new Set([...outputStreamIds, ...configStreamIds])];
          await Promise.all(streamIds.map((sid) => stopStream(sid)));
        }),
      );

      // Safety-net: ensure webcam is fully released, even if tracking failed.
      // If no camera streams are active, this is a cheap no-op on the backend.
      await stopAllCameraStreams(clientSessionId);
    })();

    const nodesCleared = nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        outputData: undefined,
        lastRun: undefined,
        isDone: false,
        outputClearedAt,
      },
    }));
    onUpdateNodes(nodesCleared, edges);
  }
  const removeNode = (nodeId: string) => {
    const nodeToRemove = nodes.find((node) => node.id === nodeId);
    if (nodeToRemove) {
      const outputStreamIds = extractStreamIdsFromValue(nodeToRemove.data?.outputData);
      const configStreamIds = extractStreamIdsFromValue(nodeToRemove.data?.stream_ref);
      const streamIds = [...new Set([...outputStreamIds, ...configStreamIds])];
      const isCameraNode = isLikelyCameraNode(nodeToRemove);

      // Fire-and-forget cleanup so UI deletion stays responsive.
      void (async () => {
        const clientSessionId = socket?.getId();
        if (isCameraNode) {
          stopClientCameraPublisherByIndex(nodeToRemove.data?.camera_index, socket);
        }
        // Always try owner-based stop (covers transform streams owned by the node).
        await stopStreamsByOwner(nodeToRemove.data?.name);

        // Also stop by explicit stream IDs when available.
        const streamStopResults = await Promise.all(
          streamIds.map((streamId) => stopStream(streamId)),
        );
        const anyByIdStopped = streamStopResults.some(Boolean);
        const byCameraIndexStopped = isCameraNode
          ? await stopCameraStreamsByIndex(
              nodeToRemove.data?.camera_index,
              clientSessionId,
            )
          : false;

        // For camera nodes, use the global stop as a safety-net to ensure the webcam is released.
        // Only use the global camera stop as a fallback.
        if (isCameraNode && !byCameraIndexStopped && !anyByIdStopped) {
          await stopAllCameraStreams(clientSessionId);
        }
      })();
    }

    const nodesUpdated = nodes.filter((node) => node.id !== nodeId);
    const edgesUpdated = edges.filter(
      (edge) => edge.source !== nodeId && edge.target !== nodeId,
    );
    onUpdateNodes(nodesUpdated, edgesUpdated);
  };

  const removeAll = () => {
    void (async () => {
      const clientSessionId = socket?.getId();
      stopAllClientCameraPublishers(socket);
      await Promise.all(nodes.map((node) => stopStreamsByOwner(node.data?.name)));

      await Promise.all(
        nodes.map(async (node) => {
          const outputStreamIds = extractStreamIdsFromValue(node.data?.outputData);
          const configStreamIds = extractStreamIdsFromValue(node.data?.stream_ref);
          const streamIds = [...new Set([...outputStreamIds, ...configStreamIds])];
          await Promise.all(streamIds.map((streamId) => stopStream(streamId)));
        }),
      );

      await stopAllCameraStreams(clientSessionId);
    })();
    onUpdateNodes([], []);
  };

  const findNode = useCallback((nodeId: string) => {
    return nodesById.get(nodeId);
  }, [nodesById]);

  const updateNodeAppearance = (nodeId: string, appearance: NodeAppearance) => {
    const nodeToUpdate = nodes.find((node) => node.id === nodeId);
    if (nodeToUpdate) {
      const nodesUpdated = nodes.map((node) => {
        if (node.id === nodeId) {
          return {
            ...node,
            data: {
              ...node.data,
              appearance: {
                ...node.data.appearance,
                ...appearance,
              },
            },
          };
        }
        return node;
      });
      onUpdateNodes(nodesUpdated, edges);
    }
  };

  const nodeRuntimeValue = useMemo(
    () => ({
      isRunning,
      currentNodesRunning,
      errorCount,
    }),
    [isRunning, currentNodesRunning, errorCount],
  );

  const nodeContextValue = useMemo(
    () => ({
      runNode,
      runAllNodes,
      hasParent,
      getIncomingEdges,
      getOutgoingEdges,
      removeNodeIncomingEdges,
      removeEdgesByIds,
      getEdgeIndex,
      showOnlyOutput,
      onUpdateNodeData,
      onUpdateNodes,
      getNodeDimensions,
      duplicateNode,
      createNodeRef,
      clearNodeOutput,
      clearAllOutput,
      updateNodeAppearance,
      overrideConfigForNode,
      removeNode,
      removeAll,
      findNode,
      currentNodeIdSelected,
      setCurrentNodeIdSelected,
    }),
    [
      runNode,
      runAllNodes,
      hasParent,
      getIncomingEdges,
      getOutgoingEdges,
      removeNodeIncomingEdges,
      removeEdgesByIds,
      getEdgeIndex,
      showOnlyOutput,
      onUpdateNodeData,
      onUpdateNodes,
      getNodeDimensions,
      duplicateNode,
      createNodeRef,
      clearNodeOutput,
      clearAllOutput,
      updateNodeAppearance,
      overrideConfigForNode,
      removeNode,
      removeAll,
      findNode,
      currentNodeIdSelected,
      setCurrentNodeIdSelected,
    ],
  );

  return (
    <NodeRuntimeContext.Provider value={nodeRuntimeValue}>
      <NodeContext.Provider value={nodeContextValue}>
        {children}
      </NodeContext.Provider>
    </NodeRuntimeContext.Provider>
  );
};
