import { useTranslation } from "react-i18next";
import { NodeSection } from "../../../nodes-configuration/sectionConfig";
import { useState } from "react";

interface SidebarSectionProps {
  section: NodeSection;
  index: number;
  children: React.ReactNode;
}

function SidebarSection({ section, index, children }: SidebarSectionProps) {
  const { t } = useTranslation("flow");
  const [show] = useState<boolean>(true);

  return (
    <div key={index} className={`mb-5 flex flex-col gap-y-2`}>
      <div className="flex flex-row items-center justify-between">
        <h2 className="aski-sidebar-section-title ml-1 py-1 text-sm tracking-wide">
          {t(section.label)}
        </h2>
      </div>

      {show && children}
    </div>
  );
}

export default SidebarSection;
