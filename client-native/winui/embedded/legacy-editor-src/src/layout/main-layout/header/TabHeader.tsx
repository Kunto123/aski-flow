import { useMemo } from "react";
import { FiMenu, FiRefreshCw } from "react-icons/fi";
import styled from "styled-components";

export type TopWorkspaceTab = "canvas" | "workstation";

interface TabHeaderProps {
  onToggleSidebar: () => void;
  activeTopTab: TopWorkspaceTab;
  onChangeTopTab: (tab: TopWorkspaceTab) => void;
  onRefresh: () => void;
  showWorkstation?: boolean;
}

const TabHeader = ({
  onToggleSidebar,
  activeTopTab,
  onChangeTopTab,
  onRefresh,
  showWorkstation = true,
}: TabHeaderProps) => {
  const logoSrc = useMemo(() => {
    return `${import.meta.env.BASE_URL}img/aski_logo.png`;
  }, []);

  return (
    <TabsContainer className="aski-topbar">
      <div className="aski-topbar-brand">
        <button
          type="button"
          className="aski-hamburger"
          aria-label="Toggle sidebar"
          onClick={onToggleSidebar}
        >
          <FiMenu />
        </button>

        <img
          src={logoSrc}
          alt="ASKI"
          className="aski-topbar-logo"
        />
      </div>

      <div className="aski-topbar-center">
        <div
          className="aski-topbar-tabs"
          role="tablist"
          aria-label="Workspace navigation"
        >
          <button
            className={`aski-top-tab ${activeTopTab === "canvas" ? "active" : ""}`}
            onClick={() => onChangeTopTab("canvas")}
            type="button"
          >
            Canvas
          </button>
          {showWorkstation && (
            <button
              className={`aski-top-tab ${
                activeTopTab === "workstation" ? "active" : ""
              }`}
              onClick={() => onChangeTopTab("workstation")}
              type="button"
            >
              Workstation
            </button>
          )}
        </div>
      </div>

      <div className="aski-topbar-actions">
        <button
          type="button"
          className="aski-topbar-refresh"
          aria-label="Refresh frontend and backend connection"
          onClick={onRefresh}
        >
          <FiRefreshCw />
          <span className="aski-topbar-refresh-label">Refresh</span>
        </button>
      </div>
    </TabsContainer>
  );
};

const TabsContainer = styled.div`
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
`;

export default TabHeader;
