import {
  ReactNode,
  createContext,
  useCallback,
  useEffect,
  useContext,
  useMemo,
  useRef,
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
  runNodeIfIdle: (nodeName: string) => boolean;
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
  runNodeIfIdle: () => false,
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
  runEndAt,
  busyRejectEntry,
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
  /** Incremented by Flow.tsx every time a run_end socket event arrives.
   *  Used as a secondary flush trigger so that the queue is drained even
   *  when hasActiveRun stays false throughout a fast run (React 18 batching). */
  runEndAt: number;
  /** Set by Flow.tsx when the backend rejects a run_node with run_in_progress.
   *  NodeProvider re-enqueues the rejected node at the front of the queue. */
  busyRejectEntry?: { name: string; at: number } | null;
  children: ReactNode;
}) => {
  const { t } = useTranslation("flow");
  const { emitEvent, socket, connect, getSocket } = useContext(SocketContext);
  const [currentNodeIdSelected, setCurrentNodeIdSelected] =
    useState<string>("");
  const runRequestedRef = useRef(false);
  // Queue-based pending run: replaces the old single-slot pendingRunNodeRef/pendingRunAllRef.
  // A single ref slot silently dropped requests when busy — multiple clicks only preserved
  // the last one. The queue ensures each enqueued request survives until execution.
  type PendingRunEntry = { type: "node"; name: string } | { type: "all" };
  const pendingRunQueueRef = useRef<PendingRunEntry[]>([]);
  const MAX_PENDING_QUEUE = 8;
  const lastBusyToastAtRef = useRef(0);

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

  const hasActiveRun = isRunning || currentNodesRunning.length > 0;

  const isRunBusy = useCallback(() => {
    return runRequestedRef.current || hasActiveRun;
  }, [hasActiveRun]);

  const notifyBusyRunQueued = useCallback(() => {
    const now = Date.now();
    if (now - lastBusyToastAtRef.current < 1200) {
      return;
    }
    lastBusyToastAtRef.current = now;
    toastFastInfoMessage("Flow masih berjalan. Perubahan akan dijalankan setelah selesai.");
  }, []);

  const enqueuePendingRunNode = useCallback((name: string) => {
    const queue = pendingRunQueueRef.current;
    // Dedup: skip if this exact node is already the last entry waiting.
    const last = queue[queue.length - 1];
    if (last?.type === "node" && last.name === name) {
      console.debug(`[NodeQueue] skip dup node=${name} queue_len=${queue.length}`);
      return;
    }
    if (queue.length >= MAX_PENDING_QUEUE) {
      const dropped = queue.shift();
      console.debug(`[NodeQueue] queue full, dropped=${JSON.stringify(dropped)}`);
    }
    queue.push({ type: "node", name });
    console.debug(`[NodeQueue] enqueue node=${name} queue_len=${queue.length}`);
  }, []);

  const enqueuePendingRunAll = useCallback(() => {
    // run-all supersedes all pending node runs — collapse the queue to a single entry.
    pendingRunQueueRef.current = [{ type: "all" }];
    console.debug("[NodeQueue] enqueue run-all (queue superseded)");
  }, []);

  const startRunNode = useCallback((name: string): boolean => {
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
    runRequestedRef.current = true;
    void (async () => {
      try {
        const activeSocket = getSocket();
        await prewarmClientCameraPublishers({
          nodes: nodesSorted,
          socket: activeSocket,
          connect,
        });
      } finally {
        const emitted = emitEvent(event);
        if (!emitted) {
          runRequestedRef.current = false;
          toastErrorMessage("Socket belum terhubung. Jalankan ulang setelah tersambung.");
        }
      }
    })();
    return true;
  }, [
    nodes,
    edges,
    t,
    metadata,
    connect,
    getSocket,
    emitEvent,
  ]);

  const startRunAllNodes = useCallback(() => {
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
    runRequestedRef.current = true;
    void (async () => {
      try {
        const activeSocket = getSocket();
        await prewarmClientCameraPublishers({
          nodes: nodesSorted,
          socket: activeSocket,
          connect,
        });
      } finally {
        const emitted = emitEvent(event);
        if (!emitted) {
          runRequestedRef.current = false;
          toastErrorMessage("Socket belum terhubung. Jalankan ulang setelah tersambung.");
        }
      }
    })();
  }, [
    nodes,
    edges,
    t,
    metadata,
    connect,
    getSocket,
    emitEvent,
  ]);

  const runNodeIfIdle = useCallback((name: string) => {
    if (isRunBusy()) {
      return false;
    }
    return startRunNode(name);
  }, [isRunBusy, startRunNode]);

  // Stable function refs for the flush effect.
  // The effect depends ONLY on hasActiveRun (the gate condition). Putting
  // startRunNode / startRunAllNodes in the deps causes the effect to re-fire
  // every time nodes/edges update (those fns re-create on every node state
  // change). That re-fire prematurely resets runRequestedRef.current = false
  // while a request is still in-flight, breaking the busy-slot guard and
  // allowing a second overlapping request to reach the backend.
  const startRunNodeRef = useRef<(name: string) => boolean>(() => false);
  const startRunAllNodesRef = useRef<() => void>(() => {});
  useEffect(() => { startRunNodeRef.current = startRunNode; }, [startRunNode]);
  useEffect(() => { startRunAllNodesRef.current = startRunAllNodes; }, [startRunAllNodes]);

  // Busy-reject reschedule: when the backend rejects a run_node with run_in_progress,
  // Flow.tsx sets busyRejectEntry. We re-enqueue the node at the front of the queue and
  // clear runRequestedRef so the flush effect (below) can dispatch it.
  // IMPORTANT: this effect MUST be defined BEFORE the flush effect so that React runs
  // them in this order within the same render — re-enqueue first, then dequeue+run.
  useEffect(() => {
    if (!busyRejectEntry?.name) return;
    const name = busyRejectEntry.name;
    const queue = pendingRunQueueRef.current;
    const alreadyQueued = queue.some(
      (e) => e.type === "node" && e.name === name,
    );
    if (!alreadyQueued) {
      queue.unshift({ type: "node", name });
      console.debug(
        `[NodeQueue] busy-reject re-enqueue node=${name} at front queue_len=${queue.length}`,
      );
    } else {
      console.debug(`[NodeQueue] busy-reject skip dup node=${name} (already queued)`);
    }
    // The request was rejected — it never ran. Clear the in-flight marker so
    // isRunBusy() can gate the next request correctly.
    runRequestedRef.current = false;
  }, [busyRejectEntry]);

  // Queue flush effect.
  //
  // Triggers on TWO conditions (deps: hasActiveRun + runEndAt):
  //
  // 1. hasActiveRun transitions true→false: normal idle-after-run path.
  //
  // 2. runEndAt increments (on every run_end socket event): covers the React 18
  //    auto-batching race where current_node_running and on_progress(isDone=true)
  //    arrive close enough to be batched into a single render — net result is
  //    currentNodesRunning stays [], hasActiveRun stays false, and the effect
  //    dep never changes. Depending on runEndAt ensures flush fires even then.
  //
  // Only one item is dequeued per firing — the next run will trigger its own
  // idle→busy→idle (or run_end) cycle for subsequent queue entries.
  useEffect(() => {
    if (hasActiveRun) {
      console.debug(
        `[NodeQueue] flush skipped — still busy queue_len=${pendingRunQueueRef.current.length}`,
      );
      return;
    }

    // System is idle. Clear the in-flight flag and dequeue the next pending run.
    runRequestedRef.current = false;

    const queue = pendingRunQueueRef.current;
    if (queue.length === 0) return;

    const next = queue.shift();
    if (!next) return;

    console.debug(
      `[NodeQueue] flush type=${next.type}${next.type === "node" ? ` name=${next.name}` : ""} remaining=${queue.length} trigger=runEndAt:${runEndAt}/hasActiveRun:${hasActiveRun}`,
    );

    if (next.type === "all") {
      startRunAllNodesRef.current();
    } else {
      startRunNodeRef.current(next.name);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActiveRun, runEndAt]); // runEndAt: secondary flush trigger for React 18 batching race

  const runNode = useCallback((name: string) => {
    if (isRunBusy()) {
      enqueuePendingRunNode(name);
      if (hasActiveRun) {
        notifyBusyRunQueued();
      }
      return false;
    }
    return startRunNode(name);
  }, [
    isRunBusy,
    hasActiveRun,
    enqueuePendingRunNode,
    notifyBusyRunQueued,
    startRunNode,
  ]);

  const runAllNodes = useCallback(() => {
    if (isRunBusy()) {
      enqueuePendingRunAll();
      if (hasActiveRun) {
        notifyBusyRunQueued();
      }
      return;
    }
    startRunAllNodes();
  }, [
    isRunBusy,
    hasActiveRun,
    enqueuePendingRunAll,
    notifyBusyRunQueued,
    startRunAllNodes,
  ]);

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
      runNodeIfIdle,
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
      runNodeIfIdle,
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
