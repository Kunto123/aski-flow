import React, { useMemo, useState } from "react";
import { FaPlus } from "react-icons/fa";
import styled from "styled-components";
import Tab from "./Tab";
import { FlowTab } from "../AppLayout";

interface TabHeaderProps {
  tabs: any[];
  currentTab: number;
  onChangeTab: (index: number) => void;
  onDeleteTab: (index: number) => void;
  onAddFlowTab: () => void;
  onChangeTabName?: (index: number, name: string) => void;
  tabPrefix: string;
  children: React.ReactNode;
}

const TabHeader = ({
  tabs,
  currentTab,
  onChangeTab,
  onDeleteTab,
  onAddFlowTab,
  onChangeTabName,
  tabPrefix,
  children,
}: TabHeaderProps) => {
  // Dummy tab for Week-2 checkpoint: UI shows WorkStation, but behavior stays on Canvas.
  const [activeTopTab, setActiveTopTab] = useState<"canvas" | "workstation">(
    "canvas",
  );

  const logoSrc = useMemo(() => {
    // Replace this path with your provided ASKI logo image.
    // Suggested location: packages/ui/public/img/aski-logo.png
    return "/img/aski-logo.png";
  }, []);

  return (
    <TabsContainer className="z-30 flex w-full flex-col">
      {/* Top navigation bar (teal) */}
      <div
        className="aski-header flex w-full items-center px-4"
        style={{ height: "var(--aski-topbar-height)" }}
      >
        <div className="flex items-center gap-x-3">
          <img
            src={logoSrc}
            onError={(e) => {
              // @ts-ignore
              e.currentTarget.src = "/logo.svg";
            }}
            alt="ASKI"
            className="h-9 select-none"
          />
        </div>

        <div className="mx-auto flex items-center gap-x-6">
          <button
            className={`aski-top-tab ${
              activeTopTab === "canvas" ? "active" : ""
            }`}
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

        {/* Right side: user */}
        <div className="ml-auto flex items-center gap-x-4">
          <div className="hidden items-center gap-x-2 text-sm text-white/80 md:flex">
            <span>User</span>
            <div className="h-8 w-8 rounded-full bg-white/90" />
          </div>
        </div>
      </div>

      {/* Canvas header row (dark, starts after sidebar): tabs centered + Run All at right */}
      <div className="aski-canvas-header relative flex w-full items-center px-3">
        <div className="absolute right-6 top-1/2 -translate-y-1/2">{children}</div>

        <Tabs className="mx-auto overflow-hidden hover:overflow-x-auto">
          {tabs.map((tab: any, index: number) => (
            <Tab
              key={index}
              index={index}
              active={index === currentTab}
              onChangeTab={onChangeTab}
              onDeleteTab={onDeleteTab}
              onChangeTabName={onChangeTabName}
              name={
                !!tab.metadata?.name
                  ? tab.metadata.name
                  : !!tab.name
                    ? tab.name
                    : tabPrefix + " " + (index + 1)
              }
            />
          ))}
        </Tabs>
        <AddTabButton onClick={onAddFlowTab} className="aski-add-tab">
          <FaPlus />
        </AddTabButton>
      </div>
    </TabsContainer>
  );
};

const TabsContainer = styled.div`
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
`;

const Tabs = styled.div`
  white-space: nowrap;
  overflow-y: hidden;
  padding-bottom: 6px;
  max-width: 52%;
`;

const AddTabButton = styled.div``;

export default TabHeader;
