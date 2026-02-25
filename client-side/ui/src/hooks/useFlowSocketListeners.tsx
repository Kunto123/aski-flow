import { useContext, useEffect } from "react";
import { SocketContext } from "../providers/SocketProvider";
import { useTranslation } from "react-i18next";
import { toastInfoMessage } from "../utils/toastUtils";

export const useSocketListeners = <
  ProgressData,
  ErrorData,
  CurrentNodeRunningData,
>(
  onProgress: (data: ProgressData) => void,
  onError: (data: ErrorData) => void,
  onRunEnd: () => void,
  onCurrentNodeRunning: (data: CurrentNodeRunningData) => void,
  onDisconnect?: (reason: string) => void,
  onConnect?: () => void,
) => {
  const { t } = useTranslation("flow");
  const { socket } = useContext(SocketContext);

  useEffect(() => {
    if (socket) {
      socket.on("progress", onProgress);
      socket.on("error", onError);
      socket.on("run_end", onRunEnd);
      socket.on("current_node_running", onCurrentNodeRunning);
      if (onConnect) {
        socket.on("connect", onConnect);
      }
      socket.on(
        "disconnect",
        onDisconnect ? onDisconnect : defaultOnDisconnect,
      );
    }

    return () => {
      if (socket) {
        socket.off("progress", onProgress);
        socket.off("error", onError);
        socket.off("run_end", onRunEnd);
        socket.off("current_node_running", onCurrentNodeRunning);
        if (onConnect) {
          socket.off("connect", onConnect);
        }
        socket.off(
          "disconnect",
          onDisconnect ? onDisconnect : defaultOnDisconnect,
        );
      }
    };
  }, [
    socket,
    onProgress,
    onError,
    onRunEnd,
    onCurrentNodeRunning,
    onDisconnect,
    onConnect,
  ]);

  function defaultOnDisconnect(reason: string) {
    if (reason === "transport close") {
      toastInfoMessage(t("socketConnectionLost"), "socket-connection-lost");
    }
  }
};
