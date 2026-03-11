import { useDrag } from "react-dnd";
import { useTranslation } from "react-i18next";
import { DnDNode } from "../../../nodes-configuration/sectionConfig";
import { ReactNode, memo } from "react";
import styled from "styled-components";
import { toastCustomIconInfoMessage } from "../../../utils/toastUtils";
import { FiMenu, FiMove } from "react-icons/fi";
import { darken, lighten } from "polished";
import { Tooltip } from "@mantine/core";
import { GripIcon } from "./GripIcon";
import { DraggableNodeAdditionnalData } from "./types";

interface DraggableNodeProps extends DraggableNodeAdditionnalData {
  node: DnDNode;
  id?: string;
}

interface NodeBadgeProps {
  children?: ReactNode;
  color?: string;
}
const NodeBadge = ({ children, color = "#0369a1" }: NodeBadgeProps) => (
  <div
    className={`absolute left-3 top-3 translate-x-[-50%] translate-y-[-50%] -rotate-45 transform px-5 text-xs text-white`}
    style={{ backgroundColor: color }}
  >
    {children}
  </div>
);

const DraggableNode = (props: DraggableNodeProps) => {
  const { t } = useTranslation("flow");

  const [{ isDragging }, drag] = useDrag({
    type: "NODE",
    item: {
      nodeType: props.node.type,
      additionnalData: props.additionnalData,
      additionnalConfig: props.additionnalConfig,
    },
    collect: (monitor) => {
      const result = {
        isDragging: monitor.isDragging(),
      };
      return result;
    },
  });

  function showDragAndDropHelper() {
    if (localStorage.getItem("AIFLOW_didShowDragDropHelper") === "true") {
      return;
    }
    toastCustomIconInfoMessage(
      "Drag and drop nodes onto the canvas to add them.",
      FiMove,
    );
    localStorage.setItem("AIFLOW_didShowDragDropHelper", "true");
  }

  return (
    <Tooltip
      label={t(props.node.helpMessage ?? "")}
      color="gray"
      openDelay={300}
    >
      <Node
        ref={drag}
        id={props.id ?? props.node.type}
        onClick={(e: React.MouseEvent<HTMLDivElement>) => {
          e.stopPropagation();
        }}
        onTouchEnd={(e: React.TouchEvent<HTMLDivElement>) => {
          e.stopPropagation();
        }}
        onDoubleClick={() => {
          showDragAndDropHelper();
        }}
        bandColor={props.node.color}
        className={`sidebar-dnd-node aski-pill-node group relative flex h-9 w-full cursor-grab flex-row items-center justify-between overflow-hidden rounded-full px-4 text-left font-semibold transition-all duration-150 ease-in-out ${isDragging ? "opacity-10" : ""}`}
      >
        <div className="flex w-full items-center">
          <p className="flex-grow truncate">{t(props.node.label)}</p>
          {/* Mock UI has clean pills without drag affordance; keep DnD behavior, hide icon */}
          <span className="pointer-events-none hidden">
            <GripIcon className="h-4 w-4" />
          </span>
        </div>

        {props.node.isBeta && <NodeBadge>Beta</NodeBadge>}
        {props.node.isNew && <NodeBadge color="#166e4c">New</NodeBadge>}
      </Node>
    </Tooltip>
  );
};

export const Node = styled.div<{ bandColor?: string }>`
  background: rgba(255, 255, 255, 0.95);
  color: #0e5d6d;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
`;

export default memo(DraggableNode);
