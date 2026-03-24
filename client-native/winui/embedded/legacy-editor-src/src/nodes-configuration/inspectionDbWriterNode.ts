import { NodeConfig } from "./types";

export const inspectionDbWriterNodeConfig: NodeConfig = {
  nodeName: "Inspection DB Writer",
  processorType: "inspection-db-writer",
  icon: "FaDatabase",
  showHandlesNames: true,
  inputNames: ["validator_result"],
  fields: [
    {
      name: "validator_result",
      label: "Validator Result",
      type: "input",
      hasHandle: true,
      required: true,
      placeholder: "Connect from sticker-validator output",
    },
    {
      name: "deployment_id",
      label: "Deployment ID (optional)",
      type: "numericfield",
      defaultValue: null,
      min: 1,
      step: 1,
      allowDecimal: false,
      description:
        "If set, station_id and line_id are resolved from the active deployment.",
    },
    {
      name: "operator_id",
      label: "Operator User ID (optional)",
      type: "numericfield",
      defaultValue: null,
      min: 1,
      step: 1,
      allowDecimal: false,
    },
    {
      name: "bucket_granularity",
      label: "Counter Bucket Granularity",
      type: "select",
      defaultValue: "hour",
      options: [
        { label: "Minute", value: "minute" },
        { label: "Hour", value: "hour", default: true },
        { label: "Day", value: "day" },
      ],
    },
  ],
  outputType: "markdown",
  section: "output",
  category: "output",
  helpMessage:
    "Writes inspection results to SQL Server and enqueues an outbox row. " +
    "Also updates the inspection counter bucket for dashboard aggregation.",
};
