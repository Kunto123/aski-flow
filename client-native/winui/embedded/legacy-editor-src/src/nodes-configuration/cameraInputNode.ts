import { NodeConfig } from "./types";

export const cameraInputNodeConfig: NodeConfig = {
  nodeName: "Camera Input",
  processorType: "camera-input",
  icon: "FaCamera",
  fields: [
    {
      name: "camera_index",
      label: "Camera Index (ID Kamera)",
      description:
        "Pilih nomor perangkat kamera. Umumnya 0 untuk kamera utama, 1/2 untuk kamera eksternal lain.",
      type: "numericfield",
      defaultValue: 0,
      min: 0,
      step: 1,
    },
    {
      name: "width",
      label: "Width (Lebar Frame)",
      description:
        "Lebar resolusi video dalam piksel. Kosongkan agar mengikuti resolusi native kamera.",
      type: "numericfield",
      min: 1,
      step: 1,
    },
    {
      name: "height",
      label: "Height (Tinggi Frame)",
      description:
        "Tinggi resolusi video dalam piksel. Kosongkan agar mengikuti resolusi native kamera.",
      type: "numericfield",
      min: 1,
      step: 1,
    },
    {
      name: "fps",
      label: "FPS (Frame per Detik)",
      description:
        "Jumlah frame per detik. Kosongkan agar mengikuti FPS native kamera.",
      type: "numericfield",
      min: 1,
      step: 1,
    },
  ],
  outputType: "fileUrl",
  section: "input",
  category: "input",
  helpMessage: "Camera input stream source",
};
