# Laporan Analisis Alur Kerja AI-Manus

Proyek **ai-manus** adalah sistem AI Agent serbaguna yang dirancang untuk menjalankan berbagai alat dalam lingkungan sandbox yang terisolasi. Laporan ini merinci alur kerja sistem dari perintah awal pengguna hingga visualisasi akhir.

## Ringkasan Proyek
Proyek ini menggunakan arsitektur **Domain-Driven Design (DDD)** dengan pemisahan tanggung jawab yang jelas antara antarmuka pengguna (frontend), logika bisnis (backend), dan lingkungan eksekusi (sandbox).

| Komponen | Teknologi Utama | Peran |
| :--- | :--- | :--- |
| **Frontend** | Vue.js / Vite / TailwindCSS | Antarmuka chat, visualisasi rencana, dan penampil VNC. |
| **Backend** | Python / FastAPI / LangChain | Manajemen sesi, logika agent (planner & execution), dan SSE. |
| **Sandbox** | Docker / Ubuntu / Chrome | Lingkungan terisolasi untuk eksekusi tool (Shell, Browser, File). |
| **Database** | MongoDB / Redis | Penyimpanan riwayat sesi dan manajemen state. |

## Alur Kerja: Dari Perintah hingga Hasil Akhir

Proses dimulai saat pengguna memasukkan perintah di **ChatBox.vue**. Berikut adalah tahapan detailnya:

### 1. Inisialisasi dan Pengiriman Pesan
Frontend mengirimkan pesan melalui endpoint `POST /api/v1/sessions/{session_id}/chat`. Backend kemudian memastikan keberadaan **Sandbox Docker** melalui `Docker Sandbox Manager`. Jika belum ada, sistem akan membuat container Ubuntu baru yang sudah terinstal Chrome dan API sandbox.

### 2. Siklus Perencanaan dan Eksekusi (Agent Loop)
Pesan pengguna diteruskan ke **Agent Domain Service**. Di sini, sistem menggunakan dua komponen utama:
- **Planner (`planner.py`)**: Menganalisis perintah dan memecahnya menjadi langkah-langkah logis (misalnya: buka browser -> cari informasi -> tulis file).
- **Execution (`execution.py`)**: Menjalankan setiap langkah dengan memanggil API tool di dalam sandbox.

### 3. Visualisasi Real-time dan Umpan Balik
Sistem memberikan umpan balik instan kepada pengguna menggunakan **Server-Sent Events (SSE)**. Ini memungkinkan frontend memperbarui UI tanpa perlu me-refresh halaman:
- **`ChatMessage.vue`**: Menampilkan teks respons dari AI.
- **`PlanPanel.vue`**: Memvisualisasikan daftar rencana dan status setiap langkah (sedang berjalan, selesai, atau gagal).
- **`VNCViewer.vue`**: Jika agent menggunakan browser, tampilannya dipancarkan secara langsung melalui protokol VNC over WebSocket, sehingga pengguna bisa melihat interaksi browser secara real-time.

### 4. Penyelesaian Tugas
Setelah semua langkah selesai, agent mengirimkan event `done`. Sesi tetap aktif di database sehingga pengguna dapat melihat kembali riwayat atau melanjutkan percakapan nanti.

## Lokasi Kode Kunci
Bagi pengembang yang ingin mempelajari implementasinya, berikut adalah file-file terpenting:

- **Logika Agent**: `backend/app/domain/services/agents/` (Planner & Execution).
- **Integrasi Tool**: `backend/app/domain/services/tools/` dan API di folder `sandbox/`.
- **Streaming SSE**: `backend/app/interfaces/api/routes.py` (endpoint chat).
- **Komponen UI**: `frontend/src/components/` (ChatBox, PlanPanel, VNCViewer).

---
*Laporan ini disusun berdasarkan analisis repositori GitHub [Simpleyyt/ai-manus](https://github.com/Simpleyyt/ai-manus).*
