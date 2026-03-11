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
    {
      name: "show_advanced",
      label: "Advanced Settings",
      type: "switch",
      defaultValue: false,
    },
    {
      name: "draw_boxes",
      label: "Draw Boxes (stream preview)",
      type: "switch",
      defaultValue: true,
      condition: {
        field: "show_advanced",
        operator: "equals",
        value: true,
      },
    },
    {
      name: "draw_text",
      label: "Draw Decoded Text (preview)",
      type: "switch",
      defaultValue: false,
      description:
        "Keep OFF for clearer preview. Read/copy decoded QR text from Output 1.",
      condition: {
        field: "show_advanced",
        operator: "equals",
        value: true,
      },
    },
  ],
  outputType: "markdown",
  section: "tools",
  category: "processing",
  helpMessage:
    "Reads QR codes from image/stream. Output 1 = decoded text (recommended for readability), Output 2 = preview media/stream.",
};
