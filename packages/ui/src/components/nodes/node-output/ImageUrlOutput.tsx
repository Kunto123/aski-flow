import React, { useEffect, useState } from "react";
import { FaDownload } from "react-icons/fa";
import styled from "styled-components";
import { getGeneratedFileName, isStreamUrl } from "./outputUtils";
import { toastErrorMessage } from "../../../utils/toastUtils";
import { useTranslation } from "react-i18next";

interface ImageUrlOutputProps {
  url: string;
  name: string;
  fitInContainer?: boolean;
  fitMode?: "contain" | "cover" | "fill";
}

const ImageUrlOutput: React.FC<ImageUrlOutputProps> = ({
  url,
  name,
  fitInContainer = false,
  fitMode = "contain",
}) => {
  const { t } = useTranslation("flow");
  const [hasError, setHasError] = useState(false);
  const downloadAllowed = !isStreamUrl(url);

  useEffect(() => {
    setHasError(false);
  }, [url]);

  const handleDownloadClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (hasError) {
      toastErrorMessage("URL Expired");
      return;
    }
    const link = document.createElement("a");
    link.href = url;
    link.download = getGeneratedFileName(url, name);
    link.target = "_blank";
    link.click();
  };

  const handleError = () => {
    setHasError(true);
  };

  const handleLoad = () => {
    setHasError(false);
  };

  return (
    <OutputImageContainer $fitInContainer={fitInContainer}>
      {hasError ? (
        <p className="text-center"> {t("ExpiredURL")}</p>
      ) : (
        <>
          <OutputImage
            $fitInContainer={fitInContainer}
            $fitMode={fitMode}
            src={url}
            alt="Output Image"
            onError={handleError}
            onLoad={handleLoad}
          />
          {downloadAllowed && (
            <div
              className="absolute right-3 top-2 rounded-md bg-slate-600/75 px-1 py-1 text-2xl text-slate-100 hover:bg-sky-600/90"
              onClick={handleDownloadClick}
            >
              <FaDownload />
            </div>
          )}
        </>
      )}
    </OutputImageContainer>
  );
};

const OutputImageContainer = styled.div<{ $fitInContainer: boolean }>`
  position: relative;
  margin-top: ${({ $fitInContainer }) => ($fitInContainer ? "0" : "10px")};
  width: 100%;
  height: ${({ $fitInContainer }) => ($fitInContainer ? "100%" : "auto")};
  display: ${({ $fitInContainer }) => ($fitInContainer ? "flex" : "block")};
  align-items: ${({ $fitInContainer }) =>
    $fitInContainer ? "center" : "stretch"};
  justify-content: ${({ $fitInContainer }) =>
    $fitInContainer ? "center" : "stretch"};
  overflow: hidden;
`;

const OutputImage = styled.img<{
  $fitInContainer: boolean;
  $fitMode: "contain" | "cover" | "fill";
}>`
  display: block;
  width: 100%;
  height: ${({ $fitInContainer }) => ($fitInContainer ? "100%" : "auto")};
  max-width: 100%;
  max-height: ${({ $fitInContainer }) => ($fitInContainer ? "100%" : "none")};
  object-fit: ${({ $fitInContainer, $fitMode }) =>
    $fitInContainer ? $fitMode : "initial"};
  border-radius: 8px;
`;

export default ImageUrlOutput;
