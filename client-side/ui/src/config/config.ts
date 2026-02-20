const desktopRuntime = window.askiDesktop;
const HOST = desktopRuntime?.serverHost || import.meta.env.VITE_APP_WS_HOST || "localhost";
const WS_PORT = desktopRuntime?.serverPort || import.meta.env.VITE_APP_WS_PORT || 8000;
const REST_API_PORT =
  desktopRuntime?.serverPort || import.meta.env.VITE_APP_API_REST_PORT || 8000;
const USE_HTTPS = desktopRuntime?.useHttps || import.meta.env.VITE_APP_USE_HTTPS || "false";
const USE_CACHE = import.meta.env.VITE_APP_USE_CACHE?.toLowerCase() || "true";
const CURRENT_APP_VERSION = import.meta.env.VITE_APP_VERSION;
const DEFAULT_NODES_HIDDEN_LIST =
  import.meta.env.VITE_APP_DEFAULT_NODES_HIDDEN_LIST || "";
const ENABLE_CLOUD = import.meta.env.VITE_APP_ENABLE_CLOUD?.toLowerCase() || "false";

const LOW_PRIORITY_NODE_PREFIXES_RAW =
  import.meta.env.VITE_APP_LOW_PRIORITY_PREFIXES || "";
const HIGH_PRIORITY_NODE_PREFIXES_RAW =
  import.meta.env.VITE_APP_HIGH_PRIORITY_PREFIXES || "local";

const IS_DEV = import.meta.env.VITE_APP_IS_DEV?.toLowerCase() === "true";
const protocol = USE_HTTPS.toLowerCase() === "true" ? "https" : "http";

export const getWsUrl = () => `${protocol}://${HOST}:${WS_PORT}`;
export const getRestApiUrl = () => `${protocol}://${HOST}:${REST_API_PORT}`;
export const isCacheEnabled = () => USE_CACHE === "true";
export const getCurrentAppVersion = () => CURRENT_APP_VERSION;
export const getDefaultNodesHiddenList = () =>
  DEFAULT_NODES_HIDDEN_LIST.split(",") as string[];
export const isCloudEnabled = () => ENABLE_CLOUD === "true";

export const isDev = () => IS_DEV;

export const getLowPriorityNodePrefixes = () =>
  LOW_PRIORITY_NODE_PREFIXES_RAW.split(";") as string[];
export const getHighPriorityNodePrefixes = () =>
  HIGH_PRIORITY_NODE_PREFIXES_RAW.split(";") as string[];
