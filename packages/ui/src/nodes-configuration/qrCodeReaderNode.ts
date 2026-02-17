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
  helpMessage: "(Dummy) passthrough for Week 5 – implementation Week 6",
};
