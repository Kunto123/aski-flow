import { NodeConfig } from "./types";

export const partReadyValidatorNodeConfig: NodeConfig = {
  nodeName: "Part Ready Validator",
  processorType: "part-ready-validator",
  icon: "FaCheckCircle",
  showHandlesNames: true,
  inputNames: ["roi_input"],
  fields: [
    {
      name: "roi_input",
      label: "ROI Input (from ROI node output[0])",
      type: "input",
      hasHandle: true,
      required: true,
      placeholder: "Connect from ROI node output[0]",
    },
    // ── Reference color profile (pilih dari registry) ──────────────────────
    {
      name: "color_profile_id",
      label: "Color Profile",
      type: "colorProfileSelect",
      defaultValue: null,
      description:
        "Pilih profile warna referensi yang dibuat di Workstation › Color Calibrate.",
    },
    // ── Match config ───────────────────────────────────────────────────────
    {
      name: "min_match_ratio",
      label: "Min Match Ratio (Override)",
      type: "numericfield",
      defaultValue: null,
      min: 0,
      max: 1,
      step: 0.01,
      allowDecimal: true,
      description:
        "Opsional: override min_match_ratio dari profile. Kosongkan untuk pakai nilai dari profile.",
    },
  ],
  outputType: "markdown",
  section: "models",
  category: "processing",
  helpMessage:
    "Validates that the part is present in the ROI based on a reference color profile. " +
    "1) Buka Workstation › Color Calibrate, upload foto part, gambar snippet, klik Compute, beri nama, klik Save. " +
    "2) Pilih profile dari dropdown 'Color Profile' di node ini. " +
    "Output: part_ready (bool), data2 = match_ratio (confidence score 0–1). " +
    "Hubungkan ke inspection-db-writer untuk menyimpan hasil.",
};
