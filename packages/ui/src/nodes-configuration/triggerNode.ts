import { NodeConfig } from "./types";

export const triggerNodeConfig: NodeConfig = {
  nodeName: "Trigger",
  processorType: "trigger",
  icon: "MdOutlineBolt",
  inputNames: [],
  fields: [
    {
      name: "payload",
      label: "Payload (optional)",
      type: "textfield",
      required: false,
      placeholder: "e.g. start",
      defaultValue: "",
    },
  ],
  outputType: "markdown",
  section: "input",
  category: "input",
  helpMessage: "Manual trigger to start a chain (Week 5)",
};
