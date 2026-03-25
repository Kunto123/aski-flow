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
    // ── Single-target quick config ─────────────────────────────────────────
    {
      name: "part_name",
      label: "Part Name",
      type: "textfield",
      defaultValue: "",
      placeholder: "e.g. Sticker Bagasi Kiri",
    },
    {
      name: "target_id",
      label: "Target ID",
      type: "textfield",
      defaultValue: "target-1",
      placeholder: "e.g. sticker-1",
    },
    {
      name: "expected_class",
      label: "Expected Class",
      type: "textfield",
      defaultValue: "",
      placeholder: "e.g. K0W-HB0",
    },
    {
      name: "min_roi_confidence",
      label: "Min ROI Confidence",
      type: "numericfield",
      defaultValue: 0.5,
      min: 0,
      max: 1,
      step: 0.01,
      allowDecimal: true,
    },
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
    // ── ROI auto-center: fill these to match your ROI node's Width/Height ──
    // expected_cx = roi_output_width / 2, expected_cy = roi_output_height / 2
    {
      name: "roi_output_width",
      label: "ROI Width (px)",
      type: "numericfield",
      defaultValue: null,
      min: 1,
      step: 1,
      allowDecimal: false,
      description: "Isi sesuai Width di ROI node → auto-hitung expected center X",
    },
    {
      name: "roi_output_height",
      label: "ROI Height (px)",
      type: "numericfield",
      defaultValue: null,
      min: 1,
      step: 1,
      allowDecimal: false,
      description: "Isi sesuai Height di ROI node → auto-hitung expected center Y",
    },
    // ── Operator / metadata ────────────────────────────────────────────────
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
    // ── Advanced: multi-target JSON override ──────────────────────────────
    // Jika diisi dan mengandung "targets", field di atas diabaikan.
    {
      name: "inspection_recipe",
      label: "Advanced: Inspection Recipe (JSON)",
      type: "textarea",
      defaultValue: "",
      withModalEdit: true,
      placeholder:
        'Opsional — isi untuk multi-target atau konfigurasi lanjutan.\n' +
        'Contoh: {"part_name":"...","targets":[{"target_id":"...","expected_class":"...",...}]}',
    },
  ],
  outputType: "markdown",
  section: "models",
  category: "processing",
  helpMessage:
    "Validates sticker detections against an inspection recipe. " +
    "Isi field di atas untuk konfigurasi single-target. " +
    "ROI Width/Height otomatis menghitung expected center deteksi (cx = W/2, cy = H/2). " +
    "Gunakan Advanced JSON untuk multi-target. " +
    "Outputs ACCEPT/REJECT — connect ke inspection-db-writer untuk menyimpan hasil.",
};
