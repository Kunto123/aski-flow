import {
  createContext,
  useCallback,
  useEffect,
  ReactNode,
  useRef,
  useState,
} from "react";
import { io } from "socket.io-client";
import { getWsUrl } from "../config/config";
import {
  Parameters,
  getConfigParametersFlat,
} from "../components/popups/config-popup/parameters";
import { FlowEventOut, FlowSocket } from "../sockets/flowSocket";

import { FlowMetadata } from "../layout/main-layout/AppLayout";
import { AppConfig } from "../components/popups/config-popup/configMetadata";

export interface FlowEventData {
  jsonFile: string;
  nodeName?: string;
  metadata?: FlowMetadata;
}

export interface FlowEvent {
  name: FlowEventOut;
  data: FlowEventData;
}

export type WSConfiguration = {
  parameters?: Parameters;
};

interface ISocketContext {
  socket: FlowSocket | null;
  config: WSConfiguration | null;
  updateSocket: (config?: WSConfiguration) => void;
  emitEvent: (event: FlowEvent) => boolean;
  getSocket: () => FlowSocket | null;
  connect: () => void;
  disconnect: () => void;
}

interface SocketProviderProps {
  children: ReactNode;
}

export const SocketContext = createContext<ISocketContext>({
  socket: null,
  config: null,
  updateSocket: (config?: WSConfiguration) => {},
  emitEvent: (event: FlowEvent) => false,
  getSocket: () => null,
  connect: () => {},
  disconnect: () => {},
});

export const SocketProvider = ({ children }: SocketProviderProps) => {
  const initialConfig: WSConfiguration = {};
  const [socket, setSocket] = useState<FlowSocket | null>(null);
  const [config, setConfig] = useState<WSConfiguration | null>(initialConfig);
  const socketRef = useRef<FlowSocket | null>(null);
  const configRef = useRef<WSConfiguration | null>(initialConfig);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, []);

  const getDesktopAuthToken = useCallback((): string => {
    if (typeof window === "undefined") {
      return "";
    }
    return String(window.askiDesktop?.authToken || "").trim();
  }, []);

  const createNewSocket = useCallback((configuration?: WSConfiguration) => {
    if (configuration) {
      configRef.current = configuration;
      setConfig(configuration);
    }

    if (socketRef.current) {
      return socketRef.current;
    }

    const authToken = getDesktopAuthToken();
    const connectionOptions =
      authToken.length > 0
        ? {
            auth: {
              auth_token: authToken,
            },
            query: {
              auth_token: authToken,
            },
          }
        : undefined;

    const newSocket = connectionOptions
      ? new FlowSocket(io(getWsUrl(), connectionOptions))
      : new FlowSocket(io(getWsUrl()));

    const sendAppConfig = () => {
      let appConfig: Partial<AppConfig> = {};
      try {
        appConfig = JSON.parse(localStorage.getItem("appConfig") || "{}");
      } catch (error) {
        appConfig = {};
      }

      if (authToken.length > 0) {
        (appConfig as any).auth_token = authToken;
      }
      newSocket.emit("update_app_config", appConfig);
    };

    // Fire on the very first connection and on every reconnection.
    newSocket.on("connect", sendAppConfig);

    socketRef.current = newSocket;
    setSocket(newSocket);
    return newSocket;
  }, [getDesktopAuthToken]);

  const getActiveSocket = useCallback((): FlowSocket | null => {
    if (socketRef.current) {
      return socketRef.current;
    }
    if (!configRef.current) {
      return null;
    }
    return createNewSocket(configRef.current);
  }, [createNewSocket]);

  const updateSocket = useCallback((nextConfig?: WSConfiguration): void => {
    if (nextConfig) {
      configRef.current = nextConfig;
      setConfig(nextConfig);
    }

    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
      setSocket(null);
      if (configRef.current) {
        createNewSocket(configRef.current);
      }
    }
  }, [createNewSocket]);

  const emitEvent = useCallback((event: FlowEvent): boolean => {
    const activeSocket = getActiveSocket();
    if (!activeSocket) {
      return false;
    }

    const authToken = getDesktopAuthToken();
    const payload: Record<string, any> = {
      ...event.data,
      parameters: getConfigParametersFlat(),
    };
    if (authToken.length > 0) {
      payload.auth_token = authToken;
    }

    activeSocket.emit(event.name, payload);
    return true;
  }, [getActiveSocket, getDesktopAuthToken]);

  const connect = useCallback(() => {
    const activeSocket = getActiveSocket();
    activeSocket?.connect();
  }, [getActiveSocket]);

  const getSocket = useCallback((): FlowSocket | null => {
    return getActiveSocket();
  }, [getActiveSocket]);

  const disconnect = useCallback(() => {
    const activeSocket = socketRef.current;
    if (activeSocket) {
      activeSocket.disconnect();
    }
  }, []);

  return (
    <SocketContext.Provider
      value={{
        socket,
        config,
        updateSocket,
        emitEvent,
        getSocket,
        connect,
        disconnect,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};
