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
      name: "roi_dimensions",
      label: "ROI Dimensions (from ROI node)",
      type: "input",
      hasHandle: true,
      placeholder: "Connect from ROI node output → auto-isi expected center",
    },
    // ── Quick config ───────────────────────────────────────────────────────
    {
      name: "part_name",
      label: "Part Name",
      type: "textfield",
      defaultValue: "",
      placeholder: "e.g. Sticker Bagasi Kiri",
    },
    {
      name: "expected_class",
      label: "Expected Class",
      type: "textfield",
      defaultValue: "",
      placeholder: "e.g. K0W-HB0",
    },
    {
      name: "line",
      label: "Line ID",
      type: "textfield",
      defaultValue: "",
      placeholder: "e.g. LINE-1",
    },
    // ── Position checks ────────────────────────────────────────────────────
    {
      name: "max_offset_x",
      label: "Max Offset X (px)",
      type: "numericfield",
      defaultValue: null,
      min: 0,
      step: 1,
      allowDecimal: true,
    },
    {
      name: "max_offset_y",
      label: "Max Offset Y (px)",
      type: "numericfield",
      defaultValue: null,
      min: 0,
      step: 1,
      allowDecimal: true,
    },
    // ── Confidence / angle checks ──────────────────────────────────────────
    {
      name: "min_class_confidence",
      label: "Min Class Confidence",
      type: "numericfield",
      defaultValue: null,
      min: 0,
      max: 1,
      step: 0.01,
      allowDecimal: true,
      description: "Kosongkan untuk skip check ini",
    },
    {
      name: "max_angle_deg",
      label: "Max Angle Deviation (deg)",
      type: "numericfield",
      defaultValue: null,
      min: 0,
      step: 1,
      allowDecimal: true,
      description: "Kosongkan untuk skip angle check",
    },
    {
      name: "expected_angle_deg",
      label: "Expected Angle (deg)",
      type: "numericfield",
      defaultValue: 0,
      step: 1,
      allowDecimal: true,
      description: "Sudut referensi untuk perbandingan angle (default 0)",
    },
  ],
  outputType: "markdown",
  section: "models",
  category: "processing",
  helpMessage:
    "Validates sticker detections against an inspection recipe. " +
    "Hubungkan output[1] dari ROI node ke 'ROI Dimensions' agar expected center otomatis terisi (cx = W/2, cy = H/2). " +
    "MPCheck dan Operator User ID otomatis diambil dari akun yang sedang login. " +
    "Kosongkan Min Class Confidence / Max Angle untuk skip check tersebut. " +
    "Output ACCEPT/REJECT — hubungkan ke inspection-db-writer untuk menyimpan hasil.",
};
