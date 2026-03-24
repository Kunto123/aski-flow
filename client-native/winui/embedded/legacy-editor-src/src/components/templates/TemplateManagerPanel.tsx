import { useCallback, useEffect, useState } from "react";
import { Modal } from "@mantine/core";
import {
  FlowTemplateSummary,
  FlowTemplateDetail,
  listFlowTemplates,
  updateFlowTemplate,
  getFlowTemplate,
} from "../../api/templates";
import { toastErrorMessage, toastInfoMessage } from "../../utils/toastUtils";

interface TemplateManagerPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called when admin clicks "Load into canvas" — returns a Promise */
  onLoad: (templateId: number) => Promise<void>;
}

interface EditState {
  name: string;
  description: string;
}

export default function TemplateManagerPanel({
  isOpen,
  onClose,
  onLoad,
}: TemplateManagerPanelProps) {
  const [templates, setTemplates] = useState<FlowTemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Inline edit state — keyed by template id
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState>({ name: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [loadingTemplateId, setLoadingTemplateId] = useState<number | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listFlowTemplates({ includeInactive: true });
      setTemplates(data);
    } catch (err: any) {
      setError(err?.response?.data?.error ?? err?.message ?? "Gagal memuat template.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadTemplates();
      setEditingId(null);
    }
  }, [isOpen, loadTemplates]);

  // ── Toggle active / inactive ──────────────────────────────────────────────
  const handleToggleActive = async (template: FlowTemplateSummary) => {
    const next = !template.is_active;
    try {
      await updateFlowTemplate(template.id, { is_active: next });
      toastInfoMessage(
        `Template "${template.name}" ${next ? "diaktifkan" : "dinonaktifkan"}.`,
      );
      await loadTemplates();
    } catch (err: any) {
      toastErrorMessage(
        err?.response?.data?.error ?? err?.message ?? "Gagal mengubah status template.",
      );
    }
  };

  // ── Start inline edit ─────────────────────────────────────────────────────
  const handleStartEdit = (template: FlowTemplateSummary) => {
    setEditingId(template.id);
    setEditState({
      name: template.name,
      description: template.description ?? "",
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  // ── Save inline edit ──────────────────────────────────────────────────────
  const handleSaveEdit = async (template: FlowTemplateSummary) => {
    const trimmedName = editState.name.trim();
    if (!trimmedName) {
      toastInfoMessage("Nama template tidak boleh kosong.");
      return;
    }
    setSaving(true);
    try {
      await updateFlowTemplate(template.id, {
        name: trimmedName,
        description: editState.description.trim(),
      });
      toastInfoMessage(`Template "${trimmedName}" diperbarui.`);
      setEditingId(null);
      await loadTemplates();
    } catch (err: any) {
      toastErrorMessage(
        err?.response?.data?.error ?? err?.message ?? "Gagal menyimpan template.",
      );
    } finally {
      setSaving(false);
    }
  };

  // ── Load into canvas ──────────────────────────────────────────────────────
  const handleLoad = async (templateId: number) => {
    setLoadingTemplateId(templateId);
    try {
      await onLoad(templateId);
      onClose();
    } catch {
      // Error already handled & toasted inside handleApplyTemplate
    } finally {
      setLoadingTemplateId(null);
    }
  };

  const activeCount = templates.filter((t) => t.is_active).length;

  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      title="Manage Templates"
      centered
      size="xl"
    >
      <div className="aski-tmgr">
        {/* Header bar */}
        <div className="aski-tmgr-head">
          <span className="aski-tmgr-count">
            {templates.length} template &mdash; {activeCount} aktif
          </span>
          <button
            type="button"
            className="aski-template-toolbar-btn ghost"
            onClick={() => void loadTemplates()}
            disabled={loading}
          >
            {loading ? "Memuat..." : "Refresh"}
          </button>
        </div>

        {error && (
          <div className="aski-template-picker-error" role="alert">
            {error}
          </div>
        )}

        {!loading && templates.length === 0 && !error && (
          <div className="aski-template-picker-empty">Belum ada template.</div>
        )}

        {/* Template list */}
        <div className="aski-tmgr-list">
          {templates.map((template) => {
            const isEditing = editingId === template.id;
            return (
              <div
                key={template.id}
                className={`aski-tmgr-row${template.is_active ? "" : " inactive"}`}
              >
                {/* Left: info or edit form */}
                <div className="aski-tmgr-info">
                  {isEditing ? (
                    <div className="aski-tmgr-edit-form">
                      <input
                        className="aski-tmgr-edit-input"
                        value={editState.name}
                        onChange={(e) =>
                          setEditState((s) => ({ ...s, name: e.target.value }))
                        }
                        placeholder="Nama template"
                        autoFocus
                      />
                      <textarea
                        className="aski-tmgr-edit-textarea"
                        value={editState.description}
                        onChange={(e) =>
                          setEditState((s) => ({ ...s, description: e.target.value }))
                        }
                        placeholder="Deskripsi (opsional)"
                        rows={2}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="aski-tmgr-name">
                        <span
                          className={`aski-tmgr-badge${template.is_active ? " active" : " inactive"}`}
                        >
                          {template.is_active ? "Aktif" : "Nonaktif"}
                        </span>
                        <span className="aski-tmgr-version">
                          v{template.version_number ?? 1}
                        </span>
                        {template.name}
                      </div>
                      {template.description && (
                        <div className="aski-tmgr-desc">{template.description}</div>
                      )}
                      <div className="aski-tmgr-meta">
                        ID {template.id}
                        {template.updated_at
                          ? ` · diperbarui ${new Date(template.updated_at).toLocaleDateString("id-ID")}`
                          : template.created_at
                            ? ` · dibuat ${new Date(template.created_at).toLocaleDateString("id-ID")}`
                            : ""}
                      </div>
                    </>
                  )}
                </div>

                {/* Right: action buttons */}
                <div className="aski-tmgr-actions">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        className="aski-template-toolbar-btn primary"
                        onClick={() => void handleSaveEdit(template)}
                        disabled={saving}
                      >
                        {saving ? "Menyimpan..." : "Simpan"}
                      </button>
                      <button
                        type="button"
                        className="aski-template-toolbar-btn ghost"
                        onClick={handleCancelEdit}
                        disabled={saving}
                      >
                        Batal
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="aski-template-toolbar-btn"
                        onClick={() => void handleLoad(template.id)}
                        disabled={loadingTemplateId !== null}
                        title="Muat ke canvas"
                      >
                        {loadingTemplateId === template.id ? "Memuat..." : "Load"}
                      </button>
                      <button
                        type="button"
                        className="aski-template-toolbar-btn ghost"
                        onClick={() => handleStartEdit(template)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={`aski-template-toolbar-btn ghost${template.is_active ? " danger" : ""}`}
                        onClick={() => void handleToggleActive(template)}
                        title={template.is_active ? "Nonaktifkan" : "Aktifkan"}
                      >
                        {template.is_active ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
