import { useMemo } from "react";
import styled from "styled-components";
import { useTranslation } from "react-i18next";
import { Modal } from "@mantine/core";
import DisplayParameters from "./DisplayParameters";
import { useVisibility } from "../../../providers/VisibilityProvider";
import AppParameters from "./AppParameters";

interface ConfigPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onValidate?: () => void;
}

const ConfigPopup = ({ isOpen }: ConfigPopupProps) => {
  const { t } = useTranslation("config");
  const logoSrc = useMemo(() => {
    return `${import.meta.env.BASE_URL}img/aski_logo.png`;
  }, []);

  const { getElement, configActiveTab, setConfigActiveTab } = useVisibility();
  const configPopup = getElement("configPopup");

  const handleClose = () => {
    configPopup.hide();
  };

  return (
    <Modal
      opened={isOpen}
      onClose={handleClose}
      withCloseButton={false}
      size="50%"
      centered
      styles={{
        content: {
          borderRadius: "16px",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          boxShadow: "0 26px 48px rgba(0, 0, 0, 0.45)",
          background:
            "radial-gradient(circle at 10% 12%, rgba(229, 57, 53, 0.2), transparent 36%), radial-gradient(circle at 88% 90%, rgba(41, 95, 112, 0.28), transparent 42%), linear-gradient(158deg, #0c141a 0%, #10181f 46%, #091116 100%)",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          padding: "1.5rem",
          color: "#e6eef4",
          minHeight: "100%",
        },
        header: {
          background: "transparent",
        },
      }}
    >
      <Content>
        <BrandHeader>
          <BrandLogo src={logoSrc} alt="ASKI" />
          <BrandMeta>
            <BrandTitle>ASKI Settings</BrandTitle>
            <BrandSubtitle>Client UI and runtime preferences</BrandSubtitle>
          </BrandMeta>
        </BrandHeader>

        <Tabs className="sm:text-md text-base">
          <Tab
            isActive={configActiveTab === "app"}
            onClick={() => setConfigActiveTab("app")}
          >
            {t("appParametersLabel")}
          </Tab>
          <Tab
            isActive={configActiveTab === "display"}
            onClick={() => setConfigActiveTab("display")}
          >
            {t("displayTabLabel")}
          </Tab>
        </Tabs>
        {configActiveTab === "display" ? (
          <DisplayParameters />
        ) : (
          <AppParameters />
        )}
        <Footer>
          <Message>ASKI configuration center</Message>
          <SubMessage>Local settings are stored on this ASKI client.</SubMessage>
        </Footer>
      </Content>
    </Modal>
  );
};

const Content = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 0.95rem;
  overflow: auto;
`;

const BrandHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 0.85rem;
  border-radius: 12px;
  border: 1px solid rgba(229, 57, 53, 0.35);
  background: linear-gradient(
    135deg,
    rgba(229, 57, 53, 0.18) 0%,
    rgba(14, 30, 38, 0.45) 75%
  );
  padding: 0.75rem 0.9rem;
`;

const BrandLogo = styled.img`
  width: clamp(96px, 18vw, 164px);
  height: auto;
  user-select: none;
`;

const BrandMeta = styled.div`
  display: flex;
  flex-direction: column;
`;

const BrandTitle = styled.h2`
  margin: 0;
  font-size: 1rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: #f6fafc;
`;

const BrandSubtitle = styled.p`
  margin: 0.15rem 0 0;
  font-size: 0.83rem;
  color: #c9d7df;
`;

const Tabs = styled.div`
  display: flex;
  justify-content: flex-start;
  gap: 0.5rem;
  margin-top: 0.15rem;
`;

const Tab = styled.button<{ isActive: boolean }>`
  padding: 0.55rem 0.95rem;
  font-weight: 700;
  color: ${(props) => (props.isActive ? "#f8fdff" : "#b8c7cf")};
  background: ${(props) =>
    props.isActive
      ? "linear-gradient(135deg, rgba(229, 57, 53, 0.25), rgba(95, 26, 24, 0.35))"
      : "rgba(255, 255, 255, 0.04)"};
  border-radius: 999px;
  border: 1px solid
    ${(props) =>
      props.isActive ? "rgba(229, 57, 53, 0.5)" : "rgba(255, 255, 255, 0.08)"};
  cursor: pointer;
  transition:
    color 0.3s,
    border-color 0.3s,
    background-color 0.3s;

  &:hover {
    color: #fff;
    border-color: rgba(229, 57, 53, 0.45);
  }
`;

const Footer = styled.div`
  margin-top: 0.45rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  font-size: 0.88rem;
  color: #d1dde4;
`;

const Message = styled.p`
  margin: 0;
`;

const SubMessage = styled.p`
  margin: 0.18rem 0 0;
  font-size: 0.78rem;
  color: #93a8b3;
`;

export default ConfigPopup;
