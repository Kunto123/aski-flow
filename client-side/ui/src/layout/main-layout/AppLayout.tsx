import { useCallback, useContext, useEffect, useRef, useState } from "react";
import Flow from "../../components/Flow";
import { Node, Edge } from "reactflow";
import { useTranslation } from "react-i18next";
import { FaPlus } from "react-icons/fa";
import {
  convertFlowToJson,
  formatFlow,
  nodesTopologicalSort,
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
import { prewarmClientCameraPublishers } from "../../services/clientCameraPublishers";
import {
  WorkstationMain,
  WorkstationSection,
  WorkstationSidebar,
} from "./workstation/WorkstationDummy";

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
}

export interface FlowManagerState {
  tabs: FlowTab[];
}

export interface FlowTabsProps {
  tabs: FlowTab[];
}

export type ApplicationMode = "flow";
export type ApplicationMenu = "template" | "config" | "help";

const FlowTabs = ({ tabs }: FlowTabsProps) => {
  const { t } = useTranslation("flow");

  const [flowTabs, setFlowTabs] = useState<FlowManagerState>({
    tabs: tabs,
  });
  const [currentTab, setCurrentTab] = useState(0);
  const [refresh, setRefresh] = useState(false);
  const [showOnlyOutput, setShowOnlyOutput] = useState(false);
  const { emitEvent, connect, socket, updateSocket } = useContext(SocketContext);
  const [isRunning, setIsRunning] = useState(false);
  const [mode, setMode] = useState<ApplicationMode>("flow");
  const [activeTopTab, setActiveTopTab] = useState<TopWorkspaceTab>("canvas");
  const [workstationSection, setWorkstationSection] =
    useState<WorkstationSection>("annotate");
  const [selectedEdgeType, setSelectedEdgeType] = useState("default");
  const [isTabletOrMobile, setIsTabletOrMobile] = useState(false);
  const useAuth = import.meta.env.VITE_APP_USE_AUTH === "true";
  const { getElement } = useVisibility();
  const [loading, startLoadingWith] = useLoading();
  const configPopup = getElement("configPopup");
  const dndSidebar = getElement("dragAndDropSidebar");

  const currentTabRef = useRef(currentTab);
  const flowTabsRef = useRef(flowTabs);

  useEffect(() => {
    connect();
  });

  useEffect(() => {
    currentTabRef.current = currentTab;
  }, [currentTab]);

  useEffect(() => {
    flowTabsRef.current = flowTabs;
  }, [flowTabs]);

  useEffect(() => {
    const init = async () => {
      const savedCurrentTab = getCurrentTabIndex();
      await handleChangeTab(parseInt(savedCurrentTab || "0"));
      setRefresh((prev) => !prev);
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
    saveTabsLocally(flowTabs.tabs);
  }, [flowTabs]);

  useEffect(() => {
    saveCurrentTabIndex(currentTab);
  }, [currentTab]);

  const addNewFlowTab = () => {
    setFlowTabs((prevFlowTabs) => {
      const newFlowTab = { ...prevFlowTabs };
      newFlowTab.tabs.push({
        nodes: [],
        edges: [],
        metadata: { version: "1.0.0" },
      });
      return newFlowTab;
    });
  };

  const handleFlowChange = (
    nodes: Node[],
    edges: Edge[],
    metadata?: FlowMetadata,
  ) => {
    setFlowTabs((prevFlowTabs) => {
      const updatedTabs = prevFlowTabs.tabs.map((tab, index) => {
        if (index === currentTab) {
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
  };

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

  const handleRunAllCurrentFlow = () => {
    const nodes = flowTabs.tabs[currentTab].nodes;
    const edges = flowTabs.tabs[currentTab].edges;

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
        metadata: flowTabs.tabs[currentTab].metadata,
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
        setCurrentTab(index);
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
    setRefresh((prev) => !prev);
  };

  const handleAddNewFlow = (flowData: any) => {
    setFlowTabs((prevFlowTabs) => {
      const newFlowTab = { ...prevFlowTabs };
      newFlowTab.tabs.push(flowData);
      return newFlowTab;
    });
    setCurrentTab(flowTabs.tabs.length - 1);
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

  const isSidebarOpen = !isTabletOrMobile || dndSidebar.isVisible;

  const handleToggleSidebar = () => {
    if (isTabletOrMobile) {
      dndSidebar.toggle();
    }
  };

  const handleCloseSidebar = () => {
    if (isTabletOrMobile && dndSidebar.isVisible) {
      dndSidebar.hide();
    }
  };

  const handleRefreshApp = useCallback(() => {
    setRefresh((prev) => !prev);
    updateSocket();
    toastFastInfoMessage("Frontend dan koneksi backend direfresh.");
  }, [updateSocket]);

  return (
    <div
      className={`aski-app ${isSidebarOpen ? "" : "sidebar-collapsed"} ${activeTopTab === "workstation" ? "is-workstation" : ""}`}
    >
      <TabHeader
        onToggleSidebar={handleToggleSidebar}
        activeTopTab={activeTopTab}
        onChangeTopTab={setActiveTopTab}
        onRefresh={handleRefreshApp}
      />

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

      <div
        className={`aski-backdrop ${isSidebarOpen ? "is-open" : ""}`}
        onClick={handleCloseSidebar}
      />

      <main
        className={`aski-main ${activeTopTab === "workstation" ? "aski-main-workstation" : ""}`}
      >
        {activeTopTab === "canvas" ? (
          <>
            <div className="aski-canvas-header">
              <div className="aski-tabs-strip flex max-w-[72%] items-center">
                {flowTabs.tabs.map((tab: any, index: number) => (
                  <Tab
                    key={index}
                    index={index}
                    active={index === currentTab}
                    onChangeTab={handleChangeTab}
                    onDeleteTab={handleDeleteFlow}
                    onChangeTabName={handleChangeTabName}
                    name={
                      !!tab.metadata?.name
                        ? tab.metadata.name
                        : !!tab.name
                          ? tab.name
                          : t("Flow") + " " + (index + 1)
                    }
                  />
                ))}
                <button
                  onClick={addNewFlowTab}
                  className="aski-add-tab ml-1"
                  aria-label="Add flow tab"
                >
                  <FaPlus />
                </button>
              </div>
              <div className="ml-3 flex items-center">
                <ButtonRunAll
                  onClick={handleRunAllCurrentFlow}
                  isRunning={isRunning}
                />
              </div>
            </div>

            <div className="aski-canvas-body">
              <FlowDataProvider
                flowTab={flowTabs.tabs[currentTab]}
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
                      key={`flow-${currentTab}-${refresh}`}
                      nodes={flowTabs.tabs[currentTab]?.nodes ?? []}
                      edges={flowTabs.tabs[currentTab]?.edges ?? []}
                      metadata={flowTabs.tabs[currentTab]?.metadata ?? {}}
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
            </div>
          </>
        ) : (
          <div className="aski-workstation-wrap" key={`workstation-${refresh}`}>
            <WorkstationMain activeSection={workstationSection} />
          </div>
        )}
      </main>
    </div>
  );
};

export default FlowTabs;
