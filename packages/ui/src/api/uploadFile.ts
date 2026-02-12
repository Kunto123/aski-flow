import axios, { AxiosProgressEvent } from "axios";
import client from "./client";

export async function getUploadAndDownloadUrl(filename?: string) {
  try {
    const data = { filename };
    const response = await client.get("/upload", { params: data });
    return response.data;
  } catch (error) {
    console.error("Error while trying to get upload link :", error);
    throw error;
  }
}

// Week-2 (Local Storage v2): direct multipart upload to the backend.
// Backend will return { download_link } and store the asset locally.
export async function uploadLocalFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await client.post("/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return response.data;
  } catch (error) {
    console.error("Error uploading file locally :", error);
    throw error;
  }
}

export async function uploadWithS3Link(s3UploadData: any, file: File) {
  const config = {
    onUploadProgress: (progressEvent: AxiosProgressEvent) => {
      if (!progressEvent.total) return;

      const percentCompleted = Math.round(
        (progressEvent.loaded * 100) / progressEvent.total,
      );

      console.log(`Upload progress: ${percentCompleted}%`);
    },
  };

  try {
    const url = s3UploadData.url;
    const fields = s3UploadData.fields;

    const formData = new FormData();

    Object.keys(fields).forEach((key) => {
      formData.append(key, fields[key]);
    });

    formData.append("file", file);

    await axios.post(url, formData, config);
  } catch (error) {
    console.error("Error uploading file :", error);
    throw error;
  }
}
