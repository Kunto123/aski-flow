import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FiDatabase,
  FiEdit3,
  FiLayers,
  FiMaximize2,
  FiMinimize2,
  FiRefreshCw,
  FiTrash2,
  FiUploadCloud,
} from "react-icons/fi";
import { MdOutlineModelTraining } from "react-icons/md";
import {
  createDataset,
  deleteDataset,
  deleteDatasetFiles,
  listDatasetFiles,
  listDatasets,
  uploadDatasetFiles,
  type DatasetFileItem,
  type DatasetUploadKind,
  type DatasetUploadTarget,
  type DatasetSummary,
} from "../../../api/datasets";
import {
  cancelAugmentationJob,
  createAugmentationJob,
  deleteAugmentationJob,
  listAugmentationJobs,
  listAugmentationTechniques,
  type AugmentationJob,
  type AugmentationTechnique,
} from "../../../api/augmentation";
import {
  deleteImageAnnotationLabels,
  getImageAnnotationLabels,
  listAnnotationImages,
  saveImageAnnotationLabels,
  updateAnnotationClasses,
  type AnnotateImageItem,
  type AnnotationBox,
  type AnnotationStatusFilter,
} from "../../../api/annotations";
import {
  deleteServerModelFile,
  getServerModelFiles,
  renameServerModelFile,
  uploadServerModelFiles,
  type ServerModelFile,
} from "../../../api/models";
import {
  cancelTrainingJob,
  createTrainingJob,
  deleteTrainingJob,
  getTrainingJobLog,
  listTrainingArchitectures,
  listTrainingJobs,
  type TrainingArchitectureItem,
  type TrainingJob,
} from "../../../api/training";

export type WorkstationSection =
  | "upload-data"
  | "annotate"
  | "dataset"
  | "augment"
  | "train"
  | "models";

type WorkstationItem = {
  id: WorkstationSection;
  label: string;
};

export const WORKSTATION_ITEMS: WorkstationItem[] = [
  { id: "upload-data", label: "Upload Data" },
  { id: "annotate", label: "Annotate" },
  { id: "dataset", label: "Dataset" },
  { id: "augment", label: "Augment" },
  { id: "train", label: "Train" },
  { id: "models", label: "Models" },
];

const DATASET_UPLOAD_KIND_CONFIG: Record<
  DatasetUploadKind,
  {
    label: string;
    target: DatasetUploadTarget;
    accept: string;
    extensions: readonly string[];
  }
> = {
  image: {
    label: "image",
    target: "images",
    accept: ".jpg,.jpeg,.png,.bmp,.gif,.webp,.tif,.tiff",
    extensions: [".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp", ".tif", ".tiff"],
  },
  video: {
    label: "video",
    target: "videos",
    accept: ".mp4,.avi,.mov,.mkv,.webm,.mpeg,.mpg,.wmv,.m4v",
    extensions: [".mp4", ".avi", ".mov", ".mkv", ".webm", ".mpeg", ".mpg", ".wmv", ".m4v"],
  },
  file: {
    label: "file",
    target: "exports",
    accept: ".txt,.json,.csv,.xml,.yaml,.yml,.pdf,.zip,.rar,.7z",
    extensions: [".txt", ".json", ".csv", ".xml", ".yaml", ".yml", ".pdf", ".zip", ".rar", ".7z"],
  },
  dll: {
    label: "dll",
    target: "exports",
    accept: ".dll",
    extensions: [".dll"],
  },
};

function isAllowedExtension(fileName: string, allowed: readonly string[]) {
  const normalized = fileName.toLowerCase();
  return allowed.some((ext) => normalized.endsWith(ext));
}

interface WorkstationSidebarProps {
  activeSection: WorkstationSection;
  onSelect: (section: WorkstationSection) => void;
}

