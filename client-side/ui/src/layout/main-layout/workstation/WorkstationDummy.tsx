import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiCpu,
  FiDatabase,
  FiEdit3,
  FiLayers,
  FiRefreshCw,
  FiTrash2,
  FiUploadCloud,
} from "react-icons/fi";
import { MdOutlineModelTraining } from "react-icons/md";
import {
  createDataset,
  listDatasetFiles,
  listDatasets,
  uploadDatasetFiles,
  type DatasetFileItem,
  type DatasetSummary,
} from "../../../api/datasets";
import {
  deleteServerModelFile,
  getServerModelFiles,
  renameServerModelFile,
  uploadServerModelFiles,
  type ServerModelFile,
} from "../../../api/models";

export type WorkstationSection =
  | "upload-data"
  | "annotate"
  | "dataset"
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
  { id: "train", label: "Train" },
  { id: "models", label: "Models" },
];

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

function AnnotatePanel() {
  const buckets = [
    { title: "Unassigned", count: 0, subtitle: "labels" },
    { title: "Annotating", count: 0, subtitle: "labels" },
    { title: "Dataset", count: 0, subtitle: "labels" },
  ];

  return (
    <section className="aski-ws-panel">
      <header className="aski-ws-panel-head">
        <h2>
          <FiEdit3 /> Annotate
        </h2>
        <div className="aski-ws-inline-field">
          <span>Sort By</span>
          <select defaultValue="latest">
            <option value="latest">Latest</option>
            <option value="oldest">Oldest</option>
            <option value="name">Name</option>
          </select>
        </div>
      </header>

      <div className="aski-ws-annotate-grid">
        {buckets.map((bucket) => (
          <article key={bucket.title} className="aski-ws-stat-card">
            <div className="aski-ws-stat-title">{bucket.title}</div>
            <div className="aski-ws-stat-count">{bucket.count}</div>
            <div className="aski-ws-stat-subtitle">{bucket.subtitle}</div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TrainPanel() {
  const architectures = ["RF-DETR", "YOLOv5", "YOLOv11", "YOLOv12"];

  return (
    <section className="aski-ws-panel">
      <header className="aski-ws-panel-head aski-ws-panel-head-col">
        <h2>
          <MdOutlineModelTraining /> Train Models
        </h2>
        <div className="aski-ws-inline-field">
          <span>Train</span>
          <select defaultValue="train">
            <option value="train">Train</option>
            <option value="resume">Resume</option>
          </select>
        </div>
        <div className="aski-ws-inline-field">
          <span>Select Architecture</span>
          <select defaultValue="choose">
            <option value="choose">Choose architecture</option>
            <option value="rf-detr">RF-DETR</option>
            <option value="yolov5">YOLOv5</option>
            <option value="yolov11">YOLOv11</option>
            <option value="yolov12">YOLOv12</option>
          </select>
        </div>
      </header>

      <div className="aski-ws-train-grid">
        {architectures.map((name) => (
          <button key={name} type="button" className="aski-ws-train-card">
            <FiCpu />
            <span>{name}</span>
          </button>
        ))}
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
  const [fileErrorMessage, setFileErrorMessage] = useState("");

  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDatasetId),
    [datasets, selectedDatasetId],
  );

  useEffect(() => {
    if (!datasets.length) {
      setSelectedDatasetId("");
      setFiles([]);
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

  const handleRefresh = async () => {
    await onRefresh();
    await loadDatasetContents(selectedDatasetId, selectedTarget);
  };

  const canShowPreview =
    selectedTarget === "images" || selectedTarget === "videos";

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
            disabled={!hasDatasets || isLoading}
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
            disabled={!hasDatasets}
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
          >
            <FiRefreshCw /> Refresh
          </button>
        </div>
      </header>

      {errorMessage && <p className="aski-ws-inline-error">{errorMessage}</p>}
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
          {files.map((file) => (
            <article key={`${file.target}-${file.name}`} className="aski-ws-image-card">
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
          ))}
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
  const [targetFolder, setTargetFolder] = useState<"images" | "labels" | "videos">("images");
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
    setIsUploading(true);
    setFeedback("");
    try {
      const result = await uploadDatasetFiles(
        selectedDatasetId,
        filesToUpload,
        targetFolder,
      );
      setFeedback(
        `Upload selesai: ${result.saved_count} file ke folder ${targetFolder}.`,
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
            value={targetFolder}
            onChange={(event) =>
              setTargetFolder(event.target.value as "images" | "labels" | "videos")
            }
          >
            <option value="images">images</option>
            <option value="labels">labels</option>
            <option value="videos">videos</option>
          </select>
        </div>

        <div className="aski-ws-form-row aski-ws-form-row-file">
          <input
            key={fileInputKey}
            type="file"
            multiple
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
    if (activeSection !== "dataset" && activeSection !== "upload-data") return;
    void refreshDatasets();
  }, [activeSection, refreshDatasets]);

  if (activeSection === "annotate") return <AnnotatePanel />;
  if (activeSection === "train") return <TrainPanel />;
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

  return <AnnotatePanel />;
}
