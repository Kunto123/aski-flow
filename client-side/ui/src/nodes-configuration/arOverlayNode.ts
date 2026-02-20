import { NodeConfig } from "./types";

export const arOverlayNodeConfig: NodeConfig = {
  nodeName: "AR Overlay",
  processorType: "ar-overlay",
  icon: "MdOutlineCrop",
  showHandlesNames: true,
  inputNames: ["image_url", "predictions_json"],
  fields: [
    {
      name: "image_url",
      label: "Image URL",
      type: "input",
      hasHandle: true,
      required: true,
      placeholder: "/asset/<image>.jpg",
    },
    {
      name: "predictions_json",
      label: "Predictions JSON",
      type: "textarea",
      hasHandle: true,
      required: true,
      placeholder: "{\"boxes\": [...]}",
      withModalEdit: true,
    },
  ],
  outputType: "imageUrl",
  section: "tools",
  category: "processing",
  helpMessage: "Draw AR overlay boxes using predictions JSON",
};
