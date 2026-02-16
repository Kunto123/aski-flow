import inputTextNodeConfig from "./inputTextNode";
import { localLlmNodeConfig } from "./localLlmNode";
import { localVisionNodeConfig } from "./localVisionNode";
import localImageGenerationNodeConfig from "./localImageGenerationNode";
import { localEmbeddingNodeConfig } from "./localEmbeddingNode";
import { localAsrNodeConfig } from "./localAsrNode";
import { localTtsNodeConfig } from "./localTtsNode";
import { mergerPromptNode } from "./mergerPromptNode";
import { FieldType, NodeConfig } from "./types";
import { getNodeExtensions } from "../api/nodes";
import withCache from "../api/cache/withCache";
import { cameraInputNodeConfig } from "./cameraInputNode";
import { recorderNodeConfig } from "./recorderNode";
import { mainVisionModelNodeConfig } from "./mainVisionModelNode";
import { arOverlayNodeConfig } from "./arOverlayNode";
import { roiNodeConfig } from "./roiNode";
import { imageProcessingNodeConfig } from "./imageProcessingNode";
import { conditionalStateNodeConfig } from "./conditionalStateNode";
import { pythonCodeNodeConfig } from "./pythonCodeNode";

export const nodeConfigs: { [key: string]: NodeConfig | undefined } = {
  "input-text": inputTextNodeConfig,
  "local-llm": localLlmNodeConfig,
  "local-vision": localVisionNodeConfig,
  "local-image-generation": localImageGenerationNodeConfig,
  "local-embedding": localEmbeddingNodeConfig,
  "local-asr": localAsrNodeConfig,
  "local-tts": localTtsNodeConfig,
  "merger-prompt": mergerPromptNode,
  "camera-input": cameraInputNodeConfig,
  recorder: recorderNodeConfig,
  "main-vision-model": mainVisionModelNodeConfig,
  "ar-overlay": arOverlayNodeConfig,
  roi: roiNodeConfig,
  "image-processing": imageProcessingNodeConfig,
  "conditional-state": conditionalStateNodeConfig,
  "python-code": pythonCodeNodeConfig,
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

    nodeConfigs[key] = extension;
  });
};
