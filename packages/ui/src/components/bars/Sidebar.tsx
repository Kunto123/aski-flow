import React from "react";
import { Edge, Node } from "reactflow";
import JSONView from "../side-views/JSONView";
import styled, { css } from "styled-components";
import { useTranslation } from "react-i18next";
import { useVisibility } from "../../providers/VisibilityProvider";
import CurrentNodeView from "../side-views/CurrentNodeView";
import { Tabs, rem } from "@mantine/core";
import { FaFile } from "react-icons/fa";
import { MdCenterFocusStrong } from "react-icons/md";
import { FiChevronsLeft, FiChevronsRight } from "react-icons/fi";

interface SidebarProps {
  nodes: Node[];
  edges: Edge[];
  onChangeFlow: (nodes: Node[], edges: Edge[]) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ nodes, edges, onChangeFlow }) => {
  const { t } = useTranslation("flow");
  const { getElement, sidepaneActiveTab, setSidepaneActiveTab } =
    useVisibility();

  const sidebar = getElement("sidebar");
  const show = sidebar.isVisible;
  const toggleShow = () => sidebar.toggle();

  const iconStyle = { width: rem(12), height: rem(12) };

  return (
    <>
      <SidebarToggle onClick={toggleShow}>
        <ToggleIcon>
          {show ? <FiChevronsRight /> : <FiChevronsLeft />}
        </ToggleIcon>
      </SidebarToggle>

      <SidebarContainer
        $show={show}
        className={`aski-rightpanel ${show ? "is-open" : ""}`}
      >
        <Tabs
          value={sidepaneActiveTab}
          onChange={(tab) => {
            if (tab === "json" || tab === "current_node") {
              setSidepaneActiveTab(tab);
            }
          }}
          color="cyan"
          variant="pills"
          keepMounted={false}
        >
          <Tabs.List grow>
            <Tabs.Tab
              value="json"
              leftSection={<FaFile style={iconStyle} />}
            >
              {t("JsonView")}
            </Tabs.Tab>
            <Tabs.Tab
              value="current_node"
              leftSection={<MdCenterFocusStrong style={iconStyle} />}
            >
              {t("currentNodeView")}
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="json">
            <JSONView nodes={nodes} edges={edges} onChangeFlow={onChangeFlow} />
          </Tabs.Panel>

          <Tabs.Panel value="current_node">
            <CurrentNodeView />
          </Tabs.Panel>
        </Tabs>
      </SidebarContainer>
      <div
        className={`aski-rightpanel-backdrop ${show ? "is-open" : ""}`}
        onClick={toggleShow}
      />
    </>
  );
};

const SidebarContainer = styled.div<{ $show: boolean }>`
  position: fixed;
  right: 0;
  top: var(--aski-topbar-h);
  bottom: 0;
  width: min(420px, 36vw);
  color: ${({ theme }) => theme.text};
  background-color: ${({ theme }) => theme.bg};
  box-shadow: -3px 0 3px rgba(0, 0, 0, 0.2);
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  transform: translateX(110%);
  transition: transform 0.2s ease-in-out;
  z-index: 60;

  ${({ $show }) =>
    $show &&
    css`
      transform: translateX(0);
    `}
`;

const SidebarToggle = styled.div`
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 96px;
  background-color: #110a0e;
  border-top-left-radius: 10px;
  border-bottom-left-radius: 10px;
  transition: opacity 0.2s ease-in-out;
  z-index: 61;

  @media screen and (max-width: 768px) {
    display: none;
  }
`;

const ToggleIcon = styled.div`
  color: #a4a4a4d1;
  font-size: 1.5em;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);

  :hover {
    color: #ffffff;
  }
`;

export default Sidebar;
