import { NodeConfig } from "./types";

export const conditionalStateNodeConfig: NodeConfig = {
  nodeName: "Conditional State",
  processorType: "conditional-state",
  icon: "FaRandom",
  inputNames: ["value"],
  fields: [
    {
      name: "value",
      label: "Value",
      type: "textarea",
      hasHandle: true,
      required: true,
      placeholder: "Any value or JSON string",
      withModalEdit: true,
    },
    {
      name: "json_path",
      label: "JSON path (optional)",
      type: "input",
      placeholder: "e.g. boxes.0.conf",
    },
    {
      name: "operator",
      label: "Operator",
      type: "select",
      defaultValue: "exists",
      options: [
        { label: "exists", value: "exists" },
        { label: "equals", value: "equals" },
        { label: "not equals", value: "not_equals" },
        { label: "contains", value: "contains" },
        { label: "greater than", value: "gt" },
        { label: "less than", value: "lt" },
      ],
    },
    {
      name: "compare_value",
      label: "Compare value",
      type: "input",
      placeholder: "Used for equals/contains/gt/lt",
    },
  ],
  // Router has 2 outputs (true/false). We still render as text.
  outputType: "text",
  section: "tools",
  category: "processing",
  helpMessage: "Route based on a simple condition (true output index 0, false output index 1)",
  showHandlesNames: true,
};
