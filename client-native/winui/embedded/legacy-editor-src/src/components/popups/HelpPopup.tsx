import React, { useMemo, useState } from "react";
import styled from "styled-components";
import { useTranslation } from "react-i18next";
import { Badge, Modal, TextInput } from "@mantine/core";
import { FiSearch } from "react-icons/fi";
import { nodeConfigs } from "../../nodes-configuration/nodeConfig";
import { Field, NodeConfig } from "../../nodes-configuration/types";

interface HelpPopupProps {
  isOpen: boolean;
  onClose: () => void;
}

type NodeTutorial = {
  processorType: string;
  nodeName: string;
  section: string;
  outputType: string;
  summary: string;
  requiredFields: string[];
  optionalFields: string[];
  steps: string[];
};

function labelOf(field: Field): string {
  return field.label?.trim() || field.name;
}

function isLikelyTranslationKey(raw: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/.test(raw) && !raw.includes(" ");
}

function buildTutorial(
  processorType: string,
  config: NodeConfig,
  fallbackSummary: string,
): NodeTutorial {
  const requiredFields = config.fields
    .filter((field) => field.required)
    .map((field) => labelOf(field));

  const optionalFields = config.fields
    .filter((field) => !field.required && field.type !== "input")
    .map((field) => labelOf(field))
    .slice(0, 6);

  const inputFields = config.fields
    .filter((field) => field.type === "input")
    .map((field) => labelOf(field));

  const connectionText =
    inputFields.length > 0
      ? `hubungkan input ${inputFields.join(", ")}`
      : "sesuaikan koneksi input sesuai kebutuhan flow";

  const setupText =
    requiredFields.length > 0
      ? `Isi field wajib: ${requiredFields.join(", ")}.`
      : optionalFields.length > 0
        ? `Atur parameter utama: ${optionalFields.join(", ")}.`
        : "Tidak ada field wajib, cukup gunakan pengaturan default lalu uji.";

  return {
    processorType,
    nodeName: config.nodeName,
    section: config.section,
    outputType: config.outputType,
    summary: fallbackSummary,
    requiredFields,
    optionalFields,
    steps: [
      `Tambahkan node ${config.nodeName} ke canvas, lalu ${connectionText}.`,
      setupText,
      `Jalankan node dan cek output bertipe ${config.outputType} di Display atau node berikutnya.`,
    ],
  };
}

const HelpPopup: React.FC<HelpPopupProps> = ({ isOpen, onClose }) => {
  const { t: tFlow } = useTranslation("flow");
  const { t: tNodeHelp } = useTranslation("nodeHelp");
  const [search, setSearch] = useState("");
  const [selectedProcessorType, setSelectedProcessorType] = useState("");

  const tutorials = useMemo(() => {
    const list = Object.entries(nodeConfigs)
      .filter((entry): entry is [string, NodeConfig] => !!entry[1])
      .map(([processorType, config]) => {
        const localizedDescription = tNodeHelp(`${processorType}.description`, {
          defaultValue: "",
        }).trim();

        const localHelpText = config.helpMessage
          ? tFlow(config.helpMessage, { defaultValue: config.helpMessage }).trim()
          : "";

        const summary = localizedDescription
          ? localizedDescription
          : localHelpText && !isLikelyTranslationKey(localHelpText)
            ? localHelpText
            : `${config.nodeName} tutorial singkat untuk penggunaan di flow editor ASKI.`;

        return buildTutorial(processorType, config, summary);
      })
      .sort((a, b) => a.nodeName.localeCompare(b.nodeName));

    return list;
  }, [tFlow, tNodeHelp]);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredTutorials = useMemo(() => {
    if (!normalizedSearch) {
      return tutorials;
    }

    return tutorials.filter((item) => {
      const source = `${item.nodeName} ${item.processorType} ${item.summary}`.toLowerCase();
      return source.includes(normalizedSearch);
    });
  }, [normalizedSearch, tutorials]);

  const selectedTutorial =
    filteredTutorials.find(
      (item) => item.processorType === selectedProcessorType,
    ) || filteredTutorials[0];

  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      title="Help - Node Tutorials"
      size="90%"
      centered
      styles={{
        content: {
          borderRadius: "14px",
          border: "1px solid rgba(255,255,255,0.1)",
          background:
            "radial-gradient(circle at 16% 10%, rgba(229,57,53,0.18), transparent 30%), linear-gradient(160deg, #0d151b 0%, #101c24 100%)",
        },
        title: {
          color: "#f4fbff",
          fontSize: "1.06rem",
          fontWeight: 800,
        },
        header: {
          background: "transparent",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        },
      }}
    >
      <PanelLayout>
        <SidebarPane>
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            leftSection={<FiSearch size={14} />}
            placeholder="Cari node tutorial..."
            radius="md"
          />

          <NodeList>
            {filteredTutorials.map((item) => {
              const active = selectedTutorial?.processorType === item.processorType;
              return (
                <NodeItemButton
                  key={item.processorType}
                  type="button"
                  active={active}
                  onClick={() => setSelectedProcessorType(item.processorType)}
                >
                  <NodeName>{item.nodeName}</NodeName>
                  <NodeType>{item.processorType}</NodeType>
                </NodeItemButton>
              );
            })}
            {filteredTutorials.length === 0 && (
              <EmptyState>Tidak ada tutorial node yang cocok.</EmptyState>
            )}
          </NodeList>
        </SidebarPane>

        <MainPane>
          {!selectedTutorial ? (
            <EmptyState>Pilih node untuk melihat tutorial.</EmptyState>
          ) : (
            <>
              <HeaderRow>
                <TitleWrap>
                  <TutorialTitle>{selectedTutorial.nodeName}</TutorialTitle>
                  <TutorialDescription>{selectedTutorial.summary}</TutorialDescription>
                </TitleWrap>
                <BadgeWrap>
                  <Badge color="red" variant="light">
                    {selectedTutorial.processorType}
                  </Badge>
                  <Badge color="gray" variant="light">
                    {selectedTutorial.section}
                  </Badge>
                </BadgeWrap>
              </HeaderRow>

              <Block>
                <BlockTitle>Langkah Tutorial</BlockTitle>
                <StepList>
                  {selectedTutorial.steps.map((step, index) => (
                    <StepItem key={index}>
                      <StepIndex>{index + 1}</StepIndex>
                      <span>{step}</span>
                    </StepItem>
                  ))}
                </StepList>
              </Block>

              <Grid>
                <Block>
                  <BlockTitle>Field Wajib</BlockTitle>
                  <TokenWrap>
                    {selectedTutorial.requiredFields.length > 0 ? (
                      selectedTutorial.requiredFields.map((field) => (
                        <Token key={field}>{field}</Token>
                      ))
                    ) : (
                      <MutedText>Tidak ada field wajib.</MutedText>
                    )}
                  </TokenWrap>
                </Block>

                <Block>
                  <BlockTitle>Field Opsional Utama</BlockTitle>
                  <TokenWrap>
                    {selectedTutorial.optionalFields.length > 0 ? (
                      selectedTutorial.optionalFields.map((field) => (
                        <Token key={field}>{field}</Token>
                      ))
                    ) : (
                      <MutedText>Tidak ada field opsional utama.</MutedText>
                    )}
                  </TokenWrap>
                </Block>
              </Grid>

              <Block>
                <BlockTitle>Output</BlockTitle>
                <Token>{selectedTutorial.outputType}</Token>
              </Block>
            </>
          )}
        </MainPane>
      </PanelLayout>
    </Modal>
  );
};

