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
import { useState } from "react";
import ThreeDimensionalUrlOutput from "./ThreeDimensionalUrlOutput";

interface OutputDisplayProps {
  data: NodeData;
  getOutputComponentOverride?: (
    data: NodeData,
    outputType: OutputType,
  ) => JSX.Element | null;
}

export default function OutputDisplay({
  data,
  getOutputComponentOverride,
}: OutputDisplayProps) {
  const { t } = useTranslation("flow");

  const [indexDisplayed, setIndexDisplayed] = useState(0);

  const nbOutput =
    data.outputData != null && typeof data.outputData !== "string"
      ? data.outputData.length
      : 1;

  const getCurrentOutput = (): string => {
    if (!data.outputData) return "";
    if (typeof data.outputData === "string") {
      return normalizeStreamOutputUrl(data.outputData);
    }
    const output = data.outputData[indexDisplayed] ?? "";
    return normalizeStreamOutputUrl(output);
  };

  const getOutputComponent = () => {
    if (getOutputComponentOverride) {
      const override = getOutputComponentOverride(data, getOutputType());
      if (override) {
        return override;
      }
    }

    if (!data.outputData) return <></>;

    const output = getCurrentOutput();

    switch (getOutputType()) {
      case "imageUrl":
        return <ImageUrlOutput url={output} name={data.name} />;
      case "imageBase64":
        return (
          <ImageBase64Output
            data={output}
            name={data.name}
            lastRun={data.lastRun}
          />
        );
      case "videoUrl":
        return <VideoUrlOutput url={output} name={data.name} />;
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
    <div className="flex h-full w-full flex-col">
      {nbOutput > 1 && typeof data.outputData !== "string" && (
        <div className="mt-2 flex flex-row items-center justify-center gap-1 overflow-x-auto p-1">
          {data?.outputData?.map((output, index) => (
            <button
              key={index}
              className={`rounded-full ${index === indexDisplayed ? "bg-orange-400" : "bg-gray-500 hover:bg-orange-200"} whitespace-nowrap p-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400`}
              onClick={() => setIndexDisplayed(index)}
              aria-label={`View output ${index + 1}`}
              title={`Output ${index + 1}`}
            />
          ))}
        </div>
      )}
      {getOutputComponent()}
    </div>
  );
}
