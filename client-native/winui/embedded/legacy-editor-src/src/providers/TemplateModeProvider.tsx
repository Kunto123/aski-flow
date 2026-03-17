import React, { createContext, useContext, useMemo } from "react";
import { FlowTemplatePolicy } from "../api/templates";

interface TemplateModeContextValue {
  templatePolicy: FlowTemplatePolicy | null;
  isTemplateLocked: boolean;
  canEditStructure: boolean;
  isFieldEditable: (nodeName: string, fieldName: string) => boolean;
}

const TemplateModeContext = createContext<TemplateModeContextValue>({
  templatePolicy: null,
  isTemplateLocked: false,
  canEditStructure: true,
  isFieldEditable: () => true,
});

interface TemplateModeProviderProps {
  children: React.ReactNode;
  templatePolicy?: FlowTemplatePolicy | null;
  isTemplateLocked?: boolean;
}

export const TemplateModeProvider: React.FC<TemplateModeProviderProps> = ({
  children,
  templatePolicy,
  isTemplateLocked = false,
}) => {
  const value = useMemo<TemplateModeContextValue>(() => {
    const resolvedPolicy = templatePolicy ?? null;
    return {
      templatePolicy: resolvedPolicy,
      isTemplateLocked,
      canEditStructure: !isTemplateLocked,
      isFieldEditable: (nodeName: string, fieldName: string) => {
        if (!isTemplateLocked) {
          return true;
        }

        const normalizedNodeName = String(nodeName || "").trim();
        const normalizedFieldName = String(fieldName || "").trim();
        if (!normalizedNodeName || !normalizedFieldName) {
          return false;
        }

        const editableFields =
          resolvedPolicy?.nodes?.[normalizedNodeName]?.editableFields ?? [];
        return editableFields.includes(normalizedFieldName);
      },
    };
  }, [isTemplateLocked, templatePolicy]);

  return (
    <TemplateModeContext.Provider value={value}>
      {children}
    </TemplateModeContext.Provider>
  );
};

export function useTemplateMode(): TemplateModeContextValue {
  return useContext(TemplateModeContext);
}