const PanelLayout = styled.div`
  display: grid;
  grid-template-columns: minmax(240px, 320px) 1fr;
  gap: 0.95rem;
  min-height: min(76vh, 760px);

  @media (max-width: 950px) {
    grid-template-columns: 1fr;
    min-height: auto;
  }
`;

const SidebarPane = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  padding: 0.72rem;
  min-height: 0;
`;

const NodeList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  overflow: auto;
  min-height: 0;
  padding-right: 0.2rem;
`;

const NodeItemButton = styled.button<{ active: boolean }>`
  text-align: left;
  border-radius: 10px;
  border: 1px solid
    ${(props) =>
      props.active ? "rgba(229,57,53,0.55)" : "rgba(255,255,255,0.1)"};
  background: ${(props) =>
    props.active
      ? "linear-gradient(135deg, rgba(229,57,53,0.22), rgba(116,30,27,0.18))"
      : "rgba(10, 18, 23, 0.78)"};
  padding: 0.56rem 0.64rem;
  color: #eef6fb;
  cursor: pointer;
  transition: border-color 0.18s ease;

  &:hover {
    border-color: rgba(229, 57, 53, 0.5);
  }
`;

const NodeName = styled.div`
  font-size: 0.9rem;
  font-weight: 700;
  color: #f4fbff;
`;

const NodeType = styled.div`
  margin-top: 0.2rem;
  font-size: 0.76rem;
  color: #9cb0bc;
`;

const MainPane = styled.div`
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  padding: 0.95rem;
  overflow: auto;
  min-height: 0;
`;

const HeaderRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.7rem;
  margin-bottom: 0.8rem;
`;

const TitleWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
`;

const TutorialTitle = styled.h3`
  margin: 0;
  color: #f8fcff;
  font-size: 1.1rem;
`;

const TutorialDescription = styled.p`
  margin: 0;
  color: #cfdde6;
  font-size: 0.9rem;
  line-height: 1.45;
`;

const BadgeWrap = styled.div`
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  justify-content: flex-end;
`;

const Block = styled.div`
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  background: rgba(5, 11, 15, 0.5);
  padding: 0.72rem 0.78rem;
  margin-bottom: 0.65rem;
`;

const BlockTitle = styled.h4`
  margin: 0 0 0.5rem;
  color: #ffd6d4;
  font-size: 0.86rem;
  letter-spacing: 0.01em;
`;

const StepList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.42rem;
`;

const StepItem = styled.div`
  display: grid;
  grid-template-columns: 1.4rem 1fr;
  gap: 0.5rem;
  color: #e5eff5;
  font-size: 0.9rem;
  line-height: 1.42;
`;

const StepIndex = styled.span`
  display: inline-flex;
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 999px;
  align-items: center;
  justify-content: center;
  background: rgba(229, 57, 53, 0.3);
  color: #ffe7e5;
  font-size: 0.75rem;
  font-weight: 700;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const TokenWrap = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
`;

const Token = styled.span`
  border-radius: 999px;
  padding: 0.24rem 0.58rem;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.07);
  color: #e9f3fa;
  font-size: 0.78rem;
`;

const EmptyState = styled.div`
  color: #b8c9d3;
  text-align: center;
  margin: auto;
  font-size: 0.9rem;
`;

const MutedText = styled.span`
  color: #9eb0bc;
  font-size: 0.82rem;
`;

export default HelpPopup;
