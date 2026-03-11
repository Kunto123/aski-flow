import client from "./client";

export interface OcrLanguagesResponse {
  languages: string[];
  count: number;
  recommended: string[];
  tesseract_available: boolean;
  error?: string;
}

export async function getServerOcrLanguages(): Promise<OcrLanguagesResponse> {
  try {
    const response = await client.get("/node/ocr-languages");
    return response.data;
  } catch (nodeRouteError: any) {
    const status = nodeRouteError?.response?.status;
    if (status != null && status !== 404) {
      throw nodeRouteError;
    }
  }

  const response = await client.get("/models/ocr-languages");
  return response.data;
}
