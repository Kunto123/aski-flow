import { useCallback, useContext, useEffect, useRef, useState } from "react";
import Flow from "../../components/Flow";
import { Node, Edge } from "reactflow";
import { useTranslation } from "react-i18next";
import { FaPlus } from "react-icons/fa";
import { useAuth } from "../../providers/AuthProvider";
import PermissionsManager from "../../components/auth/PermissionsManager";
import {
  convertJsonToFlow,
  convertFlowToJson,
  nodesTopologicalSort,
  shiftNodesIntoViewport,
  stripRuntimeStateFromNodes,
  syncNodeConfigs,
} from "../../utils/flowUtils";
import {
  toastErrorMessage,
  toastFastInfoMessage,
  toastInfoMessage,
} from "../../utils/toastUtils";
import ButtonRunAll from "../../components/buttons/ButtonRunAll";
import { FlowEvent, SocketContext } from "../../providers/SocketProvider";
import FlowWrapper from "./wrapper/FlowWrapper";
import TabHeader, { TopWorkspaceTab } from "./header/TabHeader";
import {
  createErrorMessageForMissingFields,
  getNodeInError,
} from "../../utils/flowChecker";
import { useVisibility } from "../../providers/VisibilityProvider";
import { FlowDataProvider } from "../../providers/FlowDataProvider";
import {
  getCurrentTabIndex,
  saveCurrentTabIndex,
  saveTabsLocally,
} from "../../services/tabStorage";
import { useLoading } from "../../hooks/useLoading";
import DnDSidebar from "../../components/bars/dnd-sidebar/DnDSidebar";
import Tab from "./header/Tab";
import {
  prewarmClientCameraPublishers,
  stopAllClientCameraPublishers,
  stopClientCameraPublisherByIndex,
} from "../../services/clientCameraPublishers";
import {
  stopAllCameraStreams,
  stopCameraStreamsByIndex,
  stopStream,
  stopStreamsByOwner,
} from "../../api/stream";
import {
  WorkstationMain,
  WorkstationSection,
  WorkstationSidebar,
} from "./workstation/WorkstationDummy";
import {
  FlowTemplateDetail,
  FlowTemplatePolicy,
  FlowTemplateSummary,
  getFlowTemplate,
  listFlowTemplates,
} from "../../api/templates";
import { getActiveDeployment, TemplateDeployment } from "../../api/qc";
import TemplatePickerPanel from "../../components/templates/TemplatePickerPanel";
import TemplateSaveModal from "../../components/templates/TemplateSaveModal";
import TemplateManagerPanel from "../../components/templates/TemplateManagerPanel";
import { TemplateModeProvider } from "../../providers/TemplateModeProvider";

export interface FlowTab {
  nodes: Node[];
  edges: Edge[];
  metadata?: FlowMetadata;
}

export interface FlowMetadata {
  id?: string;
  name?: string;
  saveFlow?: boolean;
  version?: string;
  hostUrl?: string;
  lastSave?: number;
  isPublic?: boolean;
  templateId?: number;
  templateVersionId?: number;
  templateName?: string;
  templatePolicy?: FlowTemplatePolicy;
}

export interface FlowManagerState {
  tabs: FlowTab[];
}

export interface FlowTabsProps {
  tabs: FlowTab[];
}

export type ApplicationMode = "flow";
export type ApplicationMenu = "template" | "config" | "help";

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

function createEmptyFlowTab(): FlowTab {
  return {
    nodes: [],
    edges: [],
    metadata: { version: "1.0.0" },
  };
}

function alignTemplateNodesForViewport(nodes: Node[]): Node[] {
  if (nodes.length === 0) {
    return [];
  }

  const normalizedNodes = stripRuntimeStateFromNodes(nodes).map((node) => {
    const resolvedX = Number(node.position?.x);
    const resolvedY = Number(node.position?.y);
    return {
      ...node,
      position: {
        x: Number.isFinite(resolvedX) ? resolvedX : 0,
        y: Number.isFinite(resolvedY) ? resolvedY : 0,
      },
    };
  });

  // Template admin bisa tersimpan jauh ke kiri/atas maupun kanan/bawah.
  // Saat operator memuat template, selalu geser graph ke area viewport awal
  // agar node tetap terlihat walaupun fitView terlambat atau belum sempat berjalan.
  return shiftNodesIntoViewport(normalizedNodes, 96, 72);
}

