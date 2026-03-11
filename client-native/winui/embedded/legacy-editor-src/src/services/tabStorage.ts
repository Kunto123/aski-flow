import { FlowTab } from "../layout/main-layout/AppLayout";

const LOCAL_STORAGE_TAB_KEY = "flowTabs";
const LOCAL_STORAGE_CURRENT_TAB_KEY = "currentTab";

export function getCurrentTabIndex() {
  const savedTabIndex = localStorage.getItem(LOCAL_STORAGE_CURRENT_TAB_KEY);
  if (!savedTabIndex) return undefined;
  return savedTabIndex;
}

export function saveCurrentTabIndex(index: number) {
  localStorage.setItem(LOCAL_STORAGE_CURRENT_TAB_KEY, index.toString());
}

export function getLocalTabs() {
  const savedTabs = localStorage.getItem(LOCAL_STORAGE_TAB_KEY);
  if (!savedTabs) return undefined;
  return JSON.parse(savedTabs)?.tabs as FlowTab[];
}

/**
 * Runtime-only keys that must NOT be persisted to localStorage.
 * These are ephemeral session state – restoring them after a refresh
 * causes stale checkmarks, ghost outputs, and unwanted auto-reruns.
 */
const RUNTIME_STATE_KEYS: ReadonlySet<string> = new Set([
  "outputData",
  "lastRun",
  "isDone",
  "isRunning",
  "startup_status",
  "startup_deferred",
  "error",
  "warning",
]);

function stripRuntimeState(node: any): any {
  if (!node?.data) return node;
  const cleanData = { ...node.data };
  for (const key of RUNTIME_STATE_KEYS) {
    delete cleanData[key];
  }
  return { ...node, data: cleanData };
}

export function saveTabsLocally(tabs: FlowTab[]) {
  if (!tabs) return;
  if (tabs.length >= 1 && tabs[0].nodes.length !== 0) {
    const cleanTabs = tabs.map((tab) => ({
      ...tab,
      nodes: tab.nodes.map(stripRuntimeState),
    }));
    const tabsToStore = { tabs: cleanTabs };
    localStorage.setItem(LOCAL_STORAGE_TAB_KEY, JSON.stringify(tabsToStore));
  }
}

export async function getAllTabs() {
  const savedFlowTabs = getLocalTabs();
  return savedFlowTabs ?? [];
}
