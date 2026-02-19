import { NodeConfig } from "./types";

export const mainVisionModelNodeConfig: NodeConfig = {
  nodeName: "Main Vision Model",
  processorType: "main-vision-model",
  icon: "FaEye",
  showHandlesNames: true,
  inputNames: ["input_url"],
  fields: [
    {
      name: "input_url",
      label: "Input URL / Stream Ref",
      type: "input",
      hasHandle: true,
      required: true,
      placeholder: "/asset/file.jpg or stream://<id>",
    },
    {
      name: "model_path",
      label: "Model Path",
      type: "textfield",
      defaultValue: "models/yolov5mu.pt",
      placeholder: "e.g. models/yolov5mu.pt",
    },
    {
      name: "conf_threshold",
      label: "Confidence",
      type: "numericfield",
      defaultValue: 0.25,
      min: 0,
      max: 1,
      step: 0.01,
      allowDecimal: true,
    },
    {
      name: "classes",
      label: "Classes Filter (optional)",
      type: "list",
      defaultValue: [],
      placeholder: "e.g. person,car or 0,2",
    },
  ],
  outputType: "markdown",
  section: "models",
  category: "processing",
  helpMessage:
    "Run YOLO on file or stream. Local-first: model_path must exist locally (no auto-download).",
};
