import { useContext, useEffect, useState } from "react";
import { NodeRuntimeContext } from "../providers/NodeProvider";

/**
 * This hook stop playing animation whenever an error is raised globaly.
 */
export const useIsPlaying = (): [
  boolean,
  React.Dispatch<React.SetStateAction<boolean>>,
] => {
  const { errorCount } = useContext(NodeRuntimeContext);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  useEffect(() => {
    setIsPlaying(false);
  }, [errorCount]);

  return [isPlaying, setIsPlaying];
};
