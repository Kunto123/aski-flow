import { NodeConfig } from "./types";

export const recorderNodeConfig: NodeConfig = {
  nodeName: "Recorder",
  processorType: "recorder",
  icon: "FaRecordVinyl",
  showHandlesNames: true,
  inputNames: ["stream_ref"],
  fields: [
    {
      name: "stream_ref",
      label: "Stream Ref",
      type: "input",
      required: true,
      hasHandle: true,
      placeholder: "stream://<id> or /stream/<id>.mjpg",
    },
    {
      name: "duration_seconds",
      label: "Duration (sec)",
      type: "numericfield",
      defaultValue: 5,
      min: 1,
      step: 1,
    },
    {
      name: "fps",
      label: "FPS",
      type: "numericfield",
      defaultValue: 20,
      min: 1,
      step: 1,
    },
  ],
  outputType: "videoUrl",
  section: "tools",
  category: "output",
  helpMessage: "Record live stream to local MP4",
};
