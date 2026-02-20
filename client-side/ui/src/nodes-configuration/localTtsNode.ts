import { NodeConfig } from "./types";

export const localTtsNodeConfig: NodeConfig = {
  nodeName: "Local TTS",
  processorType: "local-tts",
  icon: "FaFilm",
  inputNames: ["text"],
  fields: [
    {
      name: "model",
      label: "Model",
      type: "textfield",
      placeholder: "e.g. xtts-v2",
    },
    {
      name: "text",
      label: "Text",
      type: "textarea",
      required: true,
      hasHandle: true,
      placeholder: "Enter text",
    },
    {
      name: "voice",
      label: "Voice",
      type: "textfield",
      placeholder: "Optional",
    },
    {
      name: "speed",
      label: "Speed",
      type: "numericfield",
      defaultValue: 1.0,
      min: 0.5,
      max: 2.0,
      step: 0.1,
      allowDecimal: true,
    },
    {
      name: "endpoint_url",
      label: "Endpoint URL",
      type: "textfield",
      placeholder: "http://localhost:8001/tts",
    },
  ],
  outputType: "audioUrl",
  showHandlesNames: true,
  section: "models",
};
