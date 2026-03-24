from enum import Enum


class MergeModeEnum(Enum):
    MERGE = 1
    MERGE_AND_PROMPT = 2


class ProcessorType(Enum):
    INPUT_TEXT = "input-text"
    INPUT_IMAGE = "input-image"
    CAMERA_INPUT = "camera-input"
    MERGER_PROMPT = "merger-prompt"
    AI_DATA_SPLITTER = "ai-data-splitter"
    TRANSITION = "transition"
    DISPLAY = "display"
    FILE = "file"
    RECORDER = "recorder"
    DOCUMENT_TO_TEXT = "document-to-text-processor"
    REPLACE_TEXT = "replace-text"
    UPPERCASE_TEXT = "uppercase-text"
    LOCAL_LLM = "local-llm"
    LOCAL_VISION = "local-vision"
    LOCAL_IMAGE_GENERATION = "local-image-generation"
    LOCAL_EMBEDDING = "local-embedding"
    LOCAL_ASR = "local-asr"
    LOCAL_TTS = "local-tts"
    MAIN_VISION_MODEL = "main-vision-model"
    ROI = "roi"
    IMAGE_PROCESSING = "image-processing"
    CONDITIONAL_STATE = "conditional-state"
    PYTHON_CODE = "python-code"
    STICKER_VALIDATOR = "sticker-validator"
    INSPECTION_DB_WRITER = "inspection-db-writer"
