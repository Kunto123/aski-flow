/// <reference types="vite/client" />

interface AskiDesktopRuntimeConfig {
  isDesktop: boolean;
  serverHost?: string;
  serverPort?: string;
  useHttps?: string;
}

interface Window {
  askiDesktop?: AskiDesktopRuntimeConfig;
}
