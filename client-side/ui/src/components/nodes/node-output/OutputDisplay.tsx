import MarkdownOutput from "./MarkdownOutput";
import { NodeData } from "../types/node";
import { useTranslation } from "react-i18next";
import { FiFile } from "react-icons/fi";
import ImageUrlOutput from "./ImageUrlOutput";
import ImageBase64Output from "./ImageBase64Output";
import VideoUrlOutput from "./VideoUrlOutput";
import AudioUrlOutput from "./AudioUrlOutput";
import {
  getOutputExtension,
  isStreamUrl,
  normalizeStreamOutputUrl,
} from "./outputUtils";
import PdfUrlOutput from "./PdfUrlOutput";
import { OutputType } from "../../../nodes-configuration/types";
import { useContext, useEffect, useMemo, useState } from "react";
import ThreeDimensionalUrlOutput from "./ThreeDimensionalUrlOutput";
import { SocketContext } from "../../../providers/SocketProvider";

interface OutputDisplayProps {
  data: NodeData;
  fitInContainer?: boolean;
  fitMode?: "contain" | "cover" | "fill";
  getOutputComponentOverride?: (
    data: NodeData,
    outputType: OutputType,
  ) => JSX.Element | null;
}

type PredictionsSubscriber = (payload: any) => void;
type PredictionsPoller = {
  url: string;
  listeners: Set<PredictionsSubscriber>;
  intervalId: number | null;
  inFlight: boolean;
};

const SHARED_PREDICTIONS_POLL_INTERVAL_MS = 700;
const sharedPredictionsPollers = new Map<string, PredictionsPoller>();

function subscribeSharedPredictions(
  url: string,
  listener: PredictionsSubscriber,
): () => void {
  if (!url) return () => undefined;

  let poller = sharedPredictionsPollers.get(url);

  if (!poller) {
    poller = {
      url,
      listeners: new Set(),
      intervalId: null,
      inFlight: false,
    };

    const poll = async () => {
      if (!poller || poller.inFlight) return;
      poller.inFlight = true;
      try {
        const response = await fetch(url, {
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        });
        if (!response.ok) return;
        const payload = await response.json();
        for (const cb of Array.from(poller.listeners)) {
          try {
            cb(payload);
          } catch {
            // ignore listener errors
          }
        }
      } catch {
        // Ignore transient network/socket issues.
      } finally {
        if (poller) {
          poller.inFlight = false;
        }
      }
    };

    poller.intervalId = window.setInterval(() => {
      void poll();
    }, SHARED_PREDICTIONS_POLL_INTERVAL_MS);
    void poll();
    sharedPredictionsPollers.set(url, poller);
  }

  poller.listeners.add(listener);

  return () => {
    const current = sharedPredictionsPollers.get(url);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    if (current.intervalId != null) {
      window.clearInterval(current.intervalId);
    }
    sharedPredictionsPollers.delete(url);
  };
}

function isPlaceholderDetectionText(text: string): boolean {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) return true;
  return (
    normalized.includes("no qr code detected") ||
    normalized.includes("no text detected") ||
    normalized.includes("waiting for source frames") ||
    normalized.includes("warming up") ||
    normalized.includes("qr decoding failed") ||
    normalized.includes("ocr failed")
  );
}

