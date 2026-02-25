import { NodeConfig } from "./types";

export const qrCodeReaderNodeConfig: NodeConfig = {
  nodeName: "QR Code Reader",
  processorType: "qr-code-reader",
  icon: "BsJson",
  showHandlesNames: true,
  inputNames: ["input_url"],
  fields: [
    {
      name: "input_url",
      label: "Input (asset or stream)",
      type: "input",
      hasHandle: true,
      required: true,
      placeholder: "/asset/<image>.jpg or stream://<id>",
    },
  ],
  outputType: "markdown",
  section: "tools",
  category: "processing",
  helpMessage:
    "Reads QR codes from image/stream. Output 1 = decoded text, Output 2 = media/stream passthrough.",
};
