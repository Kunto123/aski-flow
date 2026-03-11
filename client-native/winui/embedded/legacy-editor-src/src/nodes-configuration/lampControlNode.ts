import { NodeConfig } from "./types";

export const lampControlNodeConfig: NodeConfig = {
  nodeName: "Lamp Control",
  processorType: "lamp-control",
  icon: "MdOutlineBolt",
  showHandlesNames: true,
  inputNames: ["state"],
  fields: [
    {
      name: "state",
      label: "State",
      type: "textfield",
      hasHandle: true,
      required: true,
      defaultValue: "off",
      placeholder: "on / off",
    },
  ],
  outputType: "markdown",
  section: "output",
  category: "output",
  helpMessage: "(Dummy) local device control placeholder (Week 5)",
};
