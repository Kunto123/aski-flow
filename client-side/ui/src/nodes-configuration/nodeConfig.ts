import { FieldType, NodeConfig } from "./types";
import { getNodeExtensions } from "../api/nodes";
import withCache from "../api/cache/withCache";
import { cameraInputNodeConfig } from "./cameraInputNode";
import { recorderNodeConfig } from "./recorderNode";
import { mainVisionModelNodeConfig } from "./mainVisionModelNode";
import { roiNodeConfig } from "./roiNode";
import { imageProcessingNodeConfig } from "./imageProcessingNode";
import { conditionalStateNodeConfig } from "./conditionalStateNode";
import { pythonCodeNodeConfig } from "./pythonCodeNode";
import { triggerNodeConfig } from "./triggerNode";
import { faceRecognitionNodeConfig } from "./faceRecognitionNode";
import { qrCodeReaderNodeConfig } from "./qrCodeReaderNode";
import { ocrReaderNodeConfig } from "./ocrReaderNode";
import { lampControlNodeConfig } from "./lampControlNode";

export const nodeConfigs: { [key: string]: NodeConfig | undefined } = {
  // Week 5 roadmap nodes
  trigger: triggerNodeConfig,
  "camera-input": cameraInputNodeConfig,
  recorder: recorderNodeConfig,
  "main-vision-model": mainVisionModelNodeConfig,
  roi: roiNodeConfig,
  "image-processing": imageProcessingNodeConfig,
  "conditional-state": conditionalStateNodeConfig,
  "python-code": pythonCodeNodeConfig,
  "face-recognition": faceRecognitionNodeConfig,
  "qr-code-reader": qrCodeReaderNodeConfig,
  "ocr-reader": ocrReaderNodeConfig,
  "lamp-control": lampControlNodeConfig,
  // add other configs here...
};

const fieldTypeWithoutHandle: FieldType[] = [
  "select",
  "option",
  "boolean",
  "slider",
];

export const getConfigViaType = (type: string): NodeConfig | undefined => {
  return structuredClone(nodeConfigs[type]);
};

export const fieldHasHandle = (fieldType: FieldType): boolean => {
  return !fieldTypeWithoutHandle.includes(fieldType);
};

export const loadExtensions = async () => {
  const extensions = await withCache(getNodeExtensions);
  extensions.forEach((extension: NodeConfig) => {
    const key = extension.processorType;
    if (!key) return;
    if (key in nodeConfigs) return;

    // Local-first roadmap UX: hide non-roadmap extension nodes by default.
    // Users can still add their own nodes by using a prefix like "custom-" / "ext-".
    const allowedPrefixes = ["custom-", "ext-"];
    const isAllowed = allowedPrefixes.some((p) => key.startsWith(p));
    if (!isAllowed) return;

    nodeConfigs[key] = extension;
  });
};
