import { NodeConfig } from "./types";

export const ergonomicCheckNodeConfig: NodeConfig = {
  nodeName: "Ergonomic Check",
  processorType: "ergonomic-check",
  icon: "BsListTask",
  showHandlesNames: true,
  inputNames: ["input_json"],
  fields: [
    {
      name: "input_json",
      label: "Input JSON (optional)",
      type: "input",
      hasHandle: true,
      required: false,
      placeholder: "predictions JSON / any JSON",
    },
  ],
  outputType: "markdown",
  section: "tools",
  category: "processing",
  helpMessage: "(Dummy) returns placeholder ergonomic evaluation for Week 5",
};
