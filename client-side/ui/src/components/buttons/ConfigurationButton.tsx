import React, { memo } from "react";
import { FiSettings } from "react-icons/fi";
import styled from "styled-components";

interface RightButtonProps {
  onClick: () => void;
  color?: string;
  icon?: React.ReactNode;
  text?: string;
  bottom?: string;
}

const RightIconButton: React.FC<RightButtonProps> = ({
  onClick,
  color = "linear-gradient(135deg, #cf2f2a 0%, #85110f 100%)",
  icon = <FiSettings />,
  bottom = "30px",
}) => {
  return (
    <StyledRightButton
      className="config-button fixed right-0 z-20 mx-auto flex w-11 items-center rounded-l-lg py-1 pl-1 transition-all duration-150 ease-linear"
      color={color}
      bottom={bottom}
      onClick={onClick}
    >
      <div className="fon align-middle text-xl text-slate-100">{icon}</div>
    </StyledRightButton>
  );
};

const StyledRightButton = styled.div<{ color: string; bottom: string }>`
  bottom: ${(props) => props.bottom};
  background: ${(props) => props.color};
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-right: none;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);
  cursor: pointer;

  &:hover {
    filter: brightness(1.08);
  }
`;

export default memo(RightIconButton);
