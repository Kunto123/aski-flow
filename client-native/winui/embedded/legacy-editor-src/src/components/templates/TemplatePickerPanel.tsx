import { FlowTemplateSummary } from "../../api/templates";

interface TemplatePickerPanelProps {
  templates: FlowTemplateSummary[];
  isLoading: boolean;
  errorMessage: string;
  selectedTemplateId?: number | null;
  onRefresh: () => void;
  onSelect: (templateId: number) => void;
}

export default function TemplatePickerPanel({
  templates,
  isLoading,
  errorMessage,
  selectedTemplateId,
  onRefresh,
  onSelect,
}: TemplatePickerPanelProps) {
  return (
    <div className="aski-template-picker">
      <div className="aski-template-picker-head">
        <div>
          <h2 className="aski-template-picker-title">Pilih Template</h2>
          <p className="aski-template-picker-subtitle">
            Pilih flow yang sudah disiapkan admin untuk mulai bekerja.
          </p>
        </div>
      </div>

      {errorMessage && (
        <div className="aski-template-picker-error" role="alert">
          <span>{errorMessage}</span>
          <button
            type="button"
            className="aski-template-picker-refresh"
            onClick={onRefresh}
          >
            Coba Lagi
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="aski-template-picker-empty">Memuat daftar template...</div>
      ) : templates.length === 0 ? (
        <div className="aski-template-picker-empty">
          <span>Belum ada template aktif yang dapat digunakan.</span>
          <button
            type="button"
            className="aski-template-picker-refresh"
            onClick={onRefresh}
          >
            Muat Ulang
          </button>
        </div>
      ) : (
        <div className="aski-template-picker-grid">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              className={`aski-template-card ${
                selectedTemplateId === template.id ? "active" : ""
              }`}
              onClick={() => onSelect(template.id)}
            >
              <div className="aski-template-card-topline">
                <span className="aski-template-card-version">
                  v{template.version_number ?? 1}
                </span>
              </div>
              <h3 className="aski-template-card-title">{template.name}</h3>
              <p className="aski-template-card-description">
                {template.description?.trim() || "Template tanpa deskripsi."}
              </p>
              <div className="aski-template-card-footer">
                <span className="aski-template-card-action">
                  Gunakan template
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
