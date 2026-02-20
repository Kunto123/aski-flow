import { useMemo, useState } from "react";
import { FiMenu } from "react-icons/fi";
import styled from "styled-components";

interface TabHeaderProps {
  onToggleSidebar: () => void;
}

const TabHeader = ({ onToggleSidebar }: TabHeaderProps) => {
  const [activeTopTab, setActiveTopTab] = useState<"canvas" | "workstation">(
    "canvas",
  );

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
          onClick={() => setActiveTopTab("canvas")}
          type="button"
        >
          Canvas
        </button>
        <button
          className={`aski-top-tab ${
            activeTopTab === "workstation" ? "active" : ""
          }`}
          onClick={() => setActiveTopTab("workstation")}
          type="button"
        >
          WorkStation
        </button>
      </div>
    </TabsContainer>
  );
};

const TabsContainer = styled.div`
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
`;

export default TabHeader;
