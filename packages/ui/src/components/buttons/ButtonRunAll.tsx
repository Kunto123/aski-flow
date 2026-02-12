import styled, { keyframes } from "styled-components";
import { FaPlay, FaSpinner } from "react-icons/fa";
import { memo } from "react";
import TapScale from "../shared/motions/TapScale";
import { Tooltip } from "react-tooltip";

interface ButtonRunAllProps {
  onClick: () => void;
  isRunning: boolean;
  small?: boolean;
}
const ButtonRunAll: React.FC<ButtonRunAllProps> = ({
  onClick,
  isRunning,
  small,
}) => {
  return (
    <TapScale>
      <button
        id="run-all-button"
        className={`aski-runall flex flex-row items-center justify-center gap-x-4 
                ${isRunning ? "bg-white/70 text-slate-700" : "bg-white text-slate-600"}
                z-50 cursor-pointer
                rounded-2xl
                font-extrabold tracking-wide
                shadow-lg ring-1 ring-black/5
                transition-all hover:bg-white/95`}
        onClick={onClick}
      >
        {isRunning ? (
          <Spinner className="text-2xl" />
        ) : (
          <FaPlay className="text-2xl text-emerald-600" />
        )}
        {!small && <div className="text-lg">RUN ALL</div>}
      </button>
    </TapScale>
  );
};

export default memo(ButtonRunAll);

const spin = keyframes`
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
`;

const Spinner = styled(FaSpinner)`
  animation: ${spin} 1s linear infinite;
`;
