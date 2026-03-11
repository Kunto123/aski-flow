/// <reference types="vite/client" />

interface AskiDesktopRuntimeConfig {
  isDesktop: boolean;
  serverHost?: string;
  serverPort?: string;
  useHttps?: string;
  clientId?: string;
  authToken?: string;
}

interface Window {
  askiDesktop?: AskiDesktopRuntimeConfig;
}
