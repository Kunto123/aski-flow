import { InputHandle, NodeLabel } from "../Node.styles";
import { Position } from "reactflow";
import { Field } from "../../../nodes-configuration/types";
import { DisplayParams } from "../../../hooks/useFormFields";
import { FiFile, FiInfo, FiLink2, FiPlus, FiTrash } from "react-icons/fi";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@mantine/core";
import { useContext, useMemo } from "react";
import { NodeContext } from "../../../providers/NodeProvider";

interface NodeFieldProps<T> {
  field: T;
  renderField: (field: T, isLoopField?: boolean) => JSX.Element;
  label: string;
  nodeId?: string;
  handleId?: string;
  displayParams?: DisplayParams;
  handlePosition?: Position;
  onAddNewField?: () => void;
  onDeleteField?: () => void;
}

function NodeField<
  T extends Pick<
    Field,
    | "required"
    | "label"
    | "hasHandle"
    | "isLinked"
    | "description"
    | "hidden"
    | "type"
  >,
>({
  field,
  displayParams,
  renderField,
  label,
  nodeId,
  handlePosition = Position.Left,
  handleId,
  onAddNewField,
  onDeleteField,
}: NodeFieldProps<T>) {
  const { t } = useTranslation("flow");
  const { getIncomingEdges, findNode } = useContext(NodeContext);

  const selectedNode = nodeId ? findNode(nodeId) : undefined;
  const processorType = selectedNode?.data?.processorType;
  const isDisplayLikeNode =
    processorType === "display" || processorType === "text-display";

  const linkedVariable = useMemo(() => {
    if (!field.isLinked || !nodeId) return "";
    const incomingEdges = getIncomingEdges(nodeId) ?? [];
    const incomingEdge =
      incomingEdges.find((edge) => edge.targetHandle === handleId) ??
      incomingEdges[0];
    if (!incomingEdge) return "//<id>";

    const sourceNode = findNode(incomingEdge.source);
    const sourceId = sourceNode?.data?.name ?? incomingEdge.source ?? "<id>";
    return `//${sourceId}`;
  }, [
    field.isLinked,
    nodeId,
    getIncomingEdges,
    findNode,
    handleId,
  ]);

  const showLinkedVariableField = !!field.isLinked && !isDisplayLikeNode;
  return (
    <>
      {field.label && displayParams?.showLabels && (
        <div className="flex flex-row items-center justify-between ">
          <div className="flex flex-row items-center space-x-5">
            {field.hasHandle && displayParams?.showHandles && (
              <InputHandle
                className="handle custom-handle"
                required={field.required}
                type="target"
                position={handlePosition}
                id={handleId}
              />
            )}
            <div className="flex flex-row items-center justify-center space-x-1">
              <NodeLabel
                className={`font-mono text-lg
                        ${field.isLinked ? "linkedToNode text-sky-400" : ""}  
                        ${field.required ? "font-bold" : ""}`}
              >
                {label}
              </NodeLabel>

              {field.type === "fileUpload" && <FiFile />}
              {field.required ? <span className="text-lg">*</span> : null}
            </div>
          </div>
          {!!field.description && (
            <Tooltip
              label={t(field.description)}
              openDelay={300}
              position="top-start"
              color="dark"
              transitionProps={{ transition: "slide-up", duration: 300 }}
              multiline
            >
              <span>
                <FiInfo className="cursor-pointer text-xl hover:text-teal-300" />
              </span>
            </Tooltip>
          )}
        </div>
      )}
      {!field.isLinked && (
        <div className="flex h-full pb-3">{renderField(field)}</div>
      )}
      {showLinkedVariableField && (
        <div className="flex h-full pb-3">
          <div className="flex w-full items-center justify-between rounded border border-slate-700/60 bg-slate-950/55 px-3 py-2 font-mono text-sm text-slate-300">
            <span>{linkedVariable}</span>
            <FiLink2 className="text-slate-400" />
          </div>
        </div>
      )}

      {onAddNewField && (
        <div className="mt-3 flex w-full justify-end space-x-3">
          <button
            className="flex items-center justify-center rounded-md bg-sky-700 px-5 py-2 text-sm font-medium text-white transition-all duration-200 hover:scale-105 hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-400/50"
            onClick={onAddNewField}
          >
            <FiPlus className="mr-2 h-4 w-4" />
            Add {field.label} field
          </button>
          {onDeleteField && (
            <button
              className="flex items-center justify-center rounded-md bg-red-700 px-5 py-2 text-sm font-medium text-white transition-all duration-200 hover:scale-105 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400/50"
              onClick={onDeleteField}
            >
              <FiTrash className="mr-2 h-4 w-4" />
              Remove {field.label} field
            </button>
          )}
        </div>
      )}
    </>
  );
}

export default NodeField;
