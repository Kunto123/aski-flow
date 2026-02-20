import { NodeConfig } from "./types";

export const localAsrNodeConfig: NodeConfig = {
  nodeName: "Local ASR",
  processorType: "local-asr",
  icon: "FaPlay",
  inputNames: ["audio_url"],
  fields: [
    {
      name: "model",
      label: "Model",
      type: "textfield",
      placeholder: "e.g. whisper-large-v3",
    },
    {
      name: "audio_url",
      label: "Audio",
      type: "fileUpload",
      hasHandle: true,
      required: true,
      placeholder: "Audio URL",
      canAddChildrenFields: true,
    },
    {
      name: "language",
      label: "Language",
      type: "textfield",
      placeholder: "Optional (e.g. en, id)",
    },
    {
      name: "endpoint_url",
      label: "Endpoint URL",
      type: "textfield",
      placeholder: "http://localhost:8001/asr",
    },
  ],
  outputType: "markdown",
  showHandlesNames: true,
  section: "models",
};
