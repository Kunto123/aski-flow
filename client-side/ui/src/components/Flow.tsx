import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useImperativeHandle,
  Ref,
  forwardRef,
  useContext,
} from "react";
import {
  Node,
  Edge,
  OnNodesChange,
  OnNodesDelete,
  OnEdgesChange,
  OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Connection,
  ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import SideBar from "./bars/Sidebar";
import { NodeProvider } from "../providers/NodeProvider";
import { MiniMapStyled, ReactFlowStyled } from "./nodes/Node.styles";
import UserMessagePopup, {
  MessageType,
  UserMessage,
} from "./popups/UserMessagePopup";
import { getAllNodeWithEaseOut } from "../utils/mappings";
import { useDrop } from "react-dnd";
import { useSocketListeners } from "../hooks/useFlowSocketListeners";
import ButtonEdge from "./edges/buttonEdge";
import { createNewNode } from "../utils/nodeUtils";
import {
  FlowOnCurrentNodeRunningEventData,
  FlowOnErrorEventData,
  FlowOnProgressEventData,
} from "../sockets/flowEventTypes";
import { useVisibility } from "../providers/VisibilityProvider";
import { FlowMetadata } from "../layout/main-layout/AppLayout";
import { SocketContext } from "../providers/SocketProvider";
import {
  stopAllCameraStreams,
  stopCameraStreamsByIndex,
  stopStream,
  stopStreamsByOwner,
} from "../api/stream";
import {
  stopClientCameraPublisherByIndex,
  stopAllClientCameraPublishers,
} from "../services/clientCameraPublishers";

// ~15 FPS cap for intermediate stream preview updates (final completion is not throttled)
const STREAM_PROGRESS_UI_MIN_INTERVAL_MS = 66;

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

export interface FlowProps {
  nodes: Node[];
  edges: Edge[];
  metadata: FlowMetadata;
  onFlowChange: (nodes: Node[], edges: Edge[], metadata: FlowMetadata) => void;
  onUpdateMetadata?: (metadata: FlowMetadata) => void;
  showOnlyOutput?: boolean;
  isRunning: boolean;
  onRunChange: (isRunning: boolean) => void;
  onLoaded: () => void;
}

const Flow = forwardRef((props: FlowProps, ref) => {
  const reactFlowWrapper = useRef(null);

  function getAllEdgeTypes() {
    return { buttonedge: ButtonEdge };
  }
  const nodeTypes = useMemo(() => getAllNodeWithEaseOut(), []);
  const edgeTypes = useMemo(() => getAllEdgeTypes(), []);

  const [reactFlowInstance, setReactFlowInstance] = useState<
    ReactFlowInstance | undefined
  >(undefined);
  const [nodes, setNodes] = useState<Node[]>(props.nodes);
  const [edges, setEdges] = useState<Edge[]>(props.edges);

  const [isPopupOpen, setIsPopupOpen] = useState<boolean>(false);
  const [currentUserMessage, setCurrentUserMessage] = useState<UserMessage>({
    content: "",
  });
  const [currentNodesRunning, setCurrentNodesRunning] = useState<string[]>([]);
  const [errorCount, setErrorCount] = useState<number>(0);
  const streamProgressLastCommitAtRef = useRef<Map<string, number>>(new Map());
  const streamProgressPendingTimersRef = useRef<Map<string, number>>(new Map());
  const streamProgressPendingDataRef =
    useRef<Map<string, FlowOnProgressEventData>>(new Map());
  const skipNextOnFlowChangeRef = useRef(false);

  const { getElement } = useVisibility();
  const { socket } = useContext(SocketContext);
  const minimap = getElement("minimap");

  useEffect(() => {
    const areNodesRunning = currentNodesRunning.length > 0;
    if (props.isRunning !== areNodesRunning) {
      props.onRunChange(areNodesRunning);
    }
  }, [currentNodesRunning, props.isRunning, props.onRunChange]);

  const clearPendingProgressTimer = useCallback((nodeName?: string) => {
    if (!nodeName) return;
    const timerId = streamProgressPendingTimersRef.current.get(nodeName);
    if (timerId == null) return;
    window.clearTimeout(timerId);
    streamProgressPendingTimersRef.current.delete(nodeName);
  }, []);

  const applyProgressToNodes = useCallback((data: FlowOnProgressEventData) => {
    const nodeToUpdate = data.instanceName;
    const output = data.output;
    const isDone = data.isDone ?? true;
    if (!nodeToUpdate) return;

    if (isDone) {
      setCurrentNodesRunning((previous) => {
        return previous.filter((node) => node != nodeToUpdate);
      });
    }

    streamProgressLastCommitAtRef.current.set(nodeToUpdate, Date.now());
    if (!isDone) {
      // Intermediate stream updates are transient UI state; avoid syncing the full
      // flow model to parent storage on every frame.
      skipNextOnFlowChangeRef.current = true;
    }

    setNodes((prevNodes) => {
      const index = prevNodes.findIndex((node) => node.data.name == nodeToUpdate);
      if (index < 0) return prevNodes;

      const prevNode = prevNodes[index];
      const nextLastRun = isDone ? new Date() : prevNode.data.lastRun;
      const nextData = {
        ...prevNode.data,
        outputData: output,
        lastRun: nextLastRun,
        isDone,
      };

      const nextNodes = [...prevNodes];
      nextNodes[index] = {
        ...prevNode,
        data: nextData,
      };
      return nextNodes;
    });
  }, []);

  const [{ isOver }, dropRef] = useDrop({
    accept: "NODE",
    drop: (item, monitor) => {
      onDrop(item, monitor);
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  });

  const onInit = (reactFlowInstance: ReactFlowInstance) => {
    setReactFlowInstance(reactFlowInstance);
  };

  const addNode = (type: string, data?: any) => {
    const reactFlowBounds = (
      reactFlowWrapper.current as any
    ).getBoundingClientRect();

    const additionnalData = data?.additionnalData;
    const additionnalConfig = data?.additionnalConfig;

    if (typeof type === "undefined" || !type) {
      return;
    }

    const position = (reactFlowInstance as any).project({
      x: reactFlowBounds.width / 2 - 100,
      y: reactFlowBounds.height / 2 - 100,
    });

    const newNode = createNewNode(
      type,
      position,
      additionnalData,
      additionnalConfig,
    );

    setNodes((nds) => nds.concat(newNode));
  };

  useImperativeHandle(ref, () => ({
    addNode,
  }));

  // NOTE:
  // We intentionally do NOT force-stop camera streams on component unmount.
  // A browser refresh briefly unmounts the React tree and would otherwise cause
  // the webcam to repeatedly stop/start ("mati/nyala" loop) on Windows.
  // Stream lifetimes are managed by:
  // - explicit node removal / clear output actions
  // - backend idle reaper (ASKI_CAMERA_IDLE_TIMEOUT_SEC)

  const onProgress = useCallback((data: FlowOnProgressEventData) => {
    const nodeToUpdate = data.instanceName;
    const isDone = data.isDone ?? true;
    if (!nodeToUpdate) return;

    if (isDone) {
      streamProgressPendingDataRef.current.delete(nodeToUpdate);
      clearPendingProgressTimer(nodeToUpdate);
      applyProgressToNodes(data);
      return;
    }

    const now = Date.now();
    const lastCommittedAt = streamProgressLastCommitAtRef.current.get(nodeToUpdate) ?? 0;
    const elapsedMs = now - lastCommittedAt;
    if (elapsedMs >= STREAM_PROGRESS_UI_MIN_INTERVAL_MS) {
      streamProgressPendingDataRef.current.delete(nodeToUpdate);
      clearPendingProgressTimer(nodeToUpdate);
      applyProgressToNodes(data);
      return;
    }

    streamProgressPendingDataRef.current.set(nodeToUpdate, data);
    if (streamProgressPendingTimersRef.current.has(nodeToUpdate)) {
      return;
    }

    const waitMs = Math.max(0, STREAM_PROGRESS_UI_MIN_INTERVAL_MS - elapsedMs);
    const timerId = window.setTimeout(() => {
      streamProgressPendingTimersRef.current.delete(nodeToUpdate);
      const latest = streamProgressPendingDataRef.current.get(nodeToUpdate);
      if (!latest) return;
      streamProgressPendingDataRef.current.delete(nodeToUpdate);
      applyProgressToNodes(latest);
    }, waitMs);
    streamProgressPendingTimersRef.current.set(nodeToUpdate, timerId);
  }, [applyProgressToNodes, clearPendingProgressTimer]);

  const onError = useCallback((data: FlowOnErrorEventData) => {
    streamProgressPendingDataRef.current.delete(data.instanceName);
    clearPendingProgressTimer(data.instanceName);
    setCurrentNodesRunning((previous) => {
      return previous.filter((node) => node != data.instanceName);
    });

    // Mark node as done so the UI doesn't keep spinning forever on errors.
    if (data.instanceName) {
      setNodes((prevNodes) => {
        return [
          ...prevNodes.map((node: Node) => {
            if (node.data.name == data.instanceName) {
              node.data = {
                ...node.data,
                outputData: `ERROR: ${data.error}`,
                lastRun: new Date(),
                isDone: true,
              };
            }
            return node;
          }),
        ];
      });
    }

    setCurrentUserMessage({
      content: data.error,
      nodeId: data.instanceName ?? data.nodeName,
      type: MessageType.Error,
    });
    setErrorCount((prevErrorCount) => prevErrorCount + 1);
    setIsPopupOpen(true);
  }, [clearPendingProgressTimer]);

  const onCurrentNodeRunning = useCallback((data: FlowOnCurrentNodeRunningEventData) => {
    setCurrentNodesRunning((previous) => {
      if (!data.instanceName) return previous;
      return previous.includes(data.instanceName)
        ? previous
        : [...previous, data.instanceName];
    });
  }, []);

  useSocketListeners<
    FlowOnProgressEventData,
    FlowOnErrorEventData,
    FlowOnProgressEventData
  >(
    onProgress,
    onError,
    () => {
      // Safety: if a run completes without per-node completion flags,
      // ensure the UI can re-run nodes without requiring a refresh.
      setCurrentNodesRunning([]);
    },
    onCurrentNodeRunning,
    () => {
      // Socket drops (e.g. WinError 10054 on server side) can leave node
      // running indicators stuck because final events never arrive.
      for (const timerId of streamProgressPendingTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      streamProgressPendingTimersRef.current.clear();
      streamProgressPendingDataRef.current.clear();
      stopAllClientCameraPublishers();
      setCurrentNodesRunning([]);
    },
    () => {
      setCurrentNodesRunning([]);
    },
  );

  useEffect(() => {
    if (props.onFlowChange) {
      if (skipNextOnFlowChangeRef.current) {
        skipNextOnFlowChangeRef.current = false;
        return;
      }
      props.onFlowChange(nodes, edges, props.metadata);
    }
  }, [nodes, edges, props.metadata, props.onFlowChange]);

  useEffect(() => {
    return () => {
      for (const timerId of streamProgressPendingTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      streamProgressPendingTimersRef.current.clear();
      streamProgressPendingDataRef.current.clear();
      streamProgressLastCommitAtRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!reactFlowInstance || !reactFlowWrapper.current) {
      return;
    }

    const fitToViewport = () => {
      reactFlowInstance.fitView({
        padding: 0.2,
        duration: 220,
        maxZoom: 1.15,
      });
    };

    const rafId = requestAnimationFrame(fitToViewport);
    const resizeObserver = new ResizeObserver(() => {
      fitToViewport();
    });
    resizeObserver.observe(reactFlowWrapper.current as Element);
    window.addEventListener("resize", fitToViewport);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", fitToViewport);
    };
  }, [reactFlowInstance]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [setNodes],
  );

  const onNodesDelete: OnNodesDelete = useCallback((removedNodes) => {
    if (!removedNodes?.length) return;
    void (async () => {
      const clientSessionId = socket?.getId();
      await Promise.all(
        removedNodes.map(async (node) => {
          const outputStreamIds = extractStreamIdsFromValue(node.data?.outputData);
          const configStreamIds = extractStreamIdsFromValue(node.data?.stream_ref);
          const streamIds = [...new Set([...outputStreamIds, ...configStreamIds])];
          const isCameraNode = isLikelyCameraNode(node);

          if (isCameraNode) {
            stopClientCameraPublisherByIndex(node.data?.camera_index, socket);
          }
          await stopStreamsByOwner(node.data?.name);
          const streamStopResults = await Promise.all(
            streamIds.map((streamId) => stopStream(streamId)),
          );
          const anyByIdStopped = streamStopResults.some(Boolean);
          const byCameraIndexStopped = isCameraNode
            ? await stopCameraStreamsByIndex(
                node.data?.camera_index,
                clientSessionId,
              )
            : false;

          if (isCameraNode && !byCameraIndexStopped && !anyByIdStopped) {
            await stopAllCameraStreams(clientSessionId);
          }
        }),
      );
    })();
  }, [socket]);
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [setEdges],
  );

  const onConnect: OnConnect = useCallback(
    (connection) =>
      setEdges((eds) => {
        if (
          isHandleAlreadyTargeted(connection, eds) ||
          isSameNodeTargeted(connection)
        ) {
          return eds;
        }
        return addEdge(
          {
            ...connection,
            type: "buttonedge",
            markerEnd: "arrowClosed",
          },
          eds,
        );
      }),
    [setEdges],
  );

  const onDragOver = useCallback((event: any) => {
    event.preventDefault();
    if (!!event.dataTransfert) {
      event.dataTransfer.dropEffect = "move";
    }
  }, []);

  const onDrop = useCallback(
    (item: any, monitor?: any) => {
      if (
        !!reactFlowWrapper &&
        !!reactFlowInstance &&
        !!reactFlowWrapper.current
      ) {
        const reactFlowBounds = (
          reactFlowWrapper.current as any
        ).getBoundingClientRect();
        const type = item.nodeType;
        const additionnalData = item.additionnalData;
        const additionnalConfig = item.additionnalConfig;

        // check if the dropped element is valid
        if (typeof type === "undefined" || !type) {
          return;
        }

        const { x, y } = monitor.getClientOffset();

        const position = (reactFlowInstance as any).project({
          x: x - reactFlowBounds.left,
          y: y - reactFlowBounds.top,
        });

        const newNode = createNewNode(
          type,
          position,
          additionnalData,
          additionnalConfig,
        );
        setNodes((nds) => nds.concat(newNode));
      }
    },
    [reactFlowInstance],
  );

  const isHandleAlreadyTargeted = (connection: Connection, eds: Edge[]) => {
    if (
      eds.filter(
        (edge) =>
          edge.targetHandle === connection.targetHandle &&
          edge.target === connection.target,
      ).length > 0
    ) {
      return true;
    }
    return false;
  };

  const isSameNodeTargeted = (connection: Connection) => {
    if (connection.source === connection.target) {
      return true;
    }
    return false;
  };

  const handlePopupClose = useCallback(() => {
    setIsPopupOpen(false);
  }, []);

  const handleChangeFlow = useCallback((nodes: Node[], edges: Edge[]): void => {
    setNodes(nodes);
    setEdges(edges);
  }, []);

  const handleUpdateNodeData = useCallback((nodeId: string, data: any) => {
    const updatedNodes = nodes.map((node) => {
      if (node.id === nodeId) {
        return { ...node, data };
      }
      return node;
    });
    setNodes(updatedNodes);
  }, [nodes]);

  const handleUpdateNodes = useCallback((updatedNodes: Node[], updatesEdges: Edge[]) => {
    setNodes(updatedNodes);
    setEdges(updatesEdges);
  }, []);

  return (
    <NodeProvider
      nodes={nodes}
      edges={edges}
      metadata={props.metadata}
      showOnlyOutput={props.showOnlyOutput}
      isRunning={props.isRunning}
      currentNodesRunning={currentNodesRunning}
      errorCount={errorCount}
      onUpdateNodeData={handleUpdateNodeData}
      onUpdateNodes={handleUpdateNodes}
    >
      <div className="h-full w-full" ref={dropRef}>
        <div className="reactflow-wrap reactflow-wrapper h-full w-full" ref={reactFlowWrapper}>
          <ReactFlowStyled
            nodes={nodes}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodesDelete={onNodesDelete}
            edges={edges}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onTouchEnd={onDragOver}
            onInit={onInit}
            fitView
            fitViewOptions={{
              maxZoom: 0.5,
            }}
            minZoom={0.2}
            maxZoom={1.5}
            onLoad={props.onLoaded}
          >
            {minimap.isVisible && (
              <MiniMapStyled
                style={{
                  right: "clamp(10px, 1.6vw, 24px)",
                  bottom: "clamp(10px, 1.6vw, 24px)",
                }}
              />
            )}
          </ReactFlowStyled>
        </div>
        <SideBar nodes={nodes} edges={edges} onChangeFlow={handleChangeFlow} />
        <UserMessagePopup
          isOpen={isPopupOpen}
          onClose={handlePopupClose}
          message={currentUserMessage}
        />
      </div>
    </NodeProvider>
  );
});

export default Flow;