const FlowTabs = ({ tabs }: FlowTabsProps) => {
  const { t } = useTranslation("flow");

  const [flowTabs, setFlowTabs] = useState<FlowManagerState>({
    tabs: tabs.length > 0 ? tabs : [createEmptyFlowTab()],
  });
  const [currentTab, setCurrentTab] = useState(0);
  // Counter instead of boolean: two setRefreshKey calls in the same React 18 batch
  // always net-increment, whereas boolean toggles would cancel each other out and
  // leave the Flow key unchanged (blank canvas on template reload).
  const [refreshKey, setRefreshKey] = useState(0);
  const [showOnlyOutput, setShowOnlyOutput] = useState(false);
  const { emitEvent, connect, getSocket, updateSocket } = useContext(SocketContext);
  const [isRunning, setIsRunning] = useState(false);
  const [mode, setMode] = useState<ApplicationMode>("flow");
  const [activeTopTab, setActiveTopTab] = useState<TopWorkspaceTab>("canvas");
  const [workstationSection, setWorkstationSection] =
    useState<WorkstationSection>("annotate");
  const [isTabletOrMobile, setIsTabletOrMobile] = useState(false);
  const { user, isAdmin, isOperator, hasPermission, logout } = useAuth();
  const [showPermManager, setShowPermManager] = useState(false);
  const canEditCanvas = isAdmin || hasPermission("canvas.edit_flow");
  const canUseTemplates = isAdmin || isOperator;
  const isOperatorTemplateExperience = isOperator;
  const { getElement } = useVisibility();
  const [loading, startLoadingWith] = useLoading();
  const dndSidebar = getElement("dragAndDropSidebar");
  const [templates, setTemplates] = useState<FlowTemplateSummary[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  // Deployment context – read line_id / station_id from URL query params
  const [deploymentContext] = useState<{ lineId: string; stationId: string } | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const lineId = params.get("line_id")?.trim() ?? "";
      const stationId = params.get("station_id")?.trim() ?? "";
      return lineId && stationId ? { lineId, stationId } : null;
    } catch {
      return null;
    }
  });
  const [activeDeployment, setActiveDeployment] = useState<TemplateDeployment | null>(null);
  const [templatesError, setTemplatesError] = useState("");
  const [showTemplateSaveModal, setShowTemplateSaveModal] = useState(false);
  const [showTemplateManager, setShowTemplateManager] = useState(false);

  const currentTabRef = useRef(currentTab);
  const flowTabsRef = useRef(flowTabs);
  const currentFlowTab = flowTabs.tabs[currentTab] ?? createEmptyFlowTab();
  const hasSelectedTemplate =
    !!currentFlowTab.metadata?.templateId &&
    !!currentFlowTab.metadata?.templateVersionId;
  const isTemplateLocked = isOperatorTemplateExperience && hasSelectedTemplate;
  const showWorkstation = !isOperatorTemplateExperience;
  const shouldShowReadonlyCanvasState =
    !canEditCanvas && !isOperatorTemplateExperience && !isTemplateLocked;

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    currentTabRef.current = currentTab;
  }, [currentTab]);

  useEffect(() => {
    flowTabsRef.current = flowTabs;
  }, [flowTabs]);

  useEffect(() => {
    const init = async () => {
      const savedCurrentTab = getCurrentTabIndex();
      const parsedTab = parseInt(savedCurrentTab || "0", 10);
      const safeTab = Number.isFinite(parsedTab)
        ? Math.max(0, Math.min(parsedTab, Math.max(0, flowTabsRef.current.tabs.length - 1)))
        : 0;
      await handleChangeTab(safeTab);
      setRefreshKey((prev) => prev + 1);
    };
    init();
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1024px)");
    const updateViewport = () => {
      setIsTabletOrMobile(mediaQuery.matches);
      if (!mediaQuery.matches) {
        dndSidebar.show();
      }
    };

    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);
    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (!isOperatorTemplateExperience) {
      saveTabsLocally(flowTabs.tabs);
    }
  }, [flowTabs, isOperatorTemplateExperience]);

  useEffect(() => {
    if (!isOperatorTemplateExperience) {
      saveCurrentTabIndex(currentTab);
    }
  }, [currentTab, isOperatorTemplateExperience]);

  useEffect(() => {
    if (!showWorkstation && activeTopTab !== "canvas") {
      setActiveTopTab("canvas");
    }
  }, [activeTopTab, showWorkstation]);

  const loadTemplates = useCallback(async () => {
    if (!canUseTemplates) {
      setTemplates([]);
      return;
    }

    setTemplatesLoading(true);
    setTemplatesError("");
    try {
      const nextTemplates = await listFlowTemplates();
      setTemplates(nextTemplates);
    } catch (error: any) {
      const message =
        error?.response?.data?.error ??
        error?.message ??
        "Gagal memuat daftar template.";
      setTemplates([]);
      setTemplatesError(message);
    } finally {
      setTemplatesLoading(false);
    }
  }, [canUseTemplates]);

  useEffect(() => {
    if (isOperatorTemplateExperience) {
      void loadTemplates();
    }
  }, [isOperatorTemplateExperience, loadTemplates]);

  // Auto-load active deployment template when line_id + station_id are present
  useEffect(() => {
    if (!isOperatorTemplateExperience || !deploymentContext) return;

    const { lineId, stationId } = deploymentContext;
    let cancelled = false;

    const autoLoad = async () => {
      try {
        const deployment = await getActiveDeployment(lineId, stationId);
        if (cancelled) return;
        if (!deployment) return;
        setActiveDeployment(deployment);
        // Only auto-apply if operator hasn't already selected a template
        if (!currentFlowTab.metadata?.templateId) {
          void handleApplyTemplate(deployment.template_id);
        }
      } catch {
        // Silent – operator can still pick manually
      }
    };

    void autoLoad();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOperatorTemplateExperience, deploymentContext]);

  const addNewFlowTab = () => {
    setFlowTabs((prevFlowTabs) => {
      const nextTabs = [...prevFlowTabs.tabs, createEmptyFlowTab()];
      setCurrentTab(nextTabs.length - 1);
      return { ...prevFlowTabs, tabs: nextTabs };
    });
  };

  const handleFlowChange = useCallback(
    (nodes: Node[], edges: Edge[], metadata?: FlowMetadata) => {
      setFlowTabs((prevFlowTabs) => {
        const updatedTabs = prevFlowTabs.tabs.map((tab, index) => {
          if (index === currentTabRef.current) {
            return {
              ...tab,
              nodes,
              edges,
              metadata: { ...tab.metadata, ...metadata },
            };
          }
          return tab;
        });
        return { ...prevFlowTabs, tabs: updatedTabs };
      });
    },
    [],
  );

  const handleMetadataChange = (metadata: FlowMetadata) => {
    setFlowTabs((prevFlowTabs) => {
      const updatedTabs = prevFlowTabs.tabs.map((tab, index) => {
        if (index === currentTab) {
          return {
            ...tab,
            metadata: { ...tab.metadata, ...metadata },
          };
        }
        return tab;
      });
      return { ...prevFlowTabs, tabs: updatedTabs };
    });
  };

  const replaceCurrentTab = useCallback((nextTab: FlowTab) => {
    setFlowTabs((prevFlowTabs) => {
      const safeTabs =
        prevFlowTabs.tabs.length > 0 ? [...prevFlowTabs.tabs] : [createEmptyFlowTab()];
      safeTabs[currentTabRef.current] = nextTab;
      return { ...prevFlowTabs, tabs: safeTabs };
    });
    setRefreshKey((prev) => prev + 1);
  }, []);

  const handleApplyTemplate = useCallback(
    async (templateId: number) => {
      try {
        const detail = await startLoadingWith(getFlowTemplate, templateId);
        const parsedFlow = convertJsonToFlow(detail.flow);
        if (parsedFlow.nodes.length === 0) {
          throw new Error("Template tidak memiliki node yang valid.");
        }
        // Sync each node's config schema to the latest nodeConfig registry.
        // This ensures new fields added after the template was saved appear
        // in the UI. Stored field values (on node.data) are never touched.
        const syncedNodes = syncNodeConfigs(parsedFlow.nodes);
        const templateNodes = alignTemplateNodesForViewport(
          syncedNodes as Node[],
        );
        replaceCurrentTab({
          nodes: templateNodes,
          edges: parsedFlow.edges as Edge[],
          metadata: {
            version: "1.0.0",
            name: detail.name,
            templateId: detail.id,
            templateVersionId: detail.version_id ?? undefined,
            templateName: detail.name,
            templatePolicy: detail.policy,
          },
        });
        toastInfoMessage(`Template '${detail.name}' dimuat.`);
      } catch (error: any) {
        const message =
          error?.response?.data?.error ??
          error?.message ??
          "Gagal memuat template.";
        toastErrorMessage(message);
      }
    },
    [replaceCurrentTab, startLoadingWith],
  );

  const handleClearTemplateSelection = useCallback(() => {
    if (isRunning) {
      toastFastInfoMessage(t("CannotChangeTabWhileRunning"));
      return;
    }

    replaceCurrentTab(createEmptyFlowTab());
  }, [isRunning, replaceCurrentTab, t]);

  const handleTemplateSaved = useCallback(
    (template: FlowTemplateDetail) => {
      handleMetadataChange({
        ...currentFlowTab.metadata,
        templateId: template.id,
        templateVersionId: template.version_id ?? undefined,
        templateName: template.name,
        templatePolicy: template.policy,
      });
      toastInfoMessage(`Template '${template.name}' berhasil disimpan.`);
    },
    [currentFlowTab.metadata],
  );

  const handleRunAllCurrentFlow = () => {
    const nodes = currentFlowTab.nodes;
    const edges = currentFlowTab.edges;

    if (nodes.length === 0) {
      toastFastInfoMessage(t("NoNodesToRun"));
      return;
    }

    const nodesSorted = nodesTopologicalSort(nodes, edges);
    const flowFile = convertFlowToJson(nodesSorted, edges, true, true);

    const nodesInError = getNodeInError(flowFile, nodesSorted);

    if (nodesInError.length > 0) {
      let errorMessage = createErrorMessageForMissingFields(nodesInError, t);
      toastErrorMessage(errorMessage);
      setFlowTabs({ ...flowTabs });
      return;
    }

    const event: FlowEvent = {
      name: "process_file",
      data: {
        jsonFile: JSON.stringify(flowFile),
        metadata: currentFlowTab.metadata,
      },
    };
    void (async () => {
      try {
        const activeSocket = getSocket();
        await prewarmClientCameraPublishers({
          nodes: nodesSorted,
          socket: activeSocket,
          connect,
        });
      } finally {
        const success = emitEvent(event);
        setIsRunning(success);
      }
    })();
  };

  const handleChangeRun = (runStatus: boolean) => {
    setIsRunning(runStatus);
  };

  const handleChangeTab = useCallback(
    async (index: number) => {
      if (!isRunning) {
        const maxIndex = Math.max(0, flowTabsRef.current.tabs.length - 1);
        setCurrentTab(Math.max(0, Math.min(index, maxIndex)));
      } else {
        toastFastInfoMessage(t("CannotChangeTabWhileRunning"));
      }
    },
    [isRunning],
  );

  const handleChangeMode = (mode: ApplicationMode) => {
    setMode(mode);
  };

  const handleDeleteFlow = async (index: number) => {
    if (flowTabsRef.current.tabs.length === 1) {
      toastInfoMessage(t("CannotDeleteLastFlow"));
      return;
    }

    setFlowTabs((prev) => {
      let updatedTabs = structuredClone(prev.tabs);
      updatedTabs = updatedTabs.filter((_: FlowTab, i: number) => i !== index);
      const updatedFlowTabs = { ...prev, tabs: updatedTabs };
      return updatedFlowTabs;
    });

    setCurrentTab(index - 1 > 0 ? index - 1 : 0);
    setRefreshKey((prev) => prev + 1);
  };

  const handleAddNewFlow = (flowData: any) => {
    setFlowTabs((prevFlowTabs) => {
      const nextTabs = [...prevFlowTabs.tabs, flowData];
      setCurrentTab(nextTabs.length - 1);
      return { ...prevFlowTabs, tabs: nextTabs };
    });
  };

  const handleChangeTabName = (index: number, name: string) => {
    setFlowTabs((prevFlowTabs) => {
      const updatedTabs = prevFlowTabs.tabs.map((tab, i) =>
        i === index
          ? {
              ...tab,
              metadata: {
                ...tab.metadata,
                name,
              },
            }
          : tab,
      );
      return { ...prevFlowTabs, tabs: updatedTabs };
    });
  };

  const shouldRenderSidebar =
    activeTopTab === "workstation" || !isOperatorTemplateExperience;
  const isSidebarOpen = shouldRenderSidebar && (!isTabletOrMobile || dndSidebar.isVisible);

  const handleToggleSidebar = () => {
    if (isTabletOrMobile && shouldRenderSidebar) {
      dndSidebar.toggle();
    }
  };

  const handleCloseSidebar = () => {
    if (isTabletOrMobile && shouldRenderSidebar && dndSidebar.isVisible) {
      dndSidebar.hide();
    }
  };

  const handleRefreshApp = useCallback(() => {
    const snapshotTabs = flowTabsRef.current.tabs ?? [];

    void (async () => {
      try {
        const activeSocket = getSocket();
        const clientSessionId = activeSocket?.getId();
        const nodes = snapshotTabs.flatMap((tab) => tab.nodes ?? []);

        stopAllClientCameraPublishers(activeSocket);

        await Promise.all(
          nodes.map(async (node) => {
            const nodeName = String(node?.data?.name || "").trim();
            const outputStreamIds = extractStreamIdsFromValue(node?.data?.outputData);
            const configStreamIds = extractStreamIdsFromValue(node?.data?.stream_ref);
            const streamIds = [...new Set([...outputStreamIds, ...configStreamIds])];
            const isCameraNode = isLikelyCameraNode(node);

            if (isCameraNode) {
              stopClientCameraPublisherByIndex(node?.data?.camera_index, activeSocket);
            }

            if (nodeName) {
              await stopStreamsByOwner(nodeName);
            }

            await Promise.all(streamIds.map((streamId) => stopStream(streamId)));

            if (isCameraNode && clientSessionId) {
              await stopCameraStreamsByIndex(
                node?.data?.camera_index,
                clientSessionId,
              );
            }
          }),
        );

        if (clientSessionId) {
          await stopAllCameraStreams(clientSessionId);
        }
      } catch (error) {
        console.warn("Refresh cleanup failed:", error);
      } finally {
        // Clear runtime state from all nodes so they return to idle after refresh.
        // Configuration (positions, parameters, edges) is preserved.
        const RUNTIME_KEYS = [
          "outputData",
          "lastRun",
          "isDone",
          "isRunning",
          "startup_status",
          "startup_deferred",
          "error",
          "warning",
        ];
        setFlowTabs((prev) => ({
          ...prev,
          tabs: prev.tabs.map((tab) => ({
            ...tab,
            nodes: tab.nodes.map((node) => {
              const cleanData = { ...node.data };
              for (const key of RUNTIME_KEYS) {
                delete (cleanData as any)[key];
              }
              return { ...node, data: cleanData };
            }),
          })),
        }));
        setRefreshKey((prev) => prev + 1);
        updateSocket();
        toastFastInfoMessage("Frontend dan koneksi backend direfresh.");
      }
    })();
  }, [getSocket, updateSocket]);

  return (
    <div
      className={`aski-app ${isSidebarOpen ? "" : "sidebar-collapsed"} ${activeTopTab === "workstation" ? "is-workstation" : ""}`}
    >
      {/* Baris info user + tombol logout (selalu tampil di atas) */}
      <div className="aski-user-bar">
        <span className="aski-user-bar-info">
          <span className={`aski-role-badge ${user?.role ?? ""}`}>
            {user?.role === "admin" ? "Admin" : "Operator"}
          </span>
          {user?.username}
        </span>
        <div className="aski-user-bar-actions">
          {isAdmin && (
            <button
              className="aski-user-bar-btn"
              onClick={() => setShowPermManager(true)}
            >
              Permissions
            </button>
          )}
          <button className="aski-user-bar-btn danger" onClick={logout}>
            Logout
          </button>
        </div>
      </div>

      {/* Modal Permissions Manager */}
      {showPermManager && (
        <PermissionsManager onClose={() => setShowPermManager(false)} />
      )}
      {showTemplateSaveModal && (
        <TemplateSaveModal
          isOpen={showTemplateSaveModal}
          nodes={currentFlowTab.nodes}
          edges={currentFlowTab.edges}
          defaultName={
            currentFlowTab.metadata?.templateName ||
            currentFlowTab.metadata?.name ||
            `${t("Flow")} ${currentTab + 1}`
          }
          onClose={() => setShowTemplateSaveModal(false)}
          onSaved={handleTemplateSaved}
        />
      )}
      {isAdmin && (
        <TemplateManagerPanel
          isOpen={showTemplateManager}
          onClose={() => setShowTemplateManager(false)}
          onLoad={handleApplyTemplate}
        />
      )}
      <TabHeader
        onToggleSidebar={handleToggleSidebar}
        activeTopTab={activeTopTab}
        onChangeTopTab={setActiveTopTab}
        onRefresh={handleRefreshApp}
        showWorkstation={showWorkstation}
      />

      {shouldRenderSidebar && (
        <aside className={`aski-sidebar ${isSidebarOpen ? "is-open" : ""}`}>
          {activeTopTab === "canvas" ? (
            <DnDSidebar />
          ) : (
            <WorkstationSidebar
              activeSection={workstationSection}
              onSelect={(section) => {
                setWorkstationSection(section);
                if (isTabletOrMobile) {
                  dndSidebar.hide();
                }
              }}
            />
          )}
        </aside>
      )}

      <div
        className={`aski-backdrop ${isSidebarOpen ? "is-open" : ""}`}
        onClick={handleCloseSidebar}
      />

      <main
        className={`aski-main ${activeTopTab === "workstation" ? "aski-main-workstation" : ""}`}
      >
        {activeTopTab === "canvas" ? (
          <>
            <div
              className={`aski-canvas-header${
                isOperatorTemplateExperience ? " operator-template" : ""
              }`}
            >
              <div className="aski-tabs-strip flex max-w-[72%] items-center">
                {isOperatorTemplateExperience ? (
                  <div className="aski-template-current">
                    {hasSelectedTemplate
                      ? currentFlowTab.metadata?.templateName || "Template Active"
                      : "Choose Template"}
                  </div>
                ) : (
                  <>
                    {flowTabs.tabs.map((tab: any, index: number) => (
                      <Tab
                        key={index}
                        index={index}
                        active={index === currentTab}
                        onChangeTab={handleChangeTab}
                        onDeleteTab={handleDeleteFlow}
                        onChangeTabName={handleChangeTabName}
                        canManage={canEditCanvas}
                        name={
                          !!tab.metadata?.name
                            ? tab.metadata.name
                            : !!tab.name
                              ? tab.name
                              : t("Flow") + " " + (index + 1)
                        }
                      />
                    ))}
                    {canEditCanvas && (
                      <button
                        onClick={addNewFlowTab}
                        className="aski-add-tab ml-1"
                        aria-label="Add flow tab"
                      >
                        <FaPlus />
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className="ml-3 flex items-center gap-3">
                {isAdmin && (
                  <>
                    <button
                      type="button"
                      className="aski-template-toolbar-btn"
                      onClick={() => setShowTemplateSaveModal(true)}
                      disabled={currentFlowTab.nodes.length === 0}
                    >
                      Save Template
                    </button>
                    <button
                      type="button"
                      className="aski-template-toolbar-btn ghost"
                      onClick={() => setShowTemplateManager(true)}
                    >
                      Manage Templates
                    </button>
                  </>
                )}
                {isOperatorTemplateExperience && hasSelectedTemplate && (
                  <button
                    type="button"
                    className="aski-template-toolbar-btn ghost"
                    onClick={handleClearTemplateSelection}
                  >
                    Change Template
                  </button>
                )}
                {(!isOperatorTemplateExperience || hasSelectedTemplate) && (
                  <ButtonRunAll
                    onClick={handleRunAllCurrentFlow}
                    isRunning={isRunning}
                  />
                )}
              </div>
            </div>

            <div
              className={`aski-canvas-body${
                shouldShowReadonlyCanvasState ? " canvas-readonly" : ""
              }`}
            >
              {isOperatorTemplateExperience && !hasSelectedTemplate ? (
                <>
                  {activeDeployment && (
                    <div className="aski-deployment-badge">
                      <span>
                        Line: <strong>{activeDeployment.line_id}</strong> / Station:{" "}
                        <strong>{activeDeployment.station_id}</strong> — Active template:{" "}
                        <strong>{activeDeployment.template_name}</strong> v
                        {activeDeployment.version_number}
                      </span>
                      <button
                        type="button"
                        className="aski-deployment-apply-btn"
                        onClick={() => void handleApplyTemplate(activeDeployment.template_id)}
                      >
                        Apply Deployment Template
                      </button>
                    </div>
                  )}
                  <TemplatePickerPanel
                    templates={templates}
                    isLoading={templatesLoading || loading}
                    errorMessage={templatesError}
                    selectedTemplateId={currentFlowTab.metadata?.templateId ?? null}
                    onRefresh={() => {
                      void loadTemplates();
                    }}
                    onSelect={(templateId) => {
                      void handleApplyTemplate(templateId);
                    }}
                  />
                </>
              ) : (
                <TemplateModeProvider
                  templatePolicy={currentFlowTab.metadata?.templatePolicy}
                  isTemplateLocked={isTemplateLocked}
                >
                  <FlowDataProvider
                    flowTab={currentFlowTab}
                    onFlowChange={handleFlowChange}
                  >
                    <FlowWrapper
                      key={`flow-${currentTab}`}
                      mode={mode}
                      onChangeMode={handleChangeMode}
                      onAddNewFlow={handleAddNewFlow}
                    >
                      {mode === "flow" && (
                        <Flow
                          key={`flow-${currentTab}-${currentFlowTab.metadata?.templateVersionId ?? "draft"}-${refreshKey}`}
                          nodes={currentFlowTab.nodes ?? []}
                          edges={currentFlowTab.edges ?? []}
                          metadata={currentFlowTab.metadata ?? {}}
                          onFlowChange={handleFlowChange}
                          onUpdateMetadata={handleMetadataChange}
                          showOnlyOutput={showOnlyOutput}
                          isRunning={isRunning}
                          onRunChange={handleChangeRun}
                          onLoaded={() => {}}
                        />
                      )}
                    </FlowWrapper>
                  </FlowDataProvider>
                </TemplateModeProvider>
              )}
            </div>
          </>
        ) : (
          <div className="aski-workstation-wrap" key={`workstation-${refreshKey}`}>
            <WorkstationMain activeSection={workstationSection} />
          </div>
        )}
      </main>
    </div>
  );
};

export default FlowTabs;
