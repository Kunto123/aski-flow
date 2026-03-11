import { useContext, useEffect, useRef } from "react";
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
  const onProgressRef = useRef(onProgress);
  const onErrorRef = useRef(onError);
  const onRunEndRef = useRef(onRunEnd);
  const onCurrentNodeRunningRef = useRef(onCurrentNodeRunning);
  const onDisconnectRef = useRef(onDisconnect);
  const onConnectRef = useRef(onConnect);

  useEffect(() => {
    onProgressRef.current = onProgress;
    onErrorRef.current = onError;
    onRunEndRef.current = onRunEnd;
    onCurrentNodeRunningRef.current = onCurrentNodeRunning;
    onDisconnectRef.current = onDisconnect;
    onConnectRef.current = onConnect;
  }, [onProgress, onError, onRunEnd, onCurrentNodeRunning, onDisconnect, onConnect]);

  useEffect(() => {
    if (socket) {
      const handleProgress = (data: ProgressData) => onProgressRef.current(data);
      const handleError = (data: ErrorData) => onErrorRef.current(data);
      const handleRunEnd = () => onRunEndRef.current();
      const handleCurrentNodeRunning = (data: CurrentNodeRunningData) =>
        onCurrentNodeRunningRef.current(data);
      const handleConnect = () => onConnectRef.current?.();
      const handleDisconnect = (reason: string) =>
        (onDisconnectRef.current ? onDisconnectRef.current(reason) : defaultOnDisconnect(reason));

      socket.on("progress", handleProgress);
      socket.on("error", handleError);
      socket.on("run_end", handleRunEnd);
      socket.on("current_node_running", handleCurrentNodeRunning);
      socket.on("connect", handleConnect);
      socket.on(
        "disconnect",
        handleDisconnect,
      );

      return () => {
        socket.off("progress", handleProgress);
        socket.off("error", handleError);
        socket.off("run_end", handleRunEnd);
        socket.off("current_node_running", handleCurrentNodeRunning);
        socket.off("connect", handleConnect);
        socket.off(
          "disconnect",
          handleDisconnect,
        );
      };
    }
  }, [socket, t]);

  function defaultOnDisconnect(reason: string) {
    if (reason === "transport close") {
      toastInfoMessage(t("socketConnectionLost"), "socket-connection-lost");
    }
  }
};
