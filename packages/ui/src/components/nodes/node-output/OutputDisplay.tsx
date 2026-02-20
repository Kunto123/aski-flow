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

  useEffect(() => {
    if (indexDisplayed < normalizedOutputs.length) return;
    setIndexDisplayed(0);
  }, [indexDisplayed, normalizedOutputs.length]);

  const nbOutput = normalizedOutputs.length > 0 ? normalizedOutputs.length : 1;

  const getCurrentOutput = (): string => {
    if (normalizedOutputs.length === 0) return "";
    return normalizedOutputs[indexDisplayed] ?? normalizedOutputs[0] ?? "";
  };

  const getOutputComponent = () => {
    if (getOutputComponentOverride) {
      const override = getOutputComponentOverride(data, getOutputType());
      if (override) {
        return override;
      }
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
      {nbOutput > 1 && typeof data.outputData !== "string" && (
        <div
          className={`flex flex-row items-center justify-center gap-1 overflow-x-auto p-1 ${fitInContainer ? "mt-0 shrink-0" : "mt-2"}`}
        >
          {normalizedOutputs.map((output, index) => (
            <button
              key={`${index}-${output.slice(0, 48)}`}
              className={`rounded-full ${index === indexDisplayed ? "bg-orange-400" : "bg-gray-500 hover:bg-orange-200"} whitespace-nowrap p-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400`}
              onClick={() => setIndexDisplayed(index)}
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
