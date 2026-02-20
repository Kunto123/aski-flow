import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Checkbox, Divider, TextInput } from "@mantine/core";
import styled from "styled-components";
import { nodeConfigs } from "../../../nodes-configuration/nodeConfig";
import { getNodesHiddenList, saveNodesHiddenList } from "./parameters";
import { toastFastSuccessMessage } from "../../../utils/toastUtils";
import {
  getNonGenericNodeConfig,
  transformNodeConfigsToDndNode,
} from "../../../nodes-configuration/sectionConfig";
import { useVisibility } from "../../../providers/VisibilityProvider";
import { FiSearch } from "react-icons/fi";

export default function DisplayParameters() {
  const { t } = useTranslation("flow");
  const { t: tc } = useTranslation("config");
  const { getElement } = useVisibility();
  const minimap = getElement("minimap");

  const [nodesHidden, setNodesHidden] = useState<string[]>(getNodesHiddenList());
  const [search, setSearch] = useState("");

  function handleCheckField(key: string): void {
    if (nodesHidden.includes(key)) {
      setNodesHidden(nodesHidden.filter((node) => node !== key));
      return;
    }
    setNodesHidden([...nodesHidden, key]);
  }

  function handleSave(): void {
    saveNodesHiddenList(nodesHidden);
    toastFastSuccessMessage(tc("configUpdated"));
  }

  const allNodes = useMemo(
    () =>
      transformNodeConfigsToDndNode(nodeConfigs).concat(getNonGenericNodeConfig()),
    [],
  );

  const normalizedSearch = search.trim().toLowerCase();

  const nodesBySection = useMemo(() => {
    const grouped = allNodes.reduce((acc: Record<string, any[]>, node) => {
      const section = node.section || "Default";
      if (!acc[section]) {
        acc[section] = [];
      }
      acc[section].push(node);
      return acc;
    }, {});

    return Object.entries(grouped)
      .map(([section, nodes]) => {
        const filteredNodes = nodes.filter((node) => {
          if (!normalizedSearch) {
            return true;
          }
          const label = t(node.label ?? node.type).toLowerCase();
          return label.includes(normalizedSearch);
        });
        return { section, nodes: filteredNodes };
      })
      .filter((entry) => entry.nodes.length > 0);
  }, [allNodes, normalizedSearch, t]);

  return (
    <Container>
      <SectionTitle>{tc("displayTabLabel")}</SectionTitle>

      <Toolbar>
        <TopControlCard>
          <h3>{tc("UI")}</h3>
          <Checkbox
            label={tc("ShowMinimap")}
            size="sm"
            color="cyan"
            checked={minimap.isVisible}
            onChange={() => minimap.toggle()}
          />
        </TopControlCard>

        <SearchWrap>
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder={tc("Search") || "Search nodes"}
            leftSection={<FiSearch size={14} />}
            radius="md"
          />
        </SearchWrap>
      </Toolbar>

      <Divider my="sm" />

      <SectionTitle>{tc("Core Nodes")}</SectionTitle>

      <SectionsScroll>
        <SectionsGrid>
          {nodesBySection.map(({ section, nodes }) => (
            <SectionCard key={section}>
              <SectionHeader>{tc(section)}</SectionHeader>
              <NodeGrid>
                {nodes.map((node) => (
                  <NodeItem key={node.type}>
                    <Checkbox
                      label={t(node.label ?? node.type)}
                      size="sm"
                      color="cyan"
                      checked={!nodesHidden.includes(node.type)}
                      onChange={() => handleCheckField(node.type)}
                    />
                  </NodeItem>
                ))}
              </NodeGrid>
            </SectionCard>
          ))}
        </SectionsGrid>
      </SectionsScroll>

      <Actions>
        <Button onClick={handleSave} color="teal" radius="md">
          {tc("validateButtonLabel")}
        </Button>
      </Actions>
    </Container>
  );
}

const Container = styled.div`
  width: min(100%, 980px);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const SectionTitle = styled.h3`
  margin: 0.1rem 0 0.2rem;
  font-weight: 700;
  color: #d9edf2;
`;

const Toolbar = styled.div`
  display: grid;
  grid-template-columns: minmax(220px, 320px) 1fr;
  gap: 0.9rem;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const TopControlCard = styled.div`
  border-radius: 12px;
  padding: 0.85rem 1rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;

  h3 {
    margin: 0;
    font-size: 0.95rem;
    color: #c9dce1;
  }
`;

const SearchWrap = styled.div`
  display: flex;
  align-items: center;
`;

const SectionsScroll = styled.div`
  max-height: min(52vh, 500px);
  overflow-y: auto;
  overflow-x: hidden;
  padding-right: 0.3rem;
`;

const SectionsGrid = styled.div`
  display: grid;
  gap: 0.85rem;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
`;

const SectionCard = styled.div`
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  background: rgba(255, 255, 255, 0.025);
  padding: 0.8rem 0.9rem;
`;

const SectionHeader = styled.h4`
  margin: 0 0 0.65rem;
  font-size: 0.9rem;
  color: #9cc5d1;
`;

const NodeGrid = styled.div`
  display: grid;
  gap: 0.45rem;
`;

const NodeItem = styled.div`
  padding: 0.4rem 0.5rem;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid transparent;
  transition: border-color 0.14s ease;

  &:hover {
    border-color: rgba(112, 194, 214, 0.35);
  }
`;

const Actions = styled.div`
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  padding-top: 0.65rem;
  background: linear-gradient(to top, rgba(16, 17, 19, 0.95), rgba(16, 17, 19, 0));
`;