export default function OutputDisplay({
  data,
  fitInContainer = false,
  fitMode = "contain",
  getOutputComponentOverride,
}: OutputDisplayProps) {
  const { t } = useTranslation("flow");
  const { socket } = useContext(SocketContext);
  const upstreamProcessorTypeForDisplay = (data as any)?.upstreamProcessorTypeForDisplay;
  const effectiveProcessorTypeForDisplay =
    upstreamProcessorTypeForDisplay ?? data.processorType;
  const effectiveTextFirstProcessorType =
    effectiveProcessorTypeForDisplay;
  const isMainVisionModel = effectiveProcessorTypeForDisplay === "main-vision-model";
  const preferTextFirst =
    effectiveTextFirstProcessorType === "ocr-reader" ||
    effectiveTextFirstProcessorType === "qr-code-reader";

  const [indexDisplayed, setIndexDisplayed] = useState(0);
  const [liveTextOverride, setLiveTextOverride] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState<boolean>(() => {
    try {
      return !!socket?.isConnected?.();
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!socket) {
      setSocketConnected(false);
      return;
    }

    const syncState = () => {
      try {
        setSocketConnected(!!socket.isConnected());
      } catch {
        setSocketConnected(false);
      }
    };
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);

    syncState();
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [socket]);

  const normalizedOutputs = useMemo(() => {
    if (!data.outputData) return [] as string[];

    const rawOutputs =
      typeof data.outputData === "string" ? [data.outputData] : data.outputData;
    const deduped: string[] = [];
    const seen = new Set<string>();

    rawOutputs.forEach((item) => {
      if (item == null) return;

      let normalized = "";
      if (typeof item === "string") {
        normalized = normalizeStreamOutputUrl(item).trim();
      } else {
        try {
          normalized = JSON.stringify(item, null, 2);
        } catch {
          normalized = String(item);
        }
      }

      if (!normalized) return;
      if (seen.has(normalized)) return;
      seen.add(normalized);
      deduped.push(normalized);
    });

    return deduped;
  }, [data.outputData]);

  const streamPredictionsUrl = useMemo(() => {
    if (!preferTextFirst) return null;
    if (normalizedOutputs.length < 2) return null;

    const streamOutput = normalizedOutputs.find((value) => isStreamUrl(value));
    if (!streamOutput) return null;

    const normalized = normalizeStreamOutputUrl(streamOutput);

    try {
      const parsed = new URL(
        normalized,
        typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1",
      );
      const match = parsed.pathname.match(/^\/stream\/([^/.?]+)\.(mjpg|mjpeg)$/i);
      if (!match?.[1]) return null;
      return `${parsed.origin}/stream/${match[1]}/predictions.json`;
    } catch {
      const match = normalized.match(/\/stream\/([^/.?]+)\.(mjpg|mjpeg)(\?.*)?$/i);
      if (!match?.[1]) return null;
      return normalized.replace(
        /\/stream\/([^/.?]+)\.(mjpg|mjpeg)(\?.*)?$/i,
        `/stream/${match[1]}/predictions.json`,
      );
    }
  }, [preferTextFirst, normalizedOutputs]);

  useEffect(() => {
    setLiveTextOverride(null);
  }, [streamPredictionsUrl, effectiveTextFirstProcessorType]);

  const baseSelectorOutputs = useMemo(() => {
    if (isMainVisionModel && normalizedOutputs.length > 1) {
      return [normalizedOutputs[0]];
    }
    if (preferTextFirst && normalizedOutputs.length > 1) {
      const rank = (value: string) =>
        getOutputExtension(value) === "markdown" ? 0 : 1;
      return [...normalizedOutputs].sort((a, b) => rank(a) - rank(b));
    }
    return normalizedOutputs;
  }, [isMainVisionModel, normalizedOutputs, preferTextFirst]);

  const primaryTextCandidate = useMemo(() => {
    if (!preferTextFirst) return "";
    if (baseSelectorOutputs.length === 0) return "";
    return String(baseSelectorOutputs[0] ?? "").trim();
  }, [preferTextFirst, baseSelectorOutputs]);

  const shouldPollPredictions = useMemo(() => {
    if (!streamPredictionsUrl || !preferTextFirst) return false;
    if (indexDisplayed !== 0) return false;
    if (!socketConnected) return true;
    return isPlaceholderDetectionText(primaryTextCandidate);
  }, [
    streamPredictionsUrl,
    preferTextFirst,
    indexDisplayed,
    socketConnected,
    primaryTextCandidate,
  ]);

  useEffect(() => {
    if (shouldPollPredictions) return;
    // Prefer canonical socket-driven output when fallback polling is not needed.
    setLiveTextOverride(null);
  }, [shouldPollPredictions, primaryTextCandidate, socketConnected]);

  useEffect(() => {
    if (!streamPredictionsUrl || !shouldPollPredictions) return;
    if (typeof window === "undefined" || typeof fetch === "undefined") return;

    const extractLiveText = (payload: any): string | null => {
      if (!payload || typeof payload !== "object") return null;

      if (effectiveTextFirstProcessorType === "qr-code-reader") {
        const text = String(payload.qr_text ?? "").trim();
        if (text) return text;
        const msg = String(payload.error ?? payload.message ?? "").trim();
        return msg || null;
      }

      if (effectiveTextFirstProcessorType === "ocr-reader") {
        const text = String(payload.text ?? "").trim();
        if (text) return text;
        const msg = String(payload.error ?? payload.message ?? "").trim();
        return msg || null;
      }

      return null;
    };

    return subscribeSharedPredictions(streamPredictionsUrl, (payload) => {
      const liveText = extractLiveText(payload);
      if (!liveText) return;
      setLiveTextOverride((prev) => (prev === liveText ? prev : liveText));
    });
  }, [streamPredictionsUrl, shouldPollPredictions, effectiveTextFirstProcessorType]);

  const selectorOutputs = useMemo(() => {
    if (preferTextFirst && baseSelectorOutputs.length > 1) {
      const sorted = [...baseSelectorOutputs];
      if (liveTextOverride) {
        const next = [...sorted];
        next[0] = liveTextOverride;
        return next;
      }
      return sorted;
    }
    return baseSelectorOutputs;
  }, [preferTextFirst, baseSelectorOutputs, liveTextOverride]);

  useEffect(() => {
    if (indexDisplayed < selectorOutputs.length) return;
    setIndexDisplayed(0);
  }, [indexDisplayed, selectorOutputs.length]);

  const nbOutput = selectorOutputs.length > 0 ? selectorOutputs.length : 1;

  const getCurrentOutput = (): string => {
    if (selectorOutputs.length === 0) return "";
    return selectorOutputs[indexDisplayed] ?? selectorOutputs[0] ?? "";
  };

  const getMainVisionCombinedOutput = () => {
    if (normalizedOutputs.length === 0) return <></>;

    const jsonRaw = normalizedOutputs[0] ?? "";
    const sceneRaw = normalizedOutputs[1] ?? "";

    let prettyJson = jsonRaw;
    try {
      prettyJson = JSON.stringify(JSON.parse(jsonRaw), null, 2);
    } catch {
      // keep raw text
    }

    const jsonMarkdown = `\`\`\`json\n${prettyJson}\n\`\`\``;
    const sceneType = getOutputExtension(sceneRaw);

    const renderScene = () => {
      switch (sceneType) {
        case "imageUrl":
          return (
            <ImageUrlOutput
              url={sceneRaw}
              name={data.name}
              fitInContainer={fitInContainer}
              fitMode={fitMode}
            />
          );
        case "videoUrl":
          return (
            <VideoUrlOutput
              url={sceneRaw}
              name={data.name}
              fitInContainer={fitInContainer}
              fitMode={fitMode}
            />
          );
        default:
          return (
            <MarkdownOutput
              data={sceneRaw}
              name={data.name}
              appearance={data.appearance}
              fitInContainer={fitInContainer}
            />
          );
      }
    };

    return (
      <div
        className={`flex w-full ${fitInContainer ? "h-full min-h-0 flex-col overflow-hidden" : "flex-col gap-2"}`}
      >
        {sceneRaw && (
          <div
            className={
              fitInContainer
                ? "min-h-0 flex-1 overflow-hidden"
                : ""
            }
          >
            {renderScene()}
          </div>
        )}
        <div
          className={
            fitInContainer
              ? "max-h-[42%] shrink-0 overflow-auto border-t border-slate-700/50 pt-1"
              : ""
          }
        >
          <MarkdownOutput
            data={jsonMarkdown}
            name={data.name}
            appearance={data.appearance}
            fitInContainer={fitInContainer}
          />
        </div>
      </div>
    );
  };

  const getOutputComponent = () => {
    if (getOutputComponentOverride) {
      const override = getOutputComponentOverride(data, getOutputType());
      if (override) {
        return override;
      }
    }

    if (isMainVisionModel && normalizedOutputs.length > 1) {
      return getMainVisionCombinedOutput();
    }

    if (normalizedOutputs.length === 0) return <></>;

    const output = getCurrentOutput();
    const isReadableOcrQrTextOutput =
      preferTextFirst &&
      selectorOutputs.length > 1 &&
      indexDisplayed === 0;
    const readableTextAppearance = isReadableOcrQrTextOutput
      ? {
          ...data.appearance,
          fontSize: Math.max(Number(data.appearance?.fontSize ?? 0), 1.5),
        }
      : data.appearance;

    switch (getOutputType()) {
      case "imageUrl":
        return (
          <ImageUrlOutput
            url={output}
            name={data.name}
            fitInContainer={fitInContainer}
            fitMode={fitMode}
          />
        );
      case "imageBase64":
        return (
          <ImageBase64Output
            data={output}
            name={data.name}
            lastRun={data.lastRun}
            fitInContainer={fitInContainer}
            fitMode={fitMode}
          />
        );
      case "videoUrl":
        return (
          <VideoUrlOutput
            url={output}
            name={data.name}
            fitInContainer={fitInContainer}
            fitMode={fitMode}
          />
        );
      case "audioUrl":
        return <AudioUrlOutput url={output} name={data.name} />;
      case "3dUrl":
        return <ThreeDimensionalUrlOutput url={output} name={data.name} />;
      case "pdfUrl":
        return <PdfUrlOutput url={output} name={data.name} />;
      case "fileUrl":
        return (
          <a href={output} target="_blank" rel="noreferrer">
            <div className="flex flex-row items-center justify-center space-x-2 py-2 hover:text-sky-400">
              <FiFile className="text-4xl" />
              <p>{t("FileUploaded")}</p>
            </div>
          </a>
        );
      default:
        return (
          <MarkdownOutput
            data={output}
            name={data.name}
            appearance={readableTextAppearance}
            fitInContainer={fitInContainer}
          />
        );
    }
  };

  function getOutputType(): OutputType {
    const output = getCurrentOutput();
    if (!output) {
      return "markdown";
    }

    // OCR/QR readers reserve output #1 for decoded text (which may look like a
    // URL, e.g. QR payload). Keep it rendered as text in both node preview and
    // Display nodes connected downstream.
    if (
      preferTextFirst &&
      selectorOutputs.length > 1 &&
      indexDisplayed === 0
    ) {
      return "markdown";
    }

    const inferredType = getOutputExtension(output);

    // For multi-output nodes, infer type from the currently selected output item
    // to support mixed output content (e.g. JSON + stream URL in one node).
    if (typeof data.outputData !== "string") {
      return inferredType;
    }

    // Prefer inferred media/file type over stale config outputType.
    // This keeps stream/media rendering stable for legacy node configs.
    if (inferredType !== "markdown") {
      return inferredType;
    }

    if (data.config?.outputType && data.config.outputType !== "markdown") {
      return data.config.outputType;
    }

    return inferredType;
  }

  return (
    <div
      className={`flex h-full w-full flex-col ${fitInContainer ? "min-h-0 overflow-hidden" : ""}`}
    >
      {(nbOutput > 1 || (isMainVisionModel && normalizedOutputs.length > 1)) &&
        typeof data.outputData !== "string" && (
        <div
          className={`flex flex-row items-center justify-center gap-1 overflow-x-auto p-1 ${fitInContainer ? "mt-0 shrink-0" : "mt-2"}`}
        >
          {(isMainVisionModel && normalizedOutputs.length > 1
            ? [selectorOutputs[0] ?? ""]
            : selectorOutputs
          ).map((output, index) => (
            <button
              key={`${index}-${output.slice(0, 48)}`}
              className={`rounded-full ${isMainVisionModel ? "bg-orange-400" : index === indexDisplayed ? "bg-orange-400" : "bg-gray-500 hover:bg-orange-200"} whitespace-nowrap p-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400`}
              onClick={() => {
                if (isMainVisionModel) return;
                setIndexDisplayed(index);
              }}
              aria-label={`View output ${index + 1}`}
              title={`Output ${index + 1}`}
            />
          ))}
        </div>
      )}
      <div className={fitInContainer ? "min-h-0 flex-1 overflow-hidden" : ""}>
        {getOutputComponent()}
      </div>
    </div>
  );
}
