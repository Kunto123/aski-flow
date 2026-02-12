from enum import Enum


class MergeModeEnum(Enum):
    MERGE = 1
    MERGE_AND_PROMPT = 2


class ProcessorType(Enum):
    INPUT_TEXT = "input-text"
    INPUT_IMAGE = "input-image"
    MERGER_PROMPT = "merger-prompt"
    AI_DATA_SPLITTER = "ai-data-splitter"
    TRANSITION = "transition"
    DISPLAY = "display"
    FILE = "file"
    DOCUMENT_TO_TEXT = "document-to-text-processor"
    REPLACE_TEXT = "replace-text"
    UPPERCASE_TEXT = "uppercase-text"
    LOCAL_LLM = "local-llm"
    LOCAL_VISION = "local-vision"
    LOCAL_IMAGE_GENERATION = "local-image-generation"
    LOCAL_EMBEDDING = "local-embedding"
    LOCAL_ASR = "local-asr"
    LOCAL_TTS = "local-tts"
