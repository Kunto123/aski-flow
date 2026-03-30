import { NodeConfig } from "./types";

export const stickerValidatorNodeConfig: NodeConfig = {
  nodeName: "Sticker Validator",
  processorType: "sticker-validator",
  icon: "FaCheckCircle",
  showHandlesNames: true,
  inputNames: [
    "detections_payload",
    "roi_dimensions",
    "part_ready_result",
  ],
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
    {
      name: "part_ready_result",
      label: "Part Ready Gate (from Part Ready Validator)",
      type: "input",
      hasHandle: true,
      required: false,
      placeholder: "Optional: connect from Part Ready Validator output",
      description:
        "Jika dihubungkan, stiker hanya divalidasi saat part_ready = true. " +
        "Jika part_ready = false → REJECT / PART_NOT_READY tanpa menjalankan validasi stiker.",
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
    // ── Confidence check ───────────────────────────────────────────────────
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
  ],
  outputType: "markdown",
  section: "models",
  category: "processing",
  helpMessage:
    "Validates sticker detections against an inspection recipe. " +
    "Expected center otomatis diambil dari dimensi frame aktual model (bukan preview ROI), " +
    "sehingga offset selalu konsisten dengan koordinat deteksi. " +
    "MPCheck dan Operator User ID otomatis diambil dari akun yang sedang login. " +
    "Kosongkan Max Offset X/Y untuk skip position check. " +
    "Kosongkan Min Class Confidence untuk skip confidence check. " +
    "OPSIONAL: hubungkan output Part Ready Validator ke 'Part Ready Gate' — jika part_ready = false, " +
    "hasil langsung REJECT / PART_NOT_READY tanpa menjalankan validasi stiker. " +
    "data1 = sticker confidence, data2 = part-ready confidence (jika gate aktif). " +
    "Output ACCEPT/REJECT — hubungkan ke inspection-db-writer untuk menyimpan hasil.",
};
