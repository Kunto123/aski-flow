import { useEffect, useMemo, useState } from "react";
import { Modal } from "@mantine/core";
import { createFlowTemplate, FlowTemplateDetail, FlowTemplatePolicy } from "../../api/templates";
import { Node, Edge } from "reactflow";
import { convertFlowToJson, nodesTopologicalSort } from "../../utils/flowUtils";
import { toastErrorMessage, toastInfoMessage } from "../../utils/toastUtils";

interface EditableFieldOption {
  nodeName: string;
  nodeLabel: string;
  fieldName: string;
  fieldLabel: string;
}

interface TemplateSaveModalProps {
  isOpen: boolean;
  nodes: Node[];
  edges: Edge[];
  defaultName: string;
  onClose: () => void;
  onSaved: (template: FlowTemplateDetail) => void;
}

function isTemplateEditableField(field: any): boolean {
  if (!field || field.hidden) {
    return false;
  }

  return !["textToDisplay", "nonRendered", "inputNameBar"].includes(
    String(field.type || ""),
  );
}

export default function TemplateSaveModal({
  isOpen,
  nodes,
  edges,
  defaultName,
  onClose,
  onSaved,
}: TemplateSaveModalProps) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  const [selectedFields, setSelectedFields] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setName(defaultName);
    setDescription("");
    setSelectedFields({});
  }, [defaultName, isOpen]);

  const editableFieldOptions = useMemo<EditableFieldOption[]>(() => {
    return nodes.flatMap((node) => {
      const configFields = node?.data?.config?.fields ?? [];
      return configFields
        .filter(isTemplateEditableField)
        .map((field: any) => ({
          nodeName: String(node?.data?.name || node.id || ""),
          nodeLabel: String(node?.data?.appearance?.customName || node?.data?.config?.nodeName || node?.data?.name || node.id || ""),
          fieldName: String(field?.name || ""),
          fieldLabel: String(field?.label || field?.name || ""),
        }))
        .filter((field: EditableFieldOption) => field.nodeName && field.fieldName);
    });
  }, [nodes]);

  const fieldMapByNode = useMemo(() => {
    const nextMap = new Map<string, EditableFieldOption[]>();
    for (const field of editableFieldOptions) {
      const existing = nextMap.get(field.nodeName) ?? [];
      existing.push(field);
      nextMap.set(field.nodeName, existing);
    }
    return Array.from(nextMap.entries());
  }, [editableFieldOptions]);

  const handleToggleField = (key: string) => {
    setSelectedFields((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleToggleAll = (fields: EditableFieldOption[]) => {
    const allChecked = fields.every(
      (f) => selectedFields[`${f.nodeName}:${f.fieldName}`],
    );
    setSelectedFields((prev) => {
      const next = { ...prev };
      for (const f of fields) {
        next[`${f.nodeName}:${f.fieldName}`] = !allChecked;
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toastInfoMessage("Nama template wajib diisi.");
      return;
    }

    if (nodes.length === 0) {
      toastInfoMessage("Canvas kosong. Tambahkan flow terlebih dahulu.");
      return;
    }

    const sortedNodes = nodesTopologicalSort(nodes, edges);
    const flow = convertFlowToJson(sortedNodes, edges, true, true);

    const policyNodes: FlowTemplatePolicy["nodes"] = {};
    for (const field of editableFieldOptions) {
      const key = `${field.nodeName}:${field.fieldName}`;
      const existing = policyNodes[field.nodeName]?.editableFields ?? [];
      policyNodes[field.nodeName] = {
        editableFields: selectedFields[key]
          ? [...existing, field.fieldName]
          : existing,
      };
    }

    const policy: FlowTemplatePolicy = {
      graphLocked: true,
      nodes: Object.fromEntries(
        Object.entries(policyNodes).map(([nodeName, nodePolicy]) => [
          nodeName,
          {
            editableFields: Array.from(new Set(nodePolicy.editableFields)).sort(),
          },
        ]),
      ),
    };

    setIsSaving(true);
    try {
      const savedTemplate = await createFlowTemplate({
        name: name.trim(),
        description: description.trim(),
        flow,
        policy,
      });
      onSaved(savedTemplate);
      onClose();
    } catch (error: any) {
      const message =
        error?.response?.data?.error ??
        error?.message ??
        "Gagal menyimpan template.";
      toastErrorMessage(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      title="Save Flow as Template"
      centered
      size="lg"
    >
      <div className="aski-template-modal">
        <label className="aski-template-modal-field">
          <span>Template Name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Mis. Kamera QC Line A"
          />
        </label>

        <label className="aski-template-modal-field">
          <span>Description</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Jelaskan tujuan template ini untuk operator."
            rows={3}
          />
        </label>

        <div className="aski-template-modal-section">
          <div className="aski-template-modal-section-title">
            Editable Parameters for Operator
          </div>
          <div className="aski-template-modal-section-subtitle">
            Hanya field yang dicentang di bawah ini yang dapat diubah operator.
          </div>

          <div className="aski-template-modal-groups">
            {fieldMapByNode.length === 0 ? (
              <div className="aski-template-modal-empty">
                Tidak ada field editable yang terdeteksi pada flow ini.
              </div>
            ) : (
              fieldMapByNode.map(([nodeName, fields]) => {
                const allChecked = fields.every(
                  (f) => selectedFields[`${f.nodeName}:${f.fieldName}`],
                );
                return (
                <div key={nodeName} className="aski-template-modal-group">
                  <div className="aski-template-modal-group-title">
                    <span>{fields[0]?.nodeLabel || nodeName}</span>
                    <label className="aski-template-modal-check-all">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={() => handleToggleAll(fields)}
                      />
                      <span>All</span>
                    </label>
                  </div>
                  <div className="aski-template-modal-group-grid">
                    {fields.map((field: EditableFieldOption) => {
                      const key = `${field.nodeName}:${field.fieldName}`;
                      return (
                        <label key={key} className="aski-template-modal-checkbox">
                          <input
                            type="checkbox"
                            checked={Boolean(selectedFields[key])}
                            onChange={() => handleToggleField(key)}
                          />
                          <span>{field.fieldLabel}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ); })
            )}
          </div>
        </div>

        <div className="aski-template-modal-actions">
          <button type="button" className="aski-template-modal-btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="aski-template-modal-btn primary"
            onClick={handleSubmit}
            disabled={isSaving}
          >
            {isSaving ? "Saving..." : "Save Template"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
