import { NodeConfig } from "./types";

export const stickerValidatorNodeConfig: NodeConfig = {
  nodeName: "Sticker Validator",
  processorType: "sticker-validator",
  icon: "FaCheckCircle",
  showHandlesNames: true,
  inputNames: ["detections_payload"],
  fields: [
    {
      name: "detections_payload",
      label: "Detections Input (from vision model)",
      type: "input",
      hasHandle: true,
      required: true,
      placeholder: "Connect from main-vision-model output",
    },
    {
      name: "line",
      label: "Line ID",
      type: "textfield",
      defaultValue: "",
      placeholder: "e.g. LINE-1",
    },
    {
      name: "mp_check",
      label: "MP Check",
      type: "textfield",
      defaultValue: "",
      placeholder: "e.g. OPERATOR-01",
    },
    {
      name: "template_version_id",
      label: "Template Version ID",
      type: "numericfield",
      defaultValue: null,
      min: 1,
      step: 1,
      allowDecimal: false,
    },
    {
      name: "inspection_recipe",
      label: "Inspection Recipe (JSON)",
      type: "textarea",
      defaultValue:
        '{\n  "part_name": "",\n  "targets": [\n    {\n      "target_id": "sticker-1",\n      "expected_class": "",\n      "min_roi_confidence": 0.5,\n      "min_class_confidence": null,\n      "max_offset_x": null,\n      "max_offset_y": null,\n      "max_angle_deg": null\n    }\n  ]\n}',
      withModalEdit: true,
      placeholder: "Paste JSON recipe di sini",
    },
  ],
  outputType: "markdown",
  section: "models",
  category: "processing",
  helpMessage:
    "Validates sticker detections against an inspection recipe. " +
    "Outputs ACCEPT/REJECT decision with per-target details. " +
    "Connect to inspection-db-writer to persist results.",
};
