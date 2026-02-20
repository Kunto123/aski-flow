import MarkdownOutput from "./MarkdownOutput";
import { NodeData } from "../types/node";
import { useTranslation } from "react-i18next";
import { FiFile } from "react-icons/fi";
import ImageUrlOutput from "./ImageUrlOutput";
import ImageBase64Output from "./ImageBase64Output";
import VideoUrlOutput from "./VideoUrlOutput";
import AudioUrlOutput from "./AudioUrlOutput";
import { getOutputExtension, normalizeStreamOutputUrl } from "./outputUtils";
import PdfUrlOutput from "./PdfUrlOutput";
import { OutputType } from "../../../nodes-configuration/types";
import { useEffect, useMemo, useState } from "react";
import ThreeDimensionalUrlOutput from "./ThreeDimensionalUrlOutput";

interface OutputDisplayProps {
  data: NodeData;
  fitInContainer?: boolean;
  fitMode?: "contain" | "cover" | "fill";
  getOutputComponentOverride?: (
    data: NodeData,
    outputType: OutputType,
  ) => JSX.Element | null;
}

export default function OutputDisplay({
  data,
  fitInContainer = false,
  fitMode = "contain",
  getOutputComponentOverride,
}: OutputDisplayProps) {
  const { t } = useTranslation("flow");
  const isMainVisionModel = data.processorType === "main-vision-model";

  const [indexDisplayed, setIndexDisplayed] = useState(0);

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

  const selectorOutputs = useMemo(() => {
    if (isMainVisionModel && normalizedOutputs.length > 1) {
      return [normalizedOutputs[0]];
    }
    return normalizedOutputs;
  }, [isMainVisionModel, normalizedOutputs]);

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
        <div className={fitInContainer ? "shrink-0 overflow-auto" : ""}>
          <MarkdownOutput
            data={jsonMarkdown}
            name={data.name}
            appearance={data.appearance}
            fitInContainer={fitInContainer}
          />
        </div>
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
            appearance={data.appearance}
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
