import { NodeConfig } from "./types";

export const pythonCodeNodeConfig: NodeConfig = {
  nodeName: "Python Code",
  processorType: "python-code",
  icon: "BsRegex",
  showHandlesNames: true,
  inputNames: ["payload"],
  fields: [
    {
      name: "payload",
      label: "Payload (any)",
      type: "textarea",
      hasHandle: true,
      placeholder: "JSON string recommended",
      withModalEdit: true,
    },
    {
      name: "code",
      label: "Python code",
      type: "textarea",
      required: true,
      defaultValue:
        "# payload is available\n# set result (JSON-serializable)\nresult = {\"ok\": True, \"payload\": payload}\n",
      withModalEdit: true,
    },
    {
      name: "timeout_sec",
      label: "Timeout (sec)",
      type: "numericfield",
      defaultValue: 3,
      min: 0.5,
      max: 60,
      step: 0.5,
      allowDecimal: true,
    },
  ],
  outputType: "text",
  section: "tools",
  category: "processing",
  helpMessage: "Run local python snippet in a subprocess (timeout-limited). Set 'result' variable to output JSON.",
};