export function WorkstationSidebar({
  activeSection,
  onSelect,
}: WorkstationSidebarProps) {
  return (
    <div className="aski-ws-sidebar">
      <div className="aski-ws-sidebar-title">Data</div>
      <div className="aski-ws-sidebar-list">
        {WORKSTATION_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`aski-ws-nav-btn ${activeSection === item.id ? "active" : ""}`}
            onClick={() => onSelect(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface WorkstationMainProps {
  activeSection: WorkstationSection;
}

interface AnnotatePanelProps {
  datasets: DatasetSummary[];
  isLoading: boolean;
  errorMessage: string;
  onRefresh: () => Promise<void>;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

type NormalizedPoint = { x: number; y: number };
type BoxEditMode = "move" | "resize-nw" | "resize-ne" | "resize-sw" | "resize-se";

const MIN_ANNOTATE_BOX_SIZE = 0.01;

function cloneBoxes(items: AnnotationBox[]): AnnotationBox[] {
  return items.map((item) => ({ ...item }));
}

function AnnotatePanel({
  datasets,
  isLoading,
  errorMessage,
  onRefresh,
}: AnnotatePanelProps) {
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [statusFilter, setStatusFilter] = useState<AnnotationStatusFilter>("all");
  const [images, setImages] = useState<AnnotateImageItem[]>([]);
  const [stats, setStats] = useState({ all: 0, done: 0, unassigned: 0 });
  const [imagesError, setImagesError] = useState("");
  const [isImagesLoading, setIsImagesLoading] = useState(false);
  const [selectedImageName, setSelectedImageName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [annotatedImageUrl, setAnnotatedImageUrl] = useState("");
  const [isStageMaximized, setIsStageMaximized] = useState(false);
  const [boxes, setBoxes] = useState<AnnotationBox[]>([]);
  const [savedBoxes, setSavedBoxes] = useState<AnnotationBox[]>([]);
  const [selectedBoxIndex, setSelectedBoxIndex] = useState(-1);
  const [isLabelsLoading, setIsLabelsLoading] = useState(false);
  const [isSavingLabels, setIsSavingLabels] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [classNames, setClassNames] = useState<string[]>([]);
  const [classDraft, setClassDraft] = useState("");
  const [currentClassId, setCurrentClassId] = useState(0);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const [boxEditState, setBoxEditState] = useState<{
    index: number;
    mode: BoxEditMode;
    start: NormalizedPoint;
    initialBox: AnnotationBox;
  } | null>(null);
  const imageElementRef = useRef<HTMLImageElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const selectedImage = useMemo(
    () => images.find((item) => item.name === selectedImageName),
    [images, selectedImageName],
  );

  const selectedImageIndex = useMemo(
    () => images.findIndex((item) => item.name === selectedImageName),
    [images, selectedImageName],
  );

  useEffect(() => {
    if (!datasets.length) {
      setSelectedDatasetId("");
      setImages([]);
      setSelectedImageName("");
      return;
    }
    const stillExists = datasets.some((dataset) => dataset.id === selectedDatasetId);
    if (!stillExists) {
      setSelectedDatasetId(datasets[0].id);
    }
  }, [datasets, selectedDatasetId]);

  useEffect(() => {
    if (classNames.length === 0) return;
    if (currentClassId < 0 || currentClassId >= classNames.length) {
      setCurrentClassId(0);
    }
  }, [classNames, currentClassId]);

  const refreshImages = useCallback(async () => {
    if (!selectedDatasetId) {
      setImages([]);
      setStats({ all: 0, done: 0, unassigned: 0 });
      setSelectedImageName("");
      setBoxes([]);
      setSavedBoxes([]);
      setSelectedBoxIndex(-1);
      setAnnotatedImageUrl("");
      setClassNames([]);
      setClassDraft("");
      return;
    }

    setIsImagesLoading(true);
    setImagesError("");
    try {
      const response = await listAnnotationImages(
        selectedDatasetId,
        statusFilter,
        1,
        500,
      );
      const fetchedImages = Array.isArray(response.images) ? response.images : [];
      setImages(fetchedImages);
      setStats(response.stats || { all: 0, done: 0, unassigned: 0 });
      const classes = Array.isArray(response.classes) ? response.classes : [];
      setClassNames(classes);
      setClassDraft(classes.join(", "));

      const stillSelected = fetchedImages.some(
        (item) => item.name === selectedImageName,
      );
      if (!stillSelected) {
        setSelectedImageName(fetchedImages[0]?.name || "");
      }
    } catch (error: any) {
      setImages([]);
      setStats({ all: 0, done: 0, unassigned: 0 });
      setSelectedImageName("");
      setImagesError(error?.message || "Gagal memuat daftar gambar annotasi.");
    } finally {
      setIsImagesLoading(false);
    }
  }, [selectedDatasetId, statusFilter, selectedImageName]);

  useEffect(() => {
    void refreshImages();
  }, [refreshImages]);

  const loadLabels = useCallback(async () => {
    if (!selectedDatasetId || !selectedImageName) {
      setBoxes([]);
      setSavedBoxes([]);
      setSelectedBoxIndex(-1);
      setImageUrl("");
      setAnnotatedImageUrl("");
      return;
    }

    setIsLabelsLoading(true);
    setFeedback("");
    try {
      const response = await getImageAnnotationLabels(
        selectedDatasetId,
        selectedImageName,
      );
      const nextBoxes = Array.isArray(response.boxes) ? response.boxes : [];
      setBoxes(nextBoxes);
      setSavedBoxes(cloneBoxes(nextBoxes));
      setImageUrl(response.image_url || selectedImage?.url || "");
      setAnnotatedImageUrl(response.annotated_image_url || "");
      const classes = Array.isArray(response.classes) ? response.classes : [];
      if (classes.length > 0) {
        setClassNames(classes);
        setClassDraft(classes.join(", "));
      }
      setSelectedBoxIndex(-1);
    } catch (error: any) {
      setBoxes([]);
      setFeedback(error?.message || "Gagal memuat label annotasi.");
    } finally {
      setIsLabelsLoading(false);
    }
  }, [selectedDatasetId, selectedImageName, selectedImage?.url]);

  useEffect(() => {
    if (selectedImage?.url) {
      setImageUrl(selectedImage.url);
    }
  }, [selectedImage?.url]);

  useEffect(() => {
    if (!isStageMaximized) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsStageMaximized(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isStageMaximized]);

  useEffect(() => {
    void loadLabels();
  }, [loadLabels]);

  const parseClassDraft = () => {
    return classDraft
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  };

  const handleSaveClasses = async () => {
    if (!selectedDatasetId) {
      setFeedback("Pilih dataset terlebih dahulu.");
      return;
    }
    const nextClasses = parseClassDraft();
    try {
      const response = await updateAnnotationClasses(selectedDatasetId, nextClasses);
      setClassNames(response.classes || []);
      setClassDraft((response.classes || []).join(", "));
      setFeedback(`Class tersimpan: ${response.count}`);
      await onRefresh();
      await refreshImages();
    } catch (error: any) {
      setFeedback(error?.message || "Gagal menyimpan classes.");
    }
  };

  const getNormalizedPoint = (
    clientX: number,
    clientY: number,
    fallbackElement?: HTMLElement | null,
  ): NormalizedPoint | null => {
    const referenceElement = overlayRef.current || fallbackElement;
    if (!referenceElement) return null;
    const rect = referenceElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const x = clamp01((clientX - rect.left) / rect.width);
    const y = clamp01((clientY - rect.top) / rect.height);
    return { x, y };
  };

  const applyBoxEdit = (
    initialBox: AnnotationBox,
    mode: BoxEditMode,
    startPoint: NormalizedPoint,
    currentPoint: NormalizedPoint,
  ): AnnotationBox => {
    if (mode === "move") {
      const deltaX = currentPoint.x - startPoint.x;
      const deltaY = currentPoint.y - startPoint.y;
      const halfW = initialBox.w / 2;
      const halfH = initialBox.h / 2;
      return {
        ...initialBox,
        x: clamp01(Math.max(halfW, Math.min(1 - halfW, initialBox.x + deltaX))),
        y: clamp01(Math.max(halfH, Math.min(1 - halfH, initialBox.y + deltaY))),
      };
    }

    const left0 = clamp01(initialBox.x - initialBox.w / 2);
    const right0 = clamp01(initialBox.x + initialBox.w / 2);
    const top0 = clamp01(initialBox.y - initialBox.h / 2);
    const bottom0 = clamp01(initialBox.y + initialBox.h / 2);

    let left = left0;
    let right = right0;
    let top = top0;
    let bottom = bottom0;

    if (mode === "resize-nw") {
      left = clamp01(Math.min(currentPoint.x, right0 - MIN_ANNOTATE_BOX_SIZE));
      top = clamp01(Math.min(currentPoint.y, bottom0 - MIN_ANNOTATE_BOX_SIZE));
    } else if (mode === "resize-ne") {
      right = clamp01(Math.max(currentPoint.x, left0 + MIN_ANNOTATE_BOX_SIZE));
      top = clamp01(Math.min(currentPoint.y, bottom0 - MIN_ANNOTATE_BOX_SIZE));
    } else if (mode === "resize-sw") {
      left = clamp01(Math.min(currentPoint.x, right0 - MIN_ANNOTATE_BOX_SIZE));
      bottom = clamp01(Math.max(currentPoint.y, top0 + MIN_ANNOTATE_BOX_SIZE));
    } else if (mode === "resize-se") {
      right = clamp01(Math.max(currentPoint.x, left0 + MIN_ANNOTATE_BOX_SIZE));
      bottom = clamp01(Math.max(currentPoint.y, top0 + MIN_ANNOTATE_BOX_SIZE));
    }

    if (right - left < MIN_ANNOTATE_BOX_SIZE) {
      if (mode === "resize-nw" || mode === "resize-sw") {
        left = Math.max(0, right - MIN_ANNOTATE_BOX_SIZE);
      } else {
        right = Math.min(1, left + MIN_ANNOTATE_BOX_SIZE);
      }
    }
    if (bottom - top < MIN_ANNOTATE_BOX_SIZE) {
      if (mode === "resize-nw" || mode === "resize-ne") {
        top = Math.max(0, bottom - MIN_ANNOTATE_BOX_SIZE);
      } else {
        bottom = Math.min(1, top + MIN_ANNOTATE_BOX_SIZE);
      }
    }

    return {
      ...initialBox,
      x: clamp01((left + right) / 2),
      y: clamp01((top + bottom) / 2),
      w: clamp01(right - left),
      h: clamp01(bottom - top),
    };
  };

  const handleStartBoxEdit = (
    event: React.MouseEvent<HTMLElement>,
    index: number,
    mode: BoxEditMode,
  ) => {
    if (event.button !== 0) return;
    const currentBox = boxes[index];
    if (!currentBox) return;
    const point = getNormalizedPoint(
      event.clientX,
      event.clientY,
      event.currentTarget,
    );
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedBoxIndex(index);
    setCurrentClassId(currentBox.class_id);
    setDrawStart(null);
    setDrawCurrent(null);
    setBoxEditState({
      index,
      mode,
      start: point,
      initialBox: { ...currentBox },
    });
  };

  const handleDrawStart = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (boxEditState) return;
    if (event.button !== 0) return;
    const point = getNormalizedPoint(
      event.clientX,
      event.clientY,
      event.currentTarget,
    );
    if (!point) return;
    setSelectedBoxIndex(-1);
    setDrawStart(point);
    setDrawCurrent(point);
  };

  const handleDrawMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const point = getNormalizedPoint(
      event.clientX,
      event.clientY,
      event.currentTarget,
    );
    if (!point) return;

    if (boxEditState) {
      const editingIndex = boxEditState.index;
      setBoxes((prev) =>
        prev.map((box, index) =>
          index === editingIndex
            ? applyBoxEdit(
                boxEditState.initialBox,
                boxEditState.mode,
                boxEditState.start,
                point,
              )
            : box,
        ),
      );
      return;
    }

    if (!drawStart) return;
    setDrawCurrent(point);
  };

  const handleDrawEnd = (event: React.MouseEvent<HTMLDivElement>) => {
    if (boxEditState) {
      setBoxEditState(null);
      return;
    }
    if (!drawStart) return;
    const point = getNormalizedPoint(
      event.clientX,
      event.clientY,
      event.currentTarget,
    );
    const endPoint = point || drawCurrent || drawStart;
    const x1 = Math.min(drawStart.x, endPoint.x);
    const y1 = Math.min(drawStart.y, endPoint.y);
    const x2 = Math.max(drawStart.x, endPoint.x);
    const y2 = Math.max(drawStart.y, endPoint.y);
    const w = x2 - x1;
    const h = y2 - y1;

    setDrawStart(null);
    setDrawCurrent(null);

    if (w < 0.01 || h < 0.01) return;

    const newBox: AnnotationBox = {
      class_id: Math.max(0, currentClassId),
      x: clamp01(x1 + w / 2),
      y: clamp01(y1 + h / 2),
      w: clamp01(w),
      h: clamp01(h),
    };
    setBoxes((prev) => [...prev, newBox]);
  };

  const draftRect = useMemo(() => {
    if (!drawStart || !drawCurrent) return null;
    const x1 = Math.min(drawStart.x, drawCurrent.x);
    const y1 = Math.min(drawStart.y, drawCurrent.y);
    const x2 = Math.max(drawStart.x, drawCurrent.x);
    const y2 = Math.max(drawStart.y, drawCurrent.y);
    return {
      left: x1 * 100,
      top: y1 * 100,
      width: (x2 - x1) * 100,
      height: (y2 - y1) * 100,
    };
  }, [drawStart, drawCurrent]);

  const handleDeleteSelectedBox = () => {
    if (selectedBoxIndex < 0) return;
    setBoxes((prev) => prev.filter((_, index) => index !== selectedBoxIndex));
    setSelectedBoxIndex(-1);
  };

  const handleAssignClassToSelected = () => {
    if (selectedBoxIndex < 0) return;
    setBoxes((prev) =>
      prev.map((box, index) =>
        index === selectedBoxIndex
          ? { ...box, class_id: Math.max(0, currentClassId) }
          : box,
      ),
    );
  };

  const handleReverseLabels = () => {
    setBoxes(cloneBoxes(savedBoxes));
    setSelectedBoxIndex(-1);
    setFeedback("Annotasi di-reverse ke kondisi tersimpan terakhir.");
  };

  const handleSaveLabels = async () => {
    if (!selectedDatasetId || !selectedImageName) {
      setFeedback("Pilih dataset dan image terlebih dahulu.");
      return;
    }

    if (
      classNames.length > 0
      && boxes.some((box) => box.class_id < 0 || box.class_id >= classNames.length)
    ) {
      setFeedback("Ada class_id di luar range class dataset.");
      return;
    }

    setIsSavingLabels(true);
    setFeedback("");
    try {
      const result = await saveImageAnnotationLabels(
        selectedDatasetId,
        selectedImageName,
        boxes,
      );
      setFeedback(
        `Label tersimpan: ${result.saved_count} box (${result.status}).`,
      );
      if (result.annotated_image_url) {
        setAnnotatedImageUrl(result.annotated_image_url);
      }
      if (result.render_warning) {
        setFeedback(
          `Label tersimpan: ${result.saved_count} box (${result.status}). ${result.render_warning}`,
        );
      }
      applyLocalImageStatus(selectedImageName, "done", Math.max(1, boxes.length));
      setSavedBoxes(cloneBoxes(boxes));
      await onRefresh();
      await refreshImages();
    } catch (error: any) {
      setFeedback(error?.message || "Gagal menyimpan labels.");
    } finally {
      setIsSavingLabels(false);
    }
  };

  const handleDeleteLabels = async () => {
    if (!selectedDatasetId || !selectedImageName) {
      setFeedback("Pilih image terlebih dahulu.");
      return;
    }
    const confirmed = window.confirm(
      `Hapus semua label untuk image '${selectedImageName}'?`,
    );
    if (!confirmed) return;

    setIsSavingLabels(true);
    setFeedback("");
    try {
      await deleteImageAnnotationLabels(selectedDatasetId, selectedImageName);
      setBoxes([]);
      setSavedBoxes([]);
      setSelectedBoxIndex(-1);
      setAnnotatedImageUrl("");
      applyLocalImageStatus(selectedImageName, "unassigned", 0);
      setFeedback("Label image dihapus.");
      await onRefresh();
      await refreshImages();
    } catch (error: any) {
      setFeedback(error?.message || "Gagal menghapus labels.");
    } finally {
      setIsSavingLabels(false);
    }
  };

  const handlePrevImage = () => {
    if (selectedImageIndex <= 0) return;
    setSelectedImageName(images[selectedImageIndex - 1].name);
  };

  const handleNextImage = () => {
    if (selectedImageIndex < 0 || selectedImageIndex >= images.length - 1) return;
    setSelectedImageName(images[selectedImageIndex + 1].name);
  };

  const handleNextUnassigned = () => {
    if (!images.length) return;
    const next = images.find(
      (item, index) => index > selectedImageIndex && item.status === "unassigned",
    ) || images.find((item) => item.status === "unassigned");
    if (next) {
      setSelectedImageName(next.name);
    }
  };

  const selectedClassLabel =
    classNames[currentClassId] || `class-${Math.max(0, currentClassId)}`;

  const applyLocalImageStatus = (
    imageName: string,
    status: "done" | "unassigned",
    labelCount: number,
  ) => {
    setImages((prev) => {
      const next = prev.map((item) =>
        item.name === imageName
          ? {
              ...item,
              status,
              label_count: labelCount,
            }
          : item,
      );
      const doneNext = next.filter((item) => item.status === "done").length;
      setStats((prevStats) => {
        const allCount = prevStats.all > 0 ? prevStats.all : next.length;
        return {
          ...prevStats,
          all: allCount,
          done: doneNext,
          unassigned: Math.max(0, allCount - doneNext),
        };
      });
      return next;
    });
  };

  return (
    <section className="aski-ws-panel aski-ws-panel-annotate">
      <header className="aski-ws-panel-head aski-ws-panel-head-col">
        <h2>
          <FiEdit3 /> Annotate
        </h2>
        <div className="aski-ws-filter-row aski-ws-annotate-toolbar">
          <select
            value={selectedDatasetId}
            onChange={(event) => setSelectedDatasetId(event.target.value)}
            disabled={!datasets.length || isLoading || isImagesLoading}
          >
            {datasets.length === 0 ? (
              <option value="">Belum ada dataset</option>
            ) : (
              datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.folder_name || dataset.id} ({dataset.name})
                </option>
              ))
            )}
          </select>
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as AnnotationStatusFilter)
            }
            disabled={!selectedDatasetId || isImagesLoading}
          >
            <option value="all">all</option>
            <option value="unassigned">unassigned</option>
            <option value="done">done</option>
          </select>
          <button
            type="button"
            className="aski-ws-ghost-btn"
            onClick={() => {
              void onRefresh();
              void refreshImages();
            }}
          >
            <FiRefreshCw /> Refresh
          </button>
        </div>
      </header>

      {errorMessage && <p className="aski-ws-inline-error">{errorMessage}</p>}
      {imagesError && <p className="aski-ws-inline-error">{imagesError}</p>}
      {feedback && <div className="aski-ws-upload-feedback">{feedback}</div>}

      <div className="aski-ws-dataset-summary">
        <span>
          total: <strong>{stats.all}</strong>
        </span>
        <span>
          done: <strong>{stats.done}</strong>
        </span>
        <span>
          unassigned: <strong>{stats.unassigned}</strong>
        </span>
        <span>
          selected class: <strong>{selectedClassLabel}</strong>
        </span>
      </div>

      <div className="aski-annotate-layout">
        <aside className="aski-annotate-list">
          {isImagesLoading ? (
            <div className="aski-ws-placeholder">
              <p>Loading images...</p>
            </div>
          ) : images.length === 0 ? (
            <div className="aski-ws-placeholder">
              <p>Tidak ada image untuk annotasi.</p>
            </div>
          ) : (
            images.map((item) => (
              <button
                key={item.name}
                type="button"
                className={`aski-annotate-list-item ${item.name === selectedImageName ? "active" : ""}`}
                onClick={() => setSelectedImageName(item.name)}
              >
                <span className="aski-annotate-list-name">{item.name}</span>
                <span className={`aski-annotate-status ${item.status}`}>
                  {item.status} ({item.label_count})
                </span>
              </button>
            ))
          )}
        </aside>

        <div className="aski-annotate-editor">
          <div className="aski-annotate-controls">
            <div className="aski-ws-inline-field">
              <span>Class ID</span>
              <input
                type="number"
                min={0}
                value={currentClassId}
                onChange={(event) =>
                  setCurrentClassId(Math.max(0, Number(event.target.value || 0)))
                }
              />
            </div>
            <button
              type="button"
              className="aski-ws-ghost-btn"
              onClick={handleAssignClassToSelected}
              disabled={selectedBoxIndex < 0}
            >
              Assign
            </button>
            <button
              type="button"
              className="aski-ws-danger-btn"
              onClick={handleDeleteSelectedBox}
              disabled={selectedBoxIndex < 0}
            >
              <FiTrash2 /> Del Box
            </button>
            <button
              type="button"
              className="aski-ws-ghost-btn"
              onClick={handleReverseLabels}
              disabled={isSavingLabels || isLabelsLoading || !selectedImageName}
            >
              Reverse Annotate
            </button>
            <button
              type="button"
              className="aski-ws-ghost-btn"
              onClick={handlePrevImage}
              disabled={selectedImageIndex <= 0}
            >
              Prev
            </button>
            <button
              type="button"
              className="aski-ws-ghost-btn"
              onClick={handleNextImage}
              disabled={selectedImageIndex < 0 || selectedImageIndex >= images.length - 1}
            >
              Next
            </button>
            <button
              type="button"
              className="aski-ws-ghost-btn"
              onClick={handleNextUnassigned}
              disabled={images.length === 0}
            >
              Unassigned
            </button>
            <button
              type="button"
              className="aski-ws-ghost-btn"
              onClick={() => setIsStageMaximized((prev) => !prev)}
              disabled={!imageUrl}
            >
              {isStageMaximized ? (
                <>
                  <FiMinimize2 /> Restore
                </>
              ) : (
                <>
                  <FiMaximize2 /> Maximize
                </>
              )}
            </button>
            <span className="aski-annotate-help">
              Drag box untuk pindah. Tarik titik sudut untuk ubah bentuk/lebar.
            </span>
          </div>

          <div className={`aski-annotate-stage-wrap ${isStageMaximized ? "is-maximized" : ""}`}>
            {isStageMaximized && (
              <button
                type="button"
                className="aski-annotate-maximize-close"
                onClick={() => setIsStageMaximized(false)}
              >
                <FiMinimize2 /> Close
              </button>
            )}
            {!imageUrl ? (
              <div className="aski-ws-placeholder">
                <p>Pilih image untuk mulai annotasi.</p>
              </div>
            ) : (
              <div className="aski-annotate-stage">
                <img
                  ref={imageElementRef}
                  src={imageUrl}
                  alt={selectedImageName || "annotation-target"}
                  className="aski-annotate-image"
                />
                <div
                  ref={overlayRef}
                  className="aski-annotate-overlay"
                  onMouseDown={handleDrawStart}
                  onMouseMove={handleDrawMove}
                  onMouseUp={handleDrawEnd}
                  onMouseLeave={handleDrawEnd}
                >
                  {boxes.map((box, index) => {
                    const left = (box.x - box.w / 2) * 100;
                    const top = (box.y - box.h / 2) * 100;
                    const width = box.w * 100;
                    const height = box.h * 100;
                    const isSelected = selectedBoxIndex === index;
                    const classLabel = classNames[box.class_id] || `class-${box.class_id}`;
                    return (
                      <button
                        key={`${index}-${box.class_id}-${box.x}-${box.y}`}
                        type="button"
                        className={`aski-annotate-box ${isSelected ? "selected" : ""}`}
                        style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                        onMouseDown={(event) => {
                          handleStartBoxEdit(event, index, "move");
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setSelectedBoxIndex(index);
                          setCurrentClassId(box.class_id);
                        }}
                        title={`${classLabel} (${box.class_id})`}
                      >
                        <span>{classLabel}</span>
                        {isSelected && (
                          <>
                            <span
                              className="aski-annotate-handle nw"
                              onMouseDown={(event) => {
                                handleStartBoxEdit(event, index, "resize-nw");
                              }}
                            />
                            <span
                              className="aski-annotate-handle ne"
                              onMouseDown={(event) => {
                                handleStartBoxEdit(event, index, "resize-ne");
                              }}
                            />
                            <span
                              className="aski-annotate-handle sw"
                              onMouseDown={(event) => {
                                handleStartBoxEdit(event, index, "resize-sw");
                              }}
                            />
                            <span
                              className="aski-annotate-handle se"
                              onMouseDown={(event) => {
                                handleStartBoxEdit(event, index, "resize-se");
                              }}
                            />
                          </>
                        )}
                      </button>
                    );
                  })}
                  {draftRect && (
                    <div
                      className="aski-annotate-box draft"
                      style={{
                        left: `${draftRect.left}%`,
                        top: `${draftRect.top}%`,
                        width: `${draftRect.width}%`,
                        height: `${draftRect.height}%`,
                      }}
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="aski-annotate-save-row">
            <button
              type="button"
              className="aski-ws-ghost-btn"
              onClick={handleSaveLabels}
              disabled={isSavingLabels || !selectedImageName || isLabelsLoading}
            >
              {isSavingLabels ? "Saving..." : "Save Labels"}
            </button>
            <button
              type="button"
              className="aski-ws-danger-btn"
              onClick={handleDeleteLabels}
              disabled={isSavingLabels || !selectedImageName}
            >
              <FiTrash2 /> Delete Labels
            </button>
            <span>
              Image: <strong>{selectedImageName || "-"}</strong> | Boxes:{" "}
              <strong>{boxes.length}</strong>
            </span>
            {annotatedImageUrl && (
              <>
                <a
                  href={annotatedImageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="aski-ws-ghost-btn"
                >
                  Open Annotated Image
                </a>
                <a
                  href={annotatedImageUrl}
                  download
                  className="aski-ws-ghost-btn"
                >
                  Download Annotated Image
                </a>
              </>
            )}
          </div>

          <div className="aski-annotate-classes">
            <label>Classes (pisahkan dengan koma)</label>
            <textarea
              value={classDraft}
              onChange={(event) => setClassDraft(event.target.value)}
              placeholder="contoh: person, helmet, vest"
            />
            <button type="button" onClick={handleSaveClasses}>
              Save Classes
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

interface TrainPanelProps {
  datasets: DatasetSummary[];
  isLoading: boolean;
  errorMessage: string;
  onRefresh: () => Promise<void>;
}

const DEFAULT_FALLBACK_ARCHITECTURES: TrainingArchitectureItem[] = [
  {
    id: "yolov5m",
    family: "yolov5",
    label: "YOLOv5 m",
    available: true,
    base_model_path: "models/yolov5m.pt",
  },
  {
    id: "yolov5mu",
    family: "yolov5",
    label: "YOLOv5 mu",
    available: true,
    base_model_path: "models/yolov5mu.pt",
  },
];

function formatTimestamp(timestamp?: number | null): string {
  if (!timestamp) return "-";
  try {
    return new Date(timestamp * 1000).toLocaleString();
  } catch {
    return "-";
  }
}

function TrainPanel({
  datasets,
  isLoading,
  errorMessage,
  onRefresh,
}: TrainPanelProps) {
  const [architectures, setArchitectures] = useState<TrainingArchitectureItem[]>(
    DEFAULT_FALLBACK_ARCHITECTURES,
  );
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [selectedVariant, setSelectedVariant] = useState("yolov5mu");
  const [epochs, setEpochs] = useState(50);
  const [imgsz, setImgsz] = useState(640);
  const [batch, setBatch] = useState(16);
  const [patience, setPatience] = useState(50);
  const [valSplit, setValSplit] = useState(0.2);
  const [device, setDevice] = useState("");
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [selectedJobLog, setSelectedJobLog] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [activeJobActionId, setActiveJobActionId] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [errorTrainingMessage, setErrorTrainingMessage] = useState("");

  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDatasetId),
    [datasets, selectedDatasetId],
  );

  const datasetNameMap = useMemo(
    () => Object.fromEntries(datasets.map((d) => [d.id, d.name || d.folder_name || d.id])),
    [datasets],
  );

  const runningJobs = useMemo(
    () =>
      jobs.filter(
        (job) =>
          job.status === "queued"
          || job.status === "running"
          || job.status === "canceling",
      )
        .length,
    [jobs],
  );

  useEffect(() => {
    if (!datasets.length) {
      setSelectedDatasetId("");
      return;
    }
    const stillExists = datasets.some((dataset) => dataset.id === selectedDatasetId);
    if (!stillExists) {
      setSelectedDatasetId(datasets[0].id);
    }
  }, [datasets, selectedDatasetId]);

  const refreshArchitectures = useCallback(async () => {
    try {
      const response = await listTrainingArchitectures();
      const next = Array.isArray(response?.items) ? response.items : [];
      if (next.length > 0) {
        setArchitectures(next);
        if (response?.default_variant) {
          setSelectedVariant(response.default_variant);
        }
        const defaults = response?.default_train_params;
        if (defaults) {
          if (typeof defaults.epochs === "number") {
            setEpochs(Math.max(1, Math.min(1000, Math.round(defaults.epochs))));
          }
          if (typeof defaults.imgsz === "number") {
            setImgsz(Math.max(64, Math.min(2048, Math.round(defaults.imgsz))));
          }
          if (typeof defaults.batch === "number") {
            setBatch(Math.max(1, Math.min(512, Math.round(defaults.batch))));
          }
          if (typeof defaults.patience === "number") {
            setPatience(Math.max(0, Math.min(1000, Math.round(defaults.patience))));
          }
        }
      } else {
        setArchitectures(DEFAULT_FALLBACK_ARCHITECTURES);
      }
    } catch {
      setArchitectures(DEFAULT_FALLBACK_ARCHITECTURES);
    }
  }, []);

  const refreshJobs = useCallback(async () => {
    setIsLoadingJobs(true);
    try {
      const response = await listTrainingJobs(80);
      setJobs(Array.isArray(response) ? response : []);
    } catch (error: any) {
      setErrorTrainingMessage(error?.message || "Gagal memuat training jobs.");
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    void refreshArchitectures();
    void refreshJobs();
  }, [refreshArchitectures, refreshJobs]);

  useEffect(() => {
    if (!runningJobs) return;
    const timer = window.setInterval(() => {
      void refreshJobs();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [runningJobs, refreshJobs]);

  useEffect(() => {
    if (!selectedJobId) {
      setSelectedJobLog("");
      return;
    }
    let active = true;
    getTrainingJobLog(selectedJobId, 200)
      .then((response) => {
        if (!active) return;
        setSelectedJobLog(response?.tail || "");
      })
      .catch(() => {
        if (!active) return;
        setSelectedJobLog("");
      });
    return () => {
      active = false;
    };
  }, [selectedJobId, jobs]);

  const availableVariants = useMemo(
    () => architectures.filter((item) => item.family === "yolov5"),
    [architectures],
  );

  const handleStartTraining = async () => {
    if (!selectedDatasetId) {
      setErrorTrainingMessage("Pilih dataset terlebih dahulu.");
      return;
    }
    if (!selectedVariant) {
      setErrorTrainingMessage("Pilih base arsitektur YOLOv5.");
      return;
    }

    setIsSubmitting(true);
    setErrorTrainingMessage("");
    setFeedbackMessage("");
    try {
      const created = await createTrainingJob({
        dataset_id: selectedDatasetId,
        architecture_variant: selectedVariant,
        epochs,
        imgsz,
        batch,
        patience,
        val_split: valSplit,
        device: device.trim() || undefined,
      });
      setFeedbackMessage(
        `Training job dibuat: ${created.id} (${created.status}).`,
      );
      setSelectedJobId(created.id);
      await refreshJobs();
      await onRefresh();
    } catch (error: any) {
      setErrorTrainingMessage(error?.message || "Gagal membuat training job.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelJob = async (job: TrainingJob) => {
    if (job.status === "completed" || job.status === "failed" || job.status === "canceled") {
      setFeedbackMessage(
        `Job ${job.id} sudah selesai (${job.status}) dan tidak perlu di-cancel.`,
      );
      return;
    }

    const confirmed = window.confirm(
      `Cancel training job '${job.id}' sekarang?`,
    );
    if (!confirmed) return;

    setActiveJobActionId(job.id);
    setErrorTrainingMessage("");
    setFeedbackMessage("");
    try {
      const updated = await cancelTrainingJob(job.id);
      setFeedbackMessage(
        `Cancel dikirim untuk job ${updated.id}. Status sekarang: ${updated.status}.`,
      );
      await refreshJobs();
    } catch (error: any) {
      setErrorTrainingMessage(error?.message || "Gagal cancel training job.");
    } finally {
      setActiveJobActionId("");
    }
  };

  const handleDeleteJob = async (job: TrainingJob) => {
    if (job.status === "queued" || job.status === "running") {
      setErrorTrainingMessage(
        `Job ${job.id} masih aktif (${job.status}). Cancel dulu sebelum delete.`,
      );
      return;
    }

    const confirmed = window.confirm(
      `Hapus training job '${job.id}' dari daftar?`,
    );
    if (!confirmed) return;

    let deleteModel = false;
    if (job.trained_model_path) {
      deleteModel = window.confirm(
        "Sekalian hapus file model hasil training? Klik OK untuk hapus model, Cancel untuk tetap simpan model.",
      );
    }

    setActiveJobActionId(job.id);
    setErrorTrainingMessage("");
    setFeedbackMessage("");
    try {
      const result = await deleteTrainingJob(job.id, deleteModel);
      setFeedbackMessage(
        `Job ${result.id} dihapus.${result.trained_model_deleted ? " Model output ikut dihapus." : ""}`,
      );
      if (selectedJobId === job.id) {
        setSelectedJobId("");
        setSelectedJobLog("");
      }
      await refreshJobs();
    } catch (error: any) {
      setErrorTrainingMessage(error?.message || "Gagal menghapus training job.");
    } finally {
      setActiveJobActionId("");
    }
  };

  return (
    <section className="aski-ws-panel">
      <header className="aski-ws-panel-head aski-ws-panel-head-col">
        <h2>
          <MdOutlineModelTraining /> Train Models
        </h2>
        <div className="aski-ws-filter-row aski-ws-train-toolbar">
          <label className="aski-ws-train-field" title="Dataset yang digunakan untuk training.">
            <span>Dataset</span>
            <select
              value={selectedDatasetId}
              onChange={(event) => setSelectedDatasetId(event.target.value)}
            >
              {!datasets.length && <option value="">No dataset</option>}
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name} ({dataset.folder_name || dataset.id})
                </option>
              ))}
            </select>
          </label>
          <label className="aski-ws-train-field" title="Model arsitektur dasar YOLOv5 untuk memulai training.">
            <span>Base Architecture</span>
            <select
              value={selectedVariant}
              onChange={(event) => setSelectedVariant(event.target.value)}
            >
              {availableVariants.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                  {item.available ? "" : " (weights missing)"}
                </option>
              ))}
            </select>
          </label>
          <label className="aski-ws-train-field" title="Jumlah epoch training.">
            <span>Epochs</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={epochs}
              onChange={(event) => setEpochs(Number(event.target.value || 1))}
            />
          </label>
          <label className="aski-ws-train-field" title="Resolusi input image (imgsz).">
            <span>Image Size</span>
            <input
              type="number"
              min={64}
              max={2048}
              value={imgsz}
              onChange={(event) => setImgsz(Number(event.target.value || 640))}
            />
          </label>
          <label className="aski-ws-train-field" title="Batch size per iterasi training.">
            <span>Batch Size</span>
            <input
              type="number"
              min={1}
              max={512}
              value={batch}
              onChange={(event) => setBatch(Number(event.target.value || 1))}
            />
          </label>
          <label className="aski-ws-train-field" title="Jumlah epoch tanpa peningkatan sebelum early stopping.">
            <span>Patience</span>
            <input
              type="number"
              min={0}
              max={1000}
              value={patience}
              onChange={(event) => setPatience(Number(event.target.value || 0))}
            />
          </label>
          <label className="aski-ws-train-field" title="Porsi data validation (0.05 - 0.5).">
            <span>Validation Split</span>
            <input
              type="number"
              min={0.05}
              max={0.5}
              step={0.05}
              value={valSplit}
              onChange={(event) =>
                setValSplit(Number(event.target.value || 0.2))
              }
            />
          </label>
          <label className="aski-ws-train-field" title="Opsional: cpu, 0, 0,1, dll. Kosong = default runtime.">
            <span>Device</span>
            <input
              type="text"
              value={device}
              onChange={(event) => setDevice(event.target.value)}
              placeholder="cpu / 0 / 0,1 / auto"
            />
          </label>
          <button
            type="button"
            className="aski-ws-primary-btn"
            onClick={handleStartTraining}
            disabled={isSubmitting || isLoading || !datasets.length}
          >
            {isSubmitting ? "Starting..." : "Start Train"}
          </button>
          <button
            type="button"
            className="aski-ws-ghost-btn"
            onClick={() => {
              void refreshJobs();
            }}
          >
            <FiRefreshCw /> Refresh Jobs
          </button>
        </div>
        <div className="aski-ws-upload-hint">
          Family: <strong>YOLOv5</strong> | Dataset:{" "}
          <strong>{selectedDataset?.folder_name || selectedDataset?.id || "-"}</strong>
          {" | "}Running: <strong>{runningJobs}</strong>
          {" | "}Arsitektur tersedia:{" "}
          <strong>
            {availableVariants.filter((item) => item.available).length}/
            {availableVariants.length}
          </strong>
        </div>
      </header>

      {errorMessage && <p className="aski-ws-inline-error">{errorMessage}</p>}
      {errorTrainingMessage && (
        <p className="aski-ws-inline-error">{errorTrainingMessage}</p>
      )}
      {feedbackMessage && (
        <div className="aski-ws-upload-feedback">{feedbackMessage}</div>
      )}

      <div className="aski-ws-jobs-subheader">Training Jobs</div>
      <div className="aski-ws-models-table-wrap aski-ws-train-table-wrap">
        <table className="aski-ws-models-table aski-ws-train-table">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Dataset</th>
              <th>Architecture</th>
              <th>Status</th>
              <th>Output Model</th>
              <th>Created</th>
              <th>Finished</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!isLoadingJobs && jobs.length === 0 ? (
              <tr>
                <td colSpan={8}>Belum ada training job.</td>
              </tr>
            ) : (
              jobs.map((job) => (
                <tr
                  key={job.id}
                  onClick={() => setSelectedJobId(job.id)}
                  className={
                    selectedJobId === job.id ? "aski-ws-row-selected" : ""
                  }
                >
                  <td>{job.id}</td>
                  <td title={job.dataset_id}>{datasetNameMap[job.dataset_id] || job.dataset_id}</td>
                  <td>{job.architecture_variant || "-"}</td>
                  <td className={`aski-ws-train-status ${job.status}`}>
                    {job.status}
                  </td>
                  <td
                    className="aski-ws-model-path-cell aski-ws-train-output-cell"
                    title={job.trained_model_path || ""}
                  >
                    {job.trained_model_path || "-"}
                  </td>
                  <td>{formatTimestamp(job.created_at)}</td>
                  <td>{formatTimestamp(job.finished_at)}</td>
                  <td className="aski-ws-model-actions aski-ws-train-actions">
                    <button
                      type="button"
                      className="aski-ws-ghost-btn"
                      disabled={
                        activeJobActionId === job.id
                        || job.status === "completed"
                        || job.status === "failed"
                        || job.status === "canceled"
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleCancelJob(job);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="aski-ws-danger-btn"
                      disabled={
                        activeJobActionId === job.id
                        || job.status === "queued"
                        || job.status === "running"
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteJob(job);
                      }}
                    >
                      <FiTrash2 /> Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="aski-ws-train-log-wrap">
        <div className="aski-ws-dataset-summary">
          <span>
            Selected Job: <strong>{selectedJobId || "-"}</strong>
          </span>
        </div>
        <textarea
          className="aski-ws-train-log"
          value={selectedJobLog}
          readOnly
          placeholder="Pilih job untuk melihat log tail..."
        />
      </div>
    </section>
  );
}

interface DatasetPanelProps {
  datasets: DatasetSummary[];
  isLoading: boolean;
  errorMessage: string;
  onRefresh: () => Promise<void>;
}

type DatasetContentTarget = "images" | "labels" | "videos" | "splits" | "exports";

function DatasetPanel({
  datasets,
  isLoading,
  errorMessage,
  onRefresh,
}: DatasetPanelProps) {
  const hasDatasets = datasets.length > 0;
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [selectedTarget, setSelectedTarget] =
    useState<DatasetContentTarget>("images");
  const [files, setFiles] = useState<DatasetFileItem[]>([]);
  const [isFilesLoading, setIsFilesLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeletingFiles, setIsDeletingFiles] = useState(false);
  const [selectedFileKeys, setSelectedFileKeys] = useState<string[]>([]);
  const [actionFeedback, setActionFeedback] = useState("");
  const [fileErrorMessage, setFileErrorMessage] = useState("");

  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDatasetId),
    [datasets, selectedDatasetId],
  );

  useEffect(() => {
    if (!datasets.length) {
      setSelectedDatasetId("");
      setFiles([]);
      setSelectedFileKeys([]);
      return;
    }
    const stillExists = datasets.some((d) => d.id === selectedDatasetId);
    if (!stillExists) {
      setSelectedDatasetId(datasets[0].id);
    }
  }, [datasets, selectedDatasetId]);

  const loadDatasetContents = useCallback(
    async (datasetId: string, target: DatasetContentTarget) => {
      if (!datasetId) {
        setFiles([]);
        setFileErrorMessage("");
        return;
      }

      setIsFilesLoading(true);
      setFileErrorMessage("");
      try {
        const response = await listDatasetFiles(datasetId, target);
        setFiles(response.files || []);
      } catch (error: any) {
        setFiles([]);
        setFileErrorMessage(error?.message || "Gagal memuat isi dataset.");
      } finally {
        setIsFilesLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadDatasetContents(selectedDatasetId, selectedTarget);
  }, [loadDatasetContents, selectedDatasetId, selectedTarget]);

  useEffect(() => {
    setSelectedFileKeys([]);
  }, [selectedDatasetId, selectedTarget]);

  useEffect(() => {
    const available = new Set(files.map((file) => `${file.target}/${file.name}`));
    setSelectedFileKeys((prev) => prev.filter((key) => available.has(key)));
  }, [files]);

  const handleRefresh = async () => {
    setActionFeedback("");
    await onRefresh();
    await loadDatasetContents(selectedDatasetId, selectedTarget);
  };

  const handleToggleSelectAll = (nextChecked: boolean) => {
    if (!nextChecked) {
      setSelectedFileKeys([]);
      return;
    }
    setSelectedFileKeys(files.map((file) => `${file.target}/${file.name}`));
  };

  const handleToggleFile = (file: DatasetFileItem, nextChecked: boolean) => {
    const fileKey = `${file.target}/${file.name}`;
    setSelectedFileKeys((prev) => {
      if (nextChecked) {
        if (prev.includes(fileKey)) return prev;
        return [...prev, fileKey];
      }
      return prev.filter((item) => item !== fileKey);
    });
  };

  const handleDeleteSelectedFiles = async () => {
    if (!selectedDatasetId) {
      setFileErrorMessage("Pilih dataset terlebih dahulu.");
      return;
    }
    if (!selectedFileKeys.length) {
      setFileErrorMessage("Pilih minimal 1 file untuk dihapus.");
      return;
    }

    const selectedNames = files
      .filter((file) => selectedFileKeys.includes(`${file.target}/${file.name}`))
      .map((file) => file.name);

    if (!selectedNames.length) {
      setFileErrorMessage("File terpilih tidak ditemukan. Refresh lalu coba lagi.");
      return;
    }

    const confirmed = window.confirm(
      `Hapus ${selectedNames.length} file dari folder '${selectedTarget}'?`,
    );
    if (!confirmed) {
      return;
    }

    setIsDeletingFiles(true);
    setActionFeedback("");
    setFileErrorMessage("");
    try {
      const result = await deleteDatasetFiles(
        selectedDatasetId,
        selectedTarget,
        selectedNames,
      );
      const missingCount = Array.isArray(result?.missing) ? result.missing.length : 0;
      const errorCount = Array.isArray(result?.errors) ? result.errors.length : 0;
      setActionFeedback(
        `Hapus file selesai: ${result.deleted_count} berhasil, ${missingCount} tidak ditemukan, ${errorCount} gagal.`,
      );
      setSelectedFileKeys([]);
      await onRefresh();
      await loadDatasetContents(selectedDatasetId, selectedTarget);
    } catch (error: any) {
      setFileErrorMessage(error?.message || "Gagal menghapus file dataset.");
    } finally {
      setIsDeletingFiles(false);
    }
  };

  const handleDeleteSelectedDataset = async () => {
    if (!selectedDataset) {
      return;
    }

    const confirmed = window.confirm(
      `Hapus dataset '${selectedDataset.name}' (${selectedDataset.folder_name || selectedDataset.id})?`,
    );
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    setActionFeedback("");
    setFileErrorMessage("");
    try {
      await deleteDataset(selectedDataset.id);
      setSelectedDatasetId("");
      setFiles([]);
      setActionFeedback(
        `Dataset dihapus: ${selectedDataset.folder_name || selectedDataset.id}.`,
      );
      await onRefresh();
    } catch (error: any) {
      setFileErrorMessage(error?.message || "Gagal menghapus dataset.");
    } finally {
      setIsDeleting(false);
    }
  };

  const canShowPreview =
    selectedTarget === "images" || selectedTarget === "videos";
  const isBusy = isDeleting || isDeletingFiles;
  const allFilesSelected =
    files.length > 0 &&
    files.every((file) => selectedFileKeys.includes(`${file.target}/${file.name}`));

  return (
    <section className="aski-ws-panel">
      <header className="aski-ws-panel-head aski-ws-panel-head-col">
        <h2>
          <FiDatabase /> Dataset
        </h2>
        <div className="aski-ws-filter-row aski-ws-dataset-toolbar">
          <select
            value={selectedDatasetId}
            onChange={(event) => setSelectedDatasetId(event.target.value)}
            disabled={!hasDatasets || isLoading || isBusy}
          >
            {hasDatasets ? (
              datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.folder_name || dataset.id} ({dataset.name})
                </option>
              ))
            ) : (
              <option value="">No datasets</option>
            )}
          </select>
          <select
            value={selectedTarget}
            onChange={(event) =>
              setSelectedTarget(event.target.value as DatasetContentTarget)
            }
            disabled={!hasDatasets || isBusy}
          >
            <option value="images">images</option>
            <option value="labels">labels</option>
            <option value="videos">videos</option>
            <option value="splits">splits</option>
            <option value="exports">exports</option>
          </select>
          <button
            type="button"
            onClick={() => {
              void handleRefresh();
            }}
            className="aski-ws-ghost-btn"
            disabled={isBusy}
          >
            <FiRefreshCw /> Refresh
          </button>
          <button
            type="button"
            className="aski-ws-ghost-btn"
            onClick={() => handleToggleSelectAll(!allFilesSelected)}
            disabled={isBusy || files.length === 0}
          >
            {allFilesSelected ? "Unselect All" : "Select All"}
          </button>
          <button
            type="button"
            className="aski-ws-danger-btn"
            onClick={() => {
              void handleDeleteSelectedFiles();
            }}
            disabled={isBusy || selectedFileKeys.length === 0}
          >
            <FiTrash2 /> {isDeletingFiles ? "Deleting Files..." : `Delete Selected (${selectedFileKeys.length})`}
          </button>
          <button
            type="button"
            className="aski-ws-danger-btn"
            onClick={() => {
              void handleDeleteSelectedDataset();
            }}
            disabled={!selectedDataset || isBusy || isLoading}
          >
            <FiTrash2 /> {isDeleting ? "Deleting..." : "Delete Dataset"}
          </button>
        </div>
      </header>

      {errorMessage && <p className="aski-ws-inline-error">{errorMessage}</p>}
      {actionFeedback && (
        <div className="aski-ws-upload-feedback">{actionFeedback}</div>
      )}
      {selectedDataset && (
        <div className="aski-ws-dataset-summary">
          <span>
            folder: <strong>{selectedDataset.folder_name || selectedDataset.id}</strong>
          </span>
          <span>
            images: <strong>{selectedDataset.stats?.images ?? 0}</strong>
          </span>
          <span>
            labels: <strong>{selectedDataset.stats?.labels ?? 0}</strong>
          </span>
          <span>
            videos: <strong>{selectedDataset.stats?.videos ?? 0}</strong>
          </span>
        </div>
      )}
      {fileErrorMessage && (
        <p className="aski-ws-inline-error">{fileErrorMessage}</p>
      )}

      {isLoading ? (
        <div className="aski-ws-placeholder">
          <p>Loading datasets...</p>
        </div>
      ) : !hasDatasets ? (
        <div className="aski-ws-placeholder">
          <p>Belum ada dataset. Buat dataset dari tab Upload Data.</p>
        </div>
      ) : isFilesLoading ? (
        <div className="aski-ws-placeholder">
          <p>Loading isi dataset...</p>
        </div>
      ) : files.length === 0 ? (
        <div className="aski-ws-placeholder">
          <p>Folder `{selectedTarget}` masih kosong.</p>
        </div>
      ) : (
        <div className="aski-ws-dataset-board">
          {files.map((file) => {
            const fileKey = `${file.target}/${file.name}`;
            return (
            <article key={`${file.target}-${file.name}`} className="aski-ws-image-card">
              <div className="aski-ws-image-card-head">
                <label className="aski-ws-image-select">
                  <input
                    type="checkbox"
                    checked={selectedFileKeys.includes(fileKey)}
                    onChange={(event) => handleToggleFile(file, event.target.checked)}
                    disabled={isBusy}
                  />
                  pilih
                </label>
              </div>
              <a
                href={file.url}
                target="_blank"
                rel="noreferrer"
                className="aski-ws-image-link"
              >
                <div
                  className={`aski-ws-image-thumb ${canShowPreview ? "is-preview" : ""}`}
                  style={
                    canShowPreview
                      ? {
                          backgroundImage: `url("${file.url}")`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                        }
                      : undefined
                  }
                />
              </a>
              <div className="aski-ws-image-label" title={file.name}>
                {file.name}
              </div>
            </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface UploadDataPanelProps {
  datasets: DatasetSummary[];
  isLoading: boolean;
  errorMessage: string;
  onRefresh: () => Promise<void>;
}

function UploadDataPanel({
  datasets,
  isLoading,
  errorMessage,
  onRefresh,
}: UploadDataPanelProps) {
  const [newDatasetName, setNewDatasetName] = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [uploadKind, setUploadKind] = useState<DatasetUploadKind>("image");
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);

  useEffect(() => {
    if (!datasets.length) {
      setSelectedDatasetId("");
      return;
    }
    const stillExists = datasets.some((d) => d.id === selectedDatasetId);
    if (!stillExists) {
      setSelectedDatasetId(datasets[0].id);
    }
  }, [datasets, selectedDatasetId]);

  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDatasetId),
    [datasets, selectedDatasetId],
  );
  const uploadConfig = DATASET_UPLOAD_KIND_CONFIG[uploadKind];

  const handleCreateDataset = async () => {
    const name = newDatasetName.trim();
    if (!name) {
      setFeedback("Isi nama dataset terlebih dahulu.");
      return;
    }
    setIsCreating(true);
    setFeedback("");
    try {
      const created = await createDataset({ name });
      setFeedback(
        `Dataset dibuat: ${created.name} (folder: ${created.folder_name || created.id})`,
      );
      setNewDatasetName("");
      await onRefresh();
      setSelectedDatasetId(created.id);
    } catch (error: any) {
      setFeedback(error?.message || "Gagal membuat dataset.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpload = async () => {
    if (!selectedDatasetId) {
      setFeedback("Pilih dataset tujuan terlebih dahulu.");
      return;
    }
    if (!filesToUpload.length) {
      setFeedback("Pilih minimal 1 file untuk di-upload.");
      return;
    }

    const invalidFiles = filesToUpload.filter(
      (file) => !isAllowedExtension(file.name, uploadConfig.extensions),
    );
    if (invalidFiles.length > 0) {
      const preview = invalidFiles
        .slice(0, 5)
        .map((file) => file.name)
        .join(", ");
      const remaining =
        invalidFiles.length > 5 ? ` (+${invalidFiles.length - 5} file lainnya)` : "";
      setFeedback(
        `Format file tidak sesuai untuk kategori ${uploadConfig.label}. `
          + `File ditolak: ${preview}${remaining}. `
          + `Format yang diizinkan: ${uploadConfig.extensions.join(", ")}`,
      );
      return;
    }

    setIsUploading(true);
    setFeedback("");
    try {
      const result = await uploadDatasetFiles(
        selectedDatasetId,
        filesToUpload,
        uploadConfig.target,
        uploadKind,
      );
      setFeedback(
        `Upload selesai: ${result.saved_count} file (${uploadConfig.label}) ke folder ${uploadConfig.target}.`,
      );
      setFilesToUpload([]);
      setFileInputKey((prev) => prev + 1);
      await onRefresh();
    } catch (error: any) {
      setFeedback(error?.message || "Upload dataset gagal.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <section className="aski-ws-panel">
      <header className="aski-ws-panel-head aski-ws-panel-head-col">
        <h2>
          <FiUploadCloud /> Upload Data
        </h2>
      </header>

      {errorMessage && <p className="aski-ws-inline-error">{errorMessage}</p>}

      <div className="aski-ws-upload-form">
        <div className="aski-ws-form-row">
          <input
            type="text"
            value={newDatasetName}
            onChange={(event) => setNewDatasetName(event.target.value)}
            placeholder="Nama dataset baru (contoh: helm-karyawan)"
          />
          <button
            type="button"
            onClick={handleCreateDataset}
            disabled={isCreating}
          >
            {isCreating ? "Creating..." : "Buat Folder Dataset"}
          </button>
        </div>

        <div className="aski-ws-form-row">
          <select
            value={selectedDatasetId}
            onChange={(event) => setSelectedDatasetId(event.target.value)}
            disabled={!datasets.length || isLoading}
          >
            {datasets.length === 0 ? (
              <option value="">Belum ada dataset</option>
            ) : (
              datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.folder_name || dataset.id} ({dataset.name})
                </option>
              ))
            )}
          </select>
          <select
            value={uploadKind}
            onChange={(event) =>
              setUploadKind(event.target.value as DatasetUploadKind)
            }
          >
            <option value="image">image</option>
            <option value="video">video</option>
            <option value="file">file</option>
            <option value="dll">dll</option>
          </select>
        </div>

        <div className="aski-ws-form-row aski-ws-form-row-file">
          <input
            key={fileInputKey}
            type="file"
            multiple
            accept={uploadConfig.accept}
            onChange={(event) =>
              setFilesToUpload(Array.from(event.target.files ?? []))
            }
          />
          <button
            type="button"
            onClick={handleUpload}
            disabled={isUploading || !selectedDatasetId}
          >
            {isUploading ? "Uploading..." : "Upload ke Dataset"}
          </button>
        </div>

        <div className="aski-ws-upload-hint">
          Dataset tujuan:
          <strong>
            {" "}
            {selectedDataset?.folder_name || selectedDataset?.id || "-"}
          </strong>
          {" | "}
          File dipilih: <strong>{filesToUpload.length}</strong>
          {" | "}
          Target upload:{" "}
          <strong>
            {uploadConfig.label}
            {" -> "}
            {uploadConfig.target}
          </strong>
          {" | "}
          Format: <strong>{uploadConfig.extensions.join(", ")}</strong>
        </div>

        {feedback && <div className="aski-ws-upload-feedback">{feedback}</div>}
      </div>
    </section>
  );
}

function ModelsPanel() {
  const [models, setModels] = useState<ServerModelFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [activePath, setActivePath] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [renameDraftByPath, setRenameDraftByPath] = useState<
    Record<string, string>
  >({});
  const [fileInputKey, setFileInputKey] = useState(0);
  const sourceStats = useMemo(() => {
    const stats = {
      architecture: 0,
      trained: 0,
      custom: 0,
    };
    models.forEach((model) => {
      const key = model.source === "architecture" || model.source === "trained"
        ? model.source
        : "custom";
      stats[key] += 1;
    });
    return stats;
  }, [models]);

  const refreshModels = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const response = await getServerModelFiles();
      const files = Array.isArray(response?.files) ? response.files : [];
      setModels(files);
      setRenameDraftByPath((prev) => {
        const next = { ...prev };
        const known = new Set(files.map((file) => file.path));
        Object.keys(next).forEach((key) => {
          if (!known.has(key)) delete next[key];
        });
        files.forEach((file) => {
          if (!next[file.path]) next[file.path] = file.basename;
        });
        return next;
      });
    } catch (error: any) {
      setModels([]);
      setErrorMessage(error?.message || "Gagal memuat daftar model.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  const handleUploadModels = async () => {
    if (!uploadFiles.length) {
      setFeedbackMessage("Pilih minimal 1 file model (.pt/.onnx).");
      return;
    }

    setIsUploading(true);
    setErrorMessage("");
    setFeedbackMessage("");
    try {
      const response = await uploadServerModelFiles(uploadFiles);
      const savedCount = Number(response?.saved_count || 0);
      const errorCount = Array.isArray(response?.errors)
        ? response.errors.length
        : 0;
      setFeedbackMessage(
        `Upload selesai: ${savedCount} model tersimpan${
          errorCount > 0 ? `, ${errorCount} gagal` : ""
        }.`,
      );
      setUploadFiles([]);
      setFileInputKey((prev) => prev + 1);
      await refreshModels();
    } catch (error: any) {
      setErrorMessage(error?.message || "Upload model gagal.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleRenameModel = async (model: ServerModelFile) => {
    const draft = String(renameDraftByPath[model.path] ?? "").trim();
    if (!draft) {
      setFeedbackMessage("Nama model baru tidak boleh kosong.");
      return;
    }
    if (draft === model.basename) {
      setFeedbackMessage("Nama model tidak berubah.");
      return;
    }

    setActivePath(model.path);
    setErrorMessage("");
    setFeedbackMessage("");
    try {
      await renameServerModelFile(model.path, draft);
      setFeedbackMessage(`Model berhasil di-rename: ${model.basename} -> ${draft}`);
      await refreshModels();
    } catch (error: any) {
      setErrorMessage(error?.message || "Rename model gagal.");
    } finally {
      setActivePath("");
    }
  };

  const handleDeleteModel = async (model: ServerModelFile) => {
    const confirmed = window.confirm(
      `Hapus model '${model.basename}' dari server?`,
    );
    if (!confirmed) return;

    setActivePath(model.path);
    setErrorMessage("");
    setFeedbackMessage("");
    try {
      await deleteServerModelFile(model.path);
      setFeedbackMessage(`Model dihapus: ${model.basename}`);
      await refreshModels();
    } catch (error: any) {
      setErrorMessage(error?.message || "Hapus model gagal.");
    } finally {
      setActivePath("");
    }
  };

  return (
    <section className="aski-ws-panel">
      <header className="aski-ws-panel-head aski-ws-panel-head-col">
        <h2>
          <FiLayers /> Models
        </h2>
        <div className="aski-ws-filter-row">
          <div className="aski-ws-form-row aski-ws-form-row-file">
            <input
              key={fileInputKey}
              type="file"
              multiple
              accept=".pt,.onnx"
              onChange={(event) =>
                setUploadFiles(Array.from(event.target.files ?? []))
              }
            />
            <button
              type="button"
              onClick={handleUploadModels}
              disabled={isUploading}
            >
              {isUploading ? "Uploading..." : "Add Models"}
            </button>
          </div>
          <button
            type="button"
            className="aski-ws-ghost-btn"
            onClick={() => {
              void refreshModels();
            }}
          >
            <FiRefreshCw /> Refresh
          </button>
        </div>
        <div className="aski-ws-upload-hint">
          Model dipilih: <strong>{uploadFiles.length}</strong> | Terdeteksi di
          server: <strong>{models.length}</strong>
          {" | "}Architecture: <strong>{sourceStats.architecture}</strong>
          {" | "}Trained: <strong>{sourceStats.trained}</strong>
          {" | "}Custom: <strong>{sourceStats.custom}</strong>
        </div>
      </header>

      {errorMessage && <p className="aski-ws-inline-error">{errorMessage}</p>}
      {feedbackMessage && (
        <div className="aski-ws-upload-feedback">{feedbackMessage}</div>
      )}

      {isLoading ? (
        <div className="aski-ws-placeholder">
          <p>Loading models...</p>
        </div>
      ) : models.length === 0 ? (
        <div className="aski-ws-placeholder">
          <p>
            Belum ada model lokal. Tambahkan file <code>.pt</code> atau{" "}
            <code>.onnx</code>.
          </p>
        </div>
      ) : (
      <div className="aski-ws-models-table-wrap">
        <table className="aski-ws-models-table">
          <thead>
            <tr>
              <th>Model Name</th>
              <th>Path</th>
              <th>Type</th>
              <th>Source</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => {
              const isBusy = activePath === model.path;
              return (
                <tr key={model.path}>
                  <td>
                    <input
                      type="text"
                      value={renameDraftByPath[model.path] ?? model.basename}
                      onChange={(event) =>
                        setRenameDraftByPath((prev) => ({
                          ...prev,
                          [model.path]: event.target.value,
                        }))
                      }
                      className="aski-ws-model-rename-input"
                      disabled={isBusy}
                    />
                  </td>
                  <td className="aski-ws-model-path-cell" title={model.path}>
                    {model.path}
                  </td>
                  <td>{model.kind}</td>
                  <td>{model.source || "custom"}</td>
                  <td className="aski-ws-model-actions">
                    <button
                      type="button"
                      className="aski-ws-ghost-btn"
                      onClick={() => {
                        void handleRenameModel(model);
                      }}
                      disabled={isBusy}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="aski-ws-danger-btn"
                      onClick={() => {
                        void handleDeleteModel(model);
                      }}
                      disabled={isBusy}
                    >
                      <FiTrash2 /> Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Augment Panel
// ---------------------------------------------------------------------------

interface AugmentPanelProps {
  datasets: DatasetSummary[];
  isLoading: boolean;
  errorMessage: string;
  onRefresh: () => Promise<void>;
}

const TECHNIQUE_GROUP_LABELS: Record<string, string> = {
  geometric: "Geometric",
  color: "Color / Brightness",
  noise: "Noise / Filter",
};

function AugmentPanel({
  datasets,
  isLoading,
  errorMessage,
  onRefresh,
}: AugmentPanelProps) {
  const [techniques, setTechniques] = useState<AugmentationTechnique[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [selectedTechniques, setSelectedTechniques] = useState<Set<string>>(new Set());
  const [copiesPerTechnique, setCopiesPerTechnique] = useState(1);
  const [jobs, setJobs] = useState<AugmentationJob[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [errorAugMessage, setErrorAugMessage] = useState("");

  const selectedDataset = useMemo(
    () => datasets.find((d) => d.id === selectedDatasetId),
    [datasets, selectedDatasetId],
  );

  const datasetNameMap = useMemo(
    () => Object.fromEntries(datasets.map((d) => [d.id, d.name || d.folder_name || d.id])),
    [datasets],
  );

  const runningJobs = useMemo(
    () => jobs.filter((j) => j.status === "queued" || j.status === "running" || j.status === "canceling").length,
    [jobs],
  );

  // Group techniques by category
  const groupedTechniques = useMemo(() => {
    const groups: Record<string, AugmentationTechnique[]> = {};
    for (const t of techniques) {
      if (!groups[t.group]) groups[t.group] = [];
      groups[t.group].push(t);
    }
    return groups;
  }, [techniques]);

  useEffect(() => {
    if (!datasets.length) {
      setSelectedDatasetId("");
      return;
    }
    const stillExists = datasets.some((d) => d.id === selectedDatasetId);
    if (!stillExists) {
      setSelectedDatasetId(datasets[0].id);
    }
  }, [datasets, selectedDatasetId]);

  const refreshTechniques = useCallback(async () => {
    try {
      const items = await listAugmentationTechniques();
      setTechniques(Array.isArray(items) ? items : []);
    } catch {
      setTechniques([]);
    }
  }, []);

  const refreshJobs = useCallback(async () => {
    setIsLoadingJobs(true);
    try {
      const items = await listAugmentationJobs();
      setJobs(Array.isArray(items) ? items : []);
    } catch {
      // silent
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    void refreshTechniques();
    void refreshJobs();
  }, [refreshTechniques, refreshJobs]);

  // Auto-refresh while jobs running
  useEffect(() => {
    if (!runningJobs) return;
    const timer = window.setInterval(() => void refreshJobs(), 2000);
    return () => window.clearInterval(timer);
  }, [runningJobs, refreshJobs]);

  const toggleTechnique = useCallback((id: string) => {
    setSelectedTechniques((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllInGroup = useCallback((group: string) => {
    setSelectedTechniques((prev) => {
      const next = new Set(prev);
      const groupItems = techniques.filter((t) => t.group === group);
      const allSelected = groupItems.every((t) => next.has(t.id));
      for (const t of groupItems) {
        if (allSelected) next.delete(t.id);
        else next.add(t.id);
      }
      return next;
    });
  }, [techniques]);

  const selectAll = useCallback(() => {
    setSelectedTechniques((prev) => {
      if (prev.size === techniques.length) return new Set();
      return new Set(techniques.map((t) => t.id));
    });
  }, [techniques]);

  const handleStartAugment = async () => {
    if (!selectedDatasetId) {
      setErrorAugMessage("Pilih dataset terlebih dahulu.");
      return;
    }
    if (selectedTechniques.size === 0) {
      setErrorAugMessage("Pilih minimal 1 teknik augmentasi.");
      return;
    }

    setIsSubmitting(true);
    setErrorAugMessage("");
    setFeedbackMessage("");
    try {
      const created = await createAugmentationJob({
        dataset_id: selectedDatasetId,
        techniques: Array.from(selectedTechniques),
        copies_per_technique: copiesPerTechnique,
      });
      setFeedbackMessage(`Augmentation job dibuat: ${created.id}`);
      await refreshJobs();
      await onRefresh();
    } catch (error: any) {
      setErrorAugMessage(error?.message || "Gagal membuat augmentation job.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelJob = async (job: AugmentationJob) => {
    if (job.status === "completed" || job.status === "failed" || job.status === "canceled") return;
    if (!window.confirm(`Cancel augmentation job '${job.id}'?`)) return;

    try {
      await cancelAugmentationJob(job.id);
      setFeedbackMessage(`Cancel dikirim untuk job ${job.id}.`);
      await refreshJobs();
    } catch (error: any) {
      setErrorAugMessage(error?.message || "Gagal cancel job.");
    }
  };

  const handleDeleteJob = async (job: AugmentationJob) => {
    if (job.status === "queued" || job.status === "running") {
      setErrorAugMessage("Cancel job dulu sebelum delete.");
      return;
    }
    if (!window.confirm(`Hapus augmentation job '${job.id}'?`)) return;

    try {
      await deleteAugmentationJob(job.id);
      setFeedbackMessage(`Job ${job.id} dihapus.`);
      await refreshJobs();
    } catch (error: any) {
      setErrorAugMessage(error?.message || "Gagal menghapus job.");
    }
  };

  return (
    <section className="aski-ws-panel">
      <header className="aski-ws-panel-head aski-ws-panel-head-col">
        <h2>
          <FiLayers /> Augment Dataset
        </h2>

        <div className="aski-ws-filter-row aski-ws-train-toolbar">
          <label className="aski-ws-train-field" title="Dataset yang akan di-augmentasi.">
            <span>Dataset</span>
            <select
              value={selectedDatasetId}
              onChange={(e) => setSelectedDatasetId(e.target.value)}
            >
              {!datasets.length && <option value="">No dataset</option>}
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.folder_name || d.id})
                </option>
              ))}
            </select>
          </label>
          <label className="aski-ws-train-field" title="Jumlah copy per teknik per gambar.">
            <span>Copies / technique</span>
            <input
              type="number"
              min={1}
              max={10}
              value={copiesPerTechnique}
              onChange={(e) => setCopiesPerTechnique(Math.max(1, Math.min(10, Number(e.target.value || 1))))}
            />
          </label>
          <button
            type="button"
            className="aski-ws-primary-btn"
            onClick={handleStartAugment}
            disabled={isSubmitting || isLoading || !datasets.length || selectedTechniques.size === 0}
          >
            {isSubmitting ? "Processing..." : "Start Augment"}
          </button>
          <button
            type="button"
            className="aski-ws-ghost-btn"
            onClick={() => void refreshJobs()}
          >
            <FiRefreshCw /> Refresh
          </button>
        </div>

        <div className="aski-ws-upload-hint">
          Dataset: <strong>{selectedDataset?.folder_name || "-"}</strong>
          {selectedDataset?.stats && (
            <>
              {" | "}Images: <strong>{selectedDataset.stats.images}</strong>
              {" | "}Labels: <strong>{selectedDataset.stats.labels}</strong>
            </>
          )}
          {" | "}Selected: <strong>{selectedTechniques.size}</strong> technique(s)
          {" | "}Running: <strong>{runningJobs}</strong>
          {copiesPerTechnique > 1 && (
            <>
              {" | "}Est. output: <strong>~{(selectedDataset?.stats?.images || 0) * selectedTechniques.size * copiesPerTechnique}</strong> images
            </>
          )}
          {copiesPerTechnique === 1 && selectedDataset?.stats && (
            <>
              {" | "}Est. output: <strong>~{selectedDataset.stats.images * selectedTechniques.size}</strong> images
            </>
          )}
        </div>
      </header>

      {errorMessage && <p className="aski-ws-inline-error">{errorMessage}</p>}
      {errorAugMessage && <p className="aski-ws-inline-error">{errorAugMessage}</p>}
      {feedbackMessage && <div className="aski-ws-upload-feedback">{feedbackMessage}</div>}

      {/* Technique selection grid */}
      <div className="aski-ws-aug-techniques">
        <div className="aski-ws-aug-select-all-row">
          <button type="button" className="aski-ws-ghost-btn" onClick={selectAll}>
            {selectedTechniques.size === techniques.length ? "Deselect All" : "Select All"}
          </button>
        </div>

        {Object.entries(groupedTechniques).map(([group, items]) => (
          <div key={group} className="aski-ws-aug-group">
            <div className="aski-ws-aug-group-header">
              <strong>{TECHNIQUE_GROUP_LABELS[group] || group}</strong>
              <button
                type="button"
                className="aski-ws-ghost-btn"
                onClick={() => selectAllInGroup(group)}
              >
                {items.every((t) => selectedTechniques.has(t.id)) ? "Deselect" : "Select"} group
              </button>
            </div>
            <div className="aski-ws-aug-grid">
              {items.map((t) => (
                <label
                  key={t.id}
                  className={`aski-ws-aug-card ${selectedTechniques.has(t.id) ? "selected" : ""}`}
                  title={t.description}
                >
                  <input
                    type="checkbox"
                    checked={selectedTechniques.has(t.id)}
                    onChange={() => toggleTechnique(t.id)}
                  />
                  <span className="aski-ws-aug-card-label">{t.label}</span>
                  <span className="aski-ws-aug-card-desc">{t.description}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Jobs table */}
      <div className="aski-ws-jobs-subheader">Augmentation Jobs</div>
      <div className="aski-ws-models-table-wrap aski-ws-train-table-wrap">
        <table className="aski-ws-models-table aski-ws-train-table">
          <thead>
            <tr>
              <th>Job ID</th>
              <th>Dataset</th>
              <th>Techniques</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Generated</th>
              <th>Errors</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!isLoadingJobs && jobs.length === 0 ? (
              <tr>
                <td colSpan={8}>Belum ada augmentation job.</td>
              </tr>
            ) : (
              jobs.map((job) => {
                const pct = job.total > 0 ? Math.round((job.progress / job.total) * 100) : 0;
                const isActive = job.status === "running" || job.status === "canceling";
                const displayPct = isActive ? pct : job.status === "completed" ? 100 : null;
                return (
                  <tr key={job.id}>
                    <td>{job.id}</td>
                    <td title={job.dataset_id}>{datasetNameMap[job.dataset_id] || job.dataset_id}</td>
                    <td className="aski-ws-model-path-cell" title={job.techniques.join(", ")}>
                      {job.techniques.length} technique(s)
                    </td>
                    <td className={`aski-ws-train-status ${job.status}`}>
                      {job.status}
                    </td>
                    <td>
                      {displayPct !== null ? (
                        <div className="aski-ws-aug-progress">
                          <div
                            className="aski-ws-aug-progress-bar"
                            style={{ width: `${displayPct}%` }}
                          />
                          <span className="aski-ws-aug-progress-label">{displayPct}%</span>
                        </div>
                      ) : "-"}
                    </td>
                    <td>{job.generated || 0}</td>
                    <td>{job.errors || 0}</td>
                    <td className="aski-ws-model-actions aski-ws-train-actions">
                      <button
                        type="button"
                        className="aski-ws-ghost-btn"
                        disabled={
                          job.status === "completed"
                          || job.status === "failed"
                          || job.status === "canceled"
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleCancelJob(job);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="aski-ws-danger-btn"
                        disabled={
                          job.status === "queued"
                          || job.status === "running"
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteJob(job);
                        }}
                      >
                        <FiTrash2 /> Delete
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function WorkstationMain({ activeSection }: WorkstationMainProps) {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [isDatasetLoading, setIsDatasetLoading] = useState(false);
  const [datasetErrorMessage, setDatasetErrorMessage] = useState("");

  const refreshDatasets = useCallback(async () => {
    setIsDatasetLoading(true);
    setDatasetErrorMessage("");
    try {
      const fetched = await listDatasets();
      setDatasets(fetched);
    } catch (error: any) {
      setDatasetErrorMessage(error?.message || "Gagal memuat dataset.");
    } finally {
      setIsDatasetLoading(false);
    }
  }, []);

  useEffect(() => {
    if (
      activeSection !== "dataset"
      && activeSection !== "upload-data"
      && activeSection !== "annotate"
      && activeSection !== "augment"
      && activeSection !== "train"
    ) {
      return;
    }
    void refreshDatasets();
  }, [activeSection, refreshDatasets]);

  if (activeSection === "annotate") {
    return (
      <AnnotatePanel
        datasets={datasets}
        isLoading={isDatasetLoading}
        errorMessage={datasetErrorMessage}
        onRefresh={refreshDatasets}
      />
    );
  }
  if (activeSection === "augment") {
    return (
      <AugmentPanel
        datasets={datasets}
        isLoading={isDatasetLoading}
        errorMessage={datasetErrorMessage}
        onRefresh={refreshDatasets}
      />
    );
  }
  if (activeSection === "train") {
    return (
      <TrainPanel
        datasets={datasets}
        isLoading={isDatasetLoading}
        errorMessage={datasetErrorMessage}
        onRefresh={refreshDatasets}
      />
    );
  }
  if (activeSection === "dataset") {
    return (
      <DatasetPanel
        datasets={datasets}
        isLoading={isDatasetLoading}
        errorMessage={datasetErrorMessage}
        onRefresh={refreshDatasets}
      />
    );
  }
  if (activeSection === "models") return <ModelsPanel />;

  if (activeSection === "upload-data") {
    return (
      <UploadDataPanel
        datasets={datasets}
        isLoading={isDatasetLoading}
        errorMessage={datasetErrorMessage}
        onRefresh={refreshDatasets}
      />
    );
  }

  return (
    <AnnotatePanel
      datasets={datasets}
      isLoading={isDatasetLoading}
      errorMessage={datasetErrorMessage}
      onRefresh={refreshDatasets}
    />
  );
}
