import { AiOutlineRobot } from "react-icons/ai";
import { BsInputCursorText } from "react-icons/bs";
import { FaToolbox } from "react-icons/fa";
import {
  CategoryType,
  NodeConfig,
  SubnodeData,
  SubnodeShortcutStyle,
} from "./types";
import { nodeConfigs } from "./nodeConfig";
import { getNodesHiddenList } from "../components/popups/config-popup/parameters";
import {
  getHighPriorityNodePrefixes,
  getLowPriorityNodePrefixes,
} from "../config/config";
import { DraggableNodeAdditionnalData } from "../components/bars/dnd-sidebar/types";

export type NodeSection = {
  label: string;
  type: CategoryType;
  icon?: any;
  nodes?: DnDNode[];
};

export type DnDNode = {
  label: string;
  type: string;
  keywords?: string[];
  helpMessage?: string;
  section: string;
  category: CategoryType;
  isBeta?: boolean;
  isNew?: boolean;
  color?: string;
  subnodesShortcutConfig?: SubnodeData[];
  subnodesShortcutStyle?: SubnodeShortcutStyle;
  additionnalData?: DraggableNodeAdditionnalData;
};
export function transformNodeConfigsToDndNode(configs: {
  [key: string]: NodeConfig | undefined;
}): DnDNode[] {
  return Object.entries(configs).map(([type, config]) => {
    const fallbackCategory = mapSectionToCategory(config?.section);
    return {
      label: config?.nodeName,
      type: type,
      helpMessage: config?.helpMessage || undefined,
      section: config?.section,
      category: config?.category ?? fallbackCategory,
      isBeta: config?.isBeta,
    } as DnDNode;
  });
}

function mapSectionToCategory(section?: string): CategoryType {
  if (!section) return "processing";
  if (section === "input") return "input";
  if (section === "tools") return "processing";
  if (section === "models") return "processing";
  if (section === "image-generation") return "processing";
  return "processing";
}

export function getNonGenericNodeConfig() {
  const nonGenericNodeConfig: DnDNode[] = [
    {
      label: "Media (File/Image/Audio/Video)",
      type: "file",
      keywords: ["media", "file", "image", "audio", "video"],
      helpMessage: "fileUploadHelp",
      section: "input",
      category: "input",
    },
    {
      label: "Display",
      type: "display",
      helpMessage: "displayHelp",
      section: "tools",
      category: "output",
    },
  ];
  return nonGenericNodeConfig;
}

function getAllDndNode(): DnDNode[] {
  const nodesDisabled = getNodesHiddenList();
  const nonGenericNodeConfig = getNonGenericNodeConfig();
  return transformNodeConfigsToDndNode(nodeConfigs)
    .concat(nonGenericNodeConfig)
    .filter((node) => !nodesDisabled.includes(node.type));
}

export const populateNodeSections = () => {
  const emptyNodeSections: NodeSection[] = [
    {
      label: "Input",
      type: "input",
      icon: BsInputCursorText,
    },
    {
      label: "Processing",
      type: "processing",
      icon: AiOutlineRobot,
    },
    {
      label: "Output",
      type: "output",
      icon: FaToolbox,
    },
  ];
  const nodes = getAllDndNode();

  nodes.forEach((node) => {
    const section = emptyNodeSections.find((sec) => sec.type === node.category);

    if (section) {
      if (!section.nodes) {
        section.nodes = [];
      }
      section.nodes.push(node);
    }
  });

  const sectionFiltered = emptyNodeSections.filter(
    (sec) => sec.nodes && sec.nodes.length > 0,
  );

  for (const sec of sectionFiltered) {
    if (sec.type === "processing") sortSection(sec);
  }

  return sectionFiltered;
};

export function sortSection(
  section: NodeSection,
  lowPriorityPrefixes?: string[],
  highPriorityPrefixes?: string[],
) {
  const lowPriority = lowPriorityPrefixes ?? getLowPriorityNodePrefixes();
  const highPriority = highPriorityPrefixes ?? getHighPriorityNodePrefixes();

  if (section.nodes) {
    section.nodes.sort((a, b) => {
      const getHighPriorityRank = (type: string): number => {
        for (let i = 0; i < highPriority.length; i++) {
          if (type.startsWith(highPriority[i])) {
            return i;
          }
        }
        return -1;
      };

      const isLowPriority = (label: string): boolean =>
        lowPriority.some((prefix: string) =>
          label.toLowerCase().startsWith(prefix.toLowerCase()),
        );

      const aHighRank = getHighPriorityRank(a.type);
      const bHighRank = getHighPriorityRank(b.type);
      const aLow = isLowPriority(a.type);
      const bLow = isLowPriority(b.type);

      // Low priority always goes last
      if (aLow && !bLow) return 1;
      if (!aLow && bLow) return -1;

      // High priority comes first, sorted by priority rank
      if (aHighRank !== -1 && bHighRank !== -1) {
        return aHighRank - bHighRank;
      }
      if (aHighRank !== -1) return -1;
      if (bHighRank !== -1) return 1;

      // All remaining items sorted alphabetically by label
      return a.label.localeCompare(b.label);
    });
  }
}

export const getSections = () => populateNodeSections();
