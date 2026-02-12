import { NodeConfig } from "./types";

export const localEmbeddingNodeConfig: NodeConfig = {
  nodeName: "Local Embedding",
  processorType: "local-embedding",
  icon: "FaProjectDiagram",
  inputNames: ["text"],
  fields: [
    {
      name: "model",
      label: "Model",
      type: "textfield",
      placeholder: "e.g. bge-base",
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
      name: "endpoint_url",
      label: "Endpoint URL",
      type: "textfield",
      placeholder: "http://localhost:8001/embedding",
    },
  ],
  outputType: "markdown",
  showHandlesNames: true,
  section: "models",
};
