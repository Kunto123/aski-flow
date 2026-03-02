import { useMemo } from "react";
import { FiMenu, FiRefreshCw } from "react-icons/fi";
import styled from "styled-components";

export type TopWorkspaceTab = "canvas" | "workstation";

interface TabHeaderProps {
  onToggleSidebar: () => void;
  activeTopTab: TopWorkspaceTab;
  onChangeTopTab: (tab: TopWorkspaceTab) => void;
  onRefresh: () => void;
}

const TabHeader = ({
  onToggleSidebar,
  activeTopTab,
  onChangeTopTab,
  onRefresh,
}: TabHeaderProps) => {
  const logoSrc = useMemo(() => {
    return `${import.meta.env.BASE_URL}img/aski_logo.png`;
  }, []);

  return (
    <TabsContainer className="aski-topbar z-30">
      <button
        type="button"
        className="aski-hamburger"
        aria-label="Toggle sidebar"
        onClick={onToggleSidebar}
      >
        <FiMenu />
      </button>

      <div className="flex items-center gap-x-3">
        <div className="flex items-center gap-x-3">
          <img
            src={logoSrc}
            alt="ASKI"
            className="h-9 select-none"
          />
        </div>
      </div>

      <div className="mx-auto flex items-center gap-x-6">
        <button
          className={`aski-top-tab ${activeTopTab === "canvas" ? "active" : ""}`}
          onClick={() => onChangeTopTab("canvas")}
          type="button"
        >
          Canvas
        </button>
        <button
          className={`aski-top-tab ${
            activeTopTab === "workstation" ? "active" : ""
          }`}
          onClick={() => onChangeTopTab("workstation")}
          type="button"
        >
          WorkStation
        </button>
      </div>

      <button
        type="button"
        className="aski-topbar-refresh"
        aria-label="Refresh frontend and backend connection"
        onClick={onRefresh}
      >
        <FiRefreshCw />
        Refresh
      </button>
    </TabsContainer>
  );
};

const TabsContainer = styled.div`
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
`;

export default TabHeader;
