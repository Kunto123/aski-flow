import { NodeConfig } from "./types";

export const imageProcessingNodeConfig: NodeConfig = {
  nodeName: "Image Processing",
  processorType: "image-processing",
  icon: "FiFilter",
  showHandlesNames: true,
  inputNames: ["input_url"],
  fields: [
    {
      name: "input_url",
      label: "Input (asset or stream)",
      type: "input",
      hasHandle: true,
      required: true,
      placeholder: "/asset/<image>.jpg or stream://<id>",
    },
    {
      name: "resize_width",
      label: "Resize width (px)",
      type: "inputInt",
      placeholder: "e.g. 640",
    },
    {
      name: "resize_height",
      label: "Resize height (px)",
      type: "inputInt",
      placeholder: "e.g. 480",
    },
    {
      name: "grayscale",
      label: "Grayscale",
      type: "boolean",
      defaultValue: false,
    },
    {
      name: "blur",
      label: "Gaussian blur (kernel)",
      type: "inputInt",
      placeholder: "0 = off, 3/5/7...",
    },
    {
      name: "threshold",
      label: "Binary threshold (0-255)",
      type: "inputInt",
      placeholder: "leave empty to disable",
    },
  ],
  outputType: "imageUrl",
  section: "tools",
  category: "processing",
  helpMessage: "Basic image ops (resize/grayscale/blur/threshold)",
};
