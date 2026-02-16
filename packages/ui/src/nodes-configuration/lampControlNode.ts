import { NodeConfig } from "./types";

export const lampControlNodeConfig: NodeConfig = {
  nodeName: "Lamp Control",
  processorType: "lamp-control",
  icon: "MdOutlineBolt",
  inputNames: ["state"],
  fields: [
    {
      name: "state",
      label: "State",
      type: "textfield",
      required: true,
      defaultValue: "off",
      placeholder: "on / off",
    },
  ],
  outputType: "markdown",
  section: "tools",
  category: "output",
  helpMessage: "(Dummy) local device control placeholder (Week 5)",
};
