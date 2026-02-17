# ASKI Flow (Local‑First)

ASKI Flow adalah sistem workflow **node‑based** yang berjalan **100% lokal** (offline / LAN). Fokus checkpoint Week 5: **stream execution + main vision model (YOLO) + filter nodes (dummy)**, dengan UI yang sudah bisa menyambungkan node input→processing→output.

---

## Quickstart (Local Dev)

### 1) Backend

```bash
cd packages/backend
poetry install
poetry run python server.py
```

Backend default berjalan di `http://localhost:5000`.

### 2) UI

```bash
cd packages/ui
npm install
npm start
```

UI default berjalan di `http://localhost:3000`.

---

## Catatan Penting (Local‑First)

### YOLO weights **tidak auto-download**

Node **Main Vision Model** butuh file weights lokal.

**Rekomendasi**: simpan di folder `packages/backend/models/` atau root `models/` (sesuai `model_path` yang kamu set di node).

Contoh:

```text
models/yolov8n.pt
```

Jika file tidak ada, node akan error (dan UI akan berhenti spinning + menampilkan error).

### Kamera tidak berhenti setelah node dihapus?

Di Week 5, stream manager sudah di‑patch agar:

1) **Stop dependents** (overlay/transform stream) ketika stream sumber dihentikan.
2) Menggunakan backend kamera yang lebih “kooperatif” untuk release device.

Jika masih bermasalah di Windows, set env berikut sebelum menjalankan backend:

```bash
set ASKI_CAMERA_BACKEND=dshow
```

Opsi lain: `msmf`, `any`.

---

## Guide Node (Week 5)

Di UI, node‑node dibagi menjadi:

- **Input**: File / Video / Audio, Trigger, Live Cam
- **Processing**: Main Vision Model + filter nodes (ROI, AR Overlay, dll)
- **Output**: Display, Text Display, Recorder, Lamp Control (dummy)

> **Catatan:** beberapa node filter masih **dummy** (sesuai roadmap) tapi sudah tersedia di UI dan bisa disambungkan.

### 1) File / Video / Audio Input

**Tipe:** `file`, `video`, `audio`

**Tujuan:** upload file lokal ke storage backend.

**Output (index):**

- `0`: URL asset, contoh: `/asset/<filename>`

---

### 2) Trigger

**Processor:** `trigger`

**Tujuan:** memicu node downstream secara manual dan mengirim payload.

**Fields:**

- `payload` (JSON/string)

**Output:**

- `0`: payload (string)

---

### 3) Camera Input (Live Cam)

**Processor:** `camera-input`

**Fields:**

- `camera_index` (default `0`)
- `fps` (default `20`)

**Output (index):**

- `0`: `stream://<stream_id>`
- `1`: MJPEG URL, contoh: `/stream/<stream_id>.mjpg`

**Stop behavior:**

- Saat node dihapus dari canvas, UI memanggil stop stream, dan backend akan release camera handle.

---

### 4) Main Vision Model (YOLO)

**Processor:** `main-vision-model`

**Input:**

- `input_url` (asset URL atau `stream://...`)

**Fields:**

- `model_path` (contoh: `models/yolov8n.pt`)
- `conf_threshold` (0..1)
- `classes` (opsional): filter class yang mau dideteksi.
  - Bisa isi `person,car` atau `0,2` (angka = class id)

**Output (index):**

- `0`: JSON string (predictions/payload)
- `1`: `stream://<overlay_stream_id>` (untuk mode stream)
- `2`: MJPEG URL overlay (untuk mode stream)
- `3`: predictions URL (untuk mode stream)

---

### 5) ROI

**Processor:** `roi`

**Input:**

- `input_url`

**Fields:**

- `x,y,w,h` (0..1)

**Output:**

- URL image hasil crop (atau stream ref jika stream)

---

### 6) Image Processing

**Processor:** `image-processing`

**Input:** `input_url`

**Fields (opsional):** resize, grayscale, blur, threshold.

**Output:** image URL

---

### 7) AR Overlay

**Processor:** `ar-overlay`

**Input:**

- `image_url`
- `predictions_json`

**Output:** image URL overlay

---

### 8) Conditional State

**Processor:** `conditional-state`

**Input:**

- `input_json`

**Output (2 port):**

- `0`: pass‑through jika kondisi TRUE
- `1`: pass‑through jika kondisi FALSE

---

### 9) Python Code

**Processor:** `python-code`

**Input:** `payload`

**Fields:**

- `code` (python snippet)
- `timeout_sec`

**Output:** JSON string dari variable `result`

---

### 10) Display

**Tipe:** `display`

**Input:** URL image/video atau stream ref.

**Output:** none (viewer)

---

### 11) Text Display

**Tipe:** `text-display`

**Input:** text/JSON.

---

### 12) Recorder

**Processor:** `recorder`

**Input:** `stream_ref`

**Output:** video URL (`.mp4`)

---

### 13) Face Recognition / QR Reader / OCR Reader / Lamp Control / Ergonomic Check

**Status:** Dummy (Week 5)

Node‑node ini sudah ada untuk menyamakan UI dengan roadmap, tetapi implementasi model/logic detail masuk Week berikutnya.

---

## Troubleshooting

### UI “spinning” lama

Jika node error (misal `model_path` tidak ditemukan), sekarang UI akan:

- menghentikan spinner pada node
- menampilkan popup error

### Kamera tidak release

Set `ASKI_CAMERA_BACKEND=dshow` (Windows) atau coba `msmf`.

---

## Roadmap

Checkpoint ini sesuai target **Week 5** pada `ROADMAP.txt`.


## Model Registry (Week 7 skeleton)

- `GET /models` list registered models
- `POST /models/upload` multipart `file` (ZIP package with `manifest.json`)
- `POST /models/<id>/validate`

Model packages are stored under `data/models/<model_id>/`.

## Dataset Manager (Week 8 skeleton)

- `GET /datasets`
- `POST /datasets` JSON `{name, classes[]}`

Datasets are stored under `data/datasets/<dataset_id>/` with subfolders `images/labels/videos/splits/exports`.

## Camera Stop on Windows (USB)

If your USB webcam remains locked after stopping, set the backend explicitly:

- PowerShell:
  - `setx ASKI_CAMERA_BACKEND dshow`

Then restart backend.

