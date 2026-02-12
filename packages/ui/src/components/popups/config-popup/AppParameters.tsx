import React, { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppConfig, configMetadata } from "./configMetadata";
import { SocketContext } from "../../../providers/SocketProvider";
import { Button } from "@mantine/core";
import styled from "styled-components";

export default function AppParameters() {
  const { t } = useTranslation("flow");
  const { socket, connect } = useContext(SocketContext);

  // Load configuration from local storage immediately
  const initialConfig: Partial<AppConfig> = JSON.parse(
    localStorage.getItem("appConfig") || "{}",
  );
  const [config, setConfig] = useState<Partial<AppConfig>>(initialConfig);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    connect();
  }, [connect]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target;
    setConfig((prev: Partial<AppConfig>) => {
      const newConfig = { ...prev, [id]: value };
      localStorage.setItem("appConfig", JSON.stringify(newConfig));
      return newConfig;
    });
  };

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    try {
      if (!socket) {
        throw new Error("Socket is not connected");
      }
      socket.emit("update_app_config", config);
      setSuccess("Configuration updated successfully.");
    } catch (err) {
      console.error("Error updating config:", err);
      setError("Failed to update configuration.");
    }
  };

  return (
    <div className="app-parameters">
      {error && <p className="text-red-500">{error}</p>}
      {success && <p className="text-green-500">{success}</p>}

      {(Object.keys(configMetadata) as (keyof AppConfig)[]).map((key) => (
        <Section key={key}>
          <Field key={key}>
            <Label htmlFor={key}>{configMetadata[key].label}</Label>
            {configMetadata[key].description && (
              <p className="text-sm text-slate-400">
                {configMetadata[key].description}
              </p>
            )}
            <Input
              type={configMetadata[key].type}
              id={key}
              value={config[key] || ""}
              onChange={handleChange}
            />
          </Field>
        </Section>
      ))}

      <Button onClick={handleSubmit} color="teal">
        Save Configuration
      </Button>
    </div>
  );
}

const Section = styled.div`
  margin-bottom: 1rem;
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`;

const Label = styled.label`
  font-weight: 600;
`;

const Input = styled.input`
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid #334155;
  background: #0f172a;
  color: #e2e8f0;
`;
