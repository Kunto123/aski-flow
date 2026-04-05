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

  const getUserAuthToken = useCallback((): string => {
    if (typeof window === "undefined") {
      return "";
    }
    return String(localStorage.getItem("aski_auth_token") || "").trim();
  }, []);

  // RV-004: forward the stable native clientId when running inside the desktop
  // bridge so that the backend can use one canonical runtime session identity
  // across socket events, camera uploads, and disconnect cleanup.
  // Returns empty string in web-browser mode (no bridge present).
  const getDesktopClientId = useCallback((): string => {
    if (typeof window === "undefined") {
      return "";
    }
    return String(window.askiDesktop?.clientId || "").trim();
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
    const userToken = getUserAuthToken();
    const clientId = getDesktopClientId();
    const connectionOptions =
      authToken.length > 0 || userToken.length > 0 || clientId.length > 0
        ? {
            auth: {
              ...(authToken.length > 0 ? { auth_token: authToken } : {}),
              ...(userToken.length > 0 ? { user_token: userToken } : {}),
              ...(clientId.length > 0 ? { client_id: clientId } : {}),
            },
            query: {
              ...(authToken.length > 0 ? { auth_token: authToken } : {}),
              ...(userToken.length > 0 ? { user_token: userToken } : {}),
              // client_id in query survives into request.args for all socket
              // event handlers including disconnect (RV-004).
              ...(clientId.length > 0 ? { client_id: clientId } : {}),
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

      // Baca token fresh setiap kali dipanggil (termasuk saat reconnect) agar
      // tidak mengirim token basi dari closure saat socket pertama kali dibuat.
      const freshAuthToken = getDesktopAuthToken();
      const freshUserToken = getUserAuthToken();
      if (freshAuthToken.length > 0) {
        (appConfig as any).auth_token = freshAuthToken;
      }
      if (freshUserToken.length > 0) {
        (appConfig as any).user_token = freshUserToken;
      }
      newSocket.emit("update_app_config", appConfig);
    };

    // Fire on the very first connection and on every reconnection.
    newSocket.on("connect", sendAppConfig);

    socketRef.current = newSocket;
    setSocket(newSocket);
    return newSocket;
  }, [getDesktopAuthToken, getUserAuthToken]);

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
    const userToken = getUserAuthToken();
    const clientId = getDesktopClientId();
    const payload: Record<string, any> = {
      ...event.data,
      parameters: getConfigParametersFlat(),
    };
    if (authToken.length > 0) {
      payload.auth_token = authToken;
    }
    if (userToken.length > 0) {
      payload.user_token = userToken;
    }
    // RV-004: include client_id in every event payload so the backend can
    // resolve the canonical runtime session identity from event_data even
    // when the handshake query string is not inspected.
    if (clientId.length > 0) {
      payload.client_id = clientId;
    }

    activeSocket.emit(event.name, payload);
    return true;
  }, [getActiveSocket, getDesktopAuthToken, getUserAuthToken, getDesktopClientId]);

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
