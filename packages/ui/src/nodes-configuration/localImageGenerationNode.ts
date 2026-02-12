import { NodeConfig } from "./types";

const localImageGenerationNodeConfig: NodeConfig = {
  nodeName: "Local Image Gen",
  processorType: "local-image-generation",
  icon: "FaImage",
  inputNames: ["prompt"],
  fields: [
    {
      name: "model",
      label: "Model",
      type: "textfield",
      placeholder: "e.g. sd-xl",
    },
    {
      name: "prompt",
      label: "Prompt",
      type: "textarea",
      required: true,
      hasHandle: true,
      placeholder: "Enter prompt",
    },
    {
      name: "negative_prompt",
      label: "Negative Prompt",
      type: "textarea",
      placeholder: "Optional",
    },
    {
      name: "width",
      label: "Width",
      type: "numericfield",
      defaultValue: 1024,
      min: 64,
      step: 1,
    },
    {
      name: "height",
      label: "Height",
      type: "numericfield",
      defaultValue: 1024,
      min: 64,
      step: 1,
    },
    {
      name: "steps",
      label: "Steps",
      type: "numericfield",
      defaultValue: 30,
      min: 1,
      step: 1,
    },
    {
      name: "guidance",
      label: "Guidance",
      type: "numericfield",
      defaultValue: 7.5,
      min: 0,
      max: 20,
      step: 0.1,
      allowDecimal: true,
    },
    {
      name: "seed",
      label: "Seed",
      type: "numericfield",
      min: 0,
      step: 1,
    },
    {
      name: "endpoint_url",
      label: "Endpoint URL",
      type: "textfield",
      placeholder: "http://localhost:8001/image",
    },
  ],
  outputType: "imageUrl",
  section: "models",
  helpMessage: "stableDiffusionPromptHelp",
  showHandlesNames: true,
};

export default localImageGenerationNodeConfig;
