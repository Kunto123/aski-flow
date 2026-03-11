import React, { useContext, useEffect, useState } from "react";
import { AppConfig, configMetadata } from "./configMetadata";
import { SocketContext } from "../../../providers/SocketProvider";
import { Button } from "@mantine/core";
import styled from "styled-components";

export default function AppParameters() {
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

      <Button onClick={handleSubmit} color="red" radius="md">
        Save Configuration
      </Button>
    </div>
  );
}

const Section = styled.div`
  margin-bottom: 0.72rem;
  padding: 0.78rem 0.85rem;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
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
  padding: 0.54rem 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(12, 22, 28, 0.92);
  color: #e8eff4;

  &:focus {
    outline: none;
    border-color: rgba(229, 57, 53, 0.56);
    box-shadow: 0 0 0 2px rgba(229, 57, 53, 0.2);
  }
`;
