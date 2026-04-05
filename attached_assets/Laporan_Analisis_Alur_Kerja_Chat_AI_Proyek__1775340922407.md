# Laporan Analisis Alur Kerja Chat AI Proyek `ai-manus`

## Pendahuluan
Laporan ini menyajikan analisis komprehensif mengenai alur kerja visualisasi chat AI dalam proyek `ai-manus` dari GitHub (https://github.com/Simpleyyt/ai-manus). Analisis ini mencakup setiap tahapan, mulai dari interaksi pengguna di antarmuka frontend hingga pemrosesan oleh agen AI di backend, termasuk penggunaan berbagai *tool* dan interaksi dengan *sandbox*. Tujuan utama adalah untuk memetakan bagaimana perintah pengguna diproses, diinterpretasikan, dieksekusi, dan hasilnya dikembalikan ke pengguna, dengan fokus pada file-file kode kunci yang terlibat.

## Struktur Proyek
Proyek `ai-manus` memiliki struktur modular yang jelas, memisahkan komponen frontend, backend, dan infrastruktur pendukung. Berikut adalah gambaran umum direktori utama:

*   `backend/`: Berisi logika server-side, API, layanan agen AI, dan interaksi dengan database serta *sandbox*. Dibangun menggunakan FastAPI.
*   `frontend/`: Berisi antarmuka pengguna berbasis web, dibangun dengan Vue.js dan TypeScript. Bertanggung jawab untuk menampilkan interaksi chat dan visualisasi.
*   `sandbox/`: Lingkungan eksekusi terisolasi tempat agen AI menjalankan perintah shell, browser, dan operasi file.
*   `claw/`: Komponen yang kemungkinan terkait dengan integrasi atau ekstensi fungsionalitas agen.
*   `mockserver/`: Menyediakan *mock data* untuk berbagai *tool* (browser, file, message, search, shell) yang digunakan dalam pengembangan atau pengujian.
*   `docs/`: Dokumentasi proyek.

## Analisis Alur Kerja Chat AI
Alur kerja chat AI dalam proyek `ai-manus` dapat dibagi menjadi beberapa fase utama:

### 1. Frontend (Interaksi Pengguna)
Ketika pengguna memasukkan pesan di antarmuka chat:

*   **`frontend/src/pages/ChatPage.vue`**: Ini adalah komponen Vue.js utama yang bertanggung jawab untuk menampilkan antarmuka chat. Di sini, input pengguna ditangkap oleh `ChatBox` dan diproses oleh fungsi `handleSubmit`.
*   **`handleSubmit`**: Fungsi ini memicu panggilan ke API backend melalui `agentApi.chatWithSession`.
*   **`frontend/src/api/agent.ts`**: File ini berisi *wrapper* API frontend untuk endpoint backend terkait sesi. Fungsi `chatWithSession` membuat permintaan POST ke `/api/v1/sessions/{session_id}/chat` dengan pesan pengguna dan lampiran (jika ada). Ini juga menginisialisasi koneksi Server-Sent Events (SSE) untuk menerima *event* secara *real-time* dari backend.

### 2. Backend (API dan Lapisan Layanan)
Permintaan dari frontend diterima dan diproses oleh backend:

*   **`backend/app/main.py`**: Ini adalah *entry point* aplikasi FastAPI. Ia menginisialisasi logging, konfigurasi, koneksi database (MongoDB, Redis), dan mendaftarkan *router* API.
*   **`backend/app/interfaces/api/routes.py`**: Mengumpulkan semua *sub-router* API, termasuk `session_routes`.
*   **`backend/app/interfaces/api/session_routes.py`**: Mendefinisikan endpoint API untuk manajemen sesi, termasuk endpoint `/sessions/{session_id}/chat`. Fungsi `chat` di sini menerima permintaan chat dari frontend dan mendelegasikannya ke `agent_service.chat`. Ini juga bertanggung jawab untuk mengalirkan *event* kembali ke frontend melalui `EventSourceResponse` (SSE).
*   **`backend/app/application/services/agent_service.py`**: Bertindak sebagai lapisan aplikasi yang mengoordinasikan operasi terkait agen. Fungsi `chat` di sini memvalidasi sesi dan pengguna, kemudian memanggil `_agent_domain_service.chat` untuk logika inti pemrosesan AI.
*   **`backend/app/domain/services/agent_domain_service.py`**: Ini adalah koordinator lapisan domain antara layanan HTTP/aplikasi dan sistem tugas latar belakang. Fungsi `chat` di sini adalah inti dari alur kerja backend. Ia bertanggung jawab untuk:
    *   Memuat sesi berdasarkan `session_id` dan `user_id`.
    *   Membuat atau mengambil `Task` (yang diimplementasikan oleh `AgentTaskRunner`) jika sesi belum berjalan.
    *   Memperbarui metadata pesan terbaru.
    *   Mengubah input pengguna menjadi `MessageEvent` dengan peran 'user' dan `FileInfo` untuk lampiran.
    *   Mendorong `MessageEvent` ini ke `task.input_stream`.
    *   Memicu `task.run()`.
    *   Terus-menerus mengambil *event* dari `task.output_stream`, mengurai setiap *payload* JSON menjadi `AgentEvent`, menyimpan pembaruan jumlah pesan yang belum dibaca, dan menghasilkan *event* ke luar (yang kemudian dialirkan kembali ke frontend melalui SSE).

### 3. Logika AI Inti (Agent Task Runner dan Flow)
Ini adalah bagian di mana agen AI benar-benar memproses pesan pengguna dan menghasilkan respons:

*   **`backend/app/domain/services/agent_task_runner.py`**: Ini adalah implementasi `TaskRunner` yang mengonsumsi *event* input sesi dan menghasilkan *event* output agen. Fungsi `run` adalah *loop* utama yang:
    *   Memastikan *sandbox* ada dan menginisialisasi *tool* MCP.
    *   Mengambil pesan input dari `task.input_stream`.
    *   Mengubah `MessageEvent` menjadi objek `Message` domain.
    *   Menyinkronkan lampiran ke *sandbox*.
    *   Menjalankan `_run_flow(message_obj)`, yang mendelegasikan ke `PlanActFlow`.
    *   Menulis setiap *event* yang dihasilkan ke *output stream* dan repositori.
    *   Memperbarui judul sesi, pesan terbaru, jumlah pesan yang belum dibaca, dan status.
    *   Menangani pembatalan atau kesalahan dengan memancarkan `DoneEvent`/`ErrorEvent`.
*   **`backend/app/domain/services/flows/plan_act.py`**: Ini adalah mesin status alur kerja agen inti. Ini mendefinisikan `AgentStatus` (IDLE, PLANNING, EXECUTING, SUMMARIZING, COMPLETED, UPDATING) dan `PlanActFlow`, yang menghubungkan *toolkit* yang tersedia (`ShellToolkit`, `BrowserToolkit`, `FileToolkit`, `MessageToolkit`, `MCPToolkit`, `SearchToolkit` opsional) ke `PlannerAgent` dan `ExecutionAgent`. Dalam fungsi `run(message)`:
    *   Memuat sesi saat ini.
    *   Menentukan apakah akan melanjutkan dalam mode perencanaan atau eksekusi berdasarkan status sesi.
    *   Memperbarui status sesi menjadi `RUNNING`.
    *   Mengembalikan rencana terakhir.
    *   Melakukan *loop* melalui status:
        *   **PLANNING**: `PlannerAgent` membuat rencana (serangkaian langkah) berdasarkan pesan pengguna. Ini menghasilkan `PlanEvent`, `TitleEvent`, dan `MessageEvent` asisten.
        *   **EXECUTING**: `ExecutionAgent` mengambil langkah berikutnya yang belum selesai dari rencana dan mengeksekusinya. Ini menghasilkan *event* langkah, *tool*, dan pesan.
        *   **UPDATING**: `PlannerAgent` memperbarui rencana setelah langkah dieksekusi.
        *   **SUMMARIZING**: `ExecutionAgent` membuat ringkasan akhir.
        *   **COMPLETED**: Memancarkan `PlanEvent(status=COMPLETED)` dan `DoneEvent`.

### 4. Interaksi dengan Tools dan Sandbox
Selama fase EXECUTING, `ExecutionAgent` menggunakan berbagai *toolkit* untuk berinteraksi dengan lingkungan *sandbox* dan layanan eksternal:

*   **`backend/app/domain/services/tools/`**: Direktori ini berisi implementasi berbagai *toolkit*:
    *   `shell.py` (`ShellToolkit`): Untuk menjalankan perintah shell di *sandbox*.
    *   `browser.py` (`BrowserToolkit`): Untuk berinteraksi dengan browser di *sandbox* (misalnya, navigasi, screenshot).
    *   `file.py` (`FileToolkit`): Untuk operasi file di *sandbox* (baca, tulis, edit).
    *   `message.py` (`MessageToolkit`): Untuk mengirim pesan kembali ke pengguna.
    *   `mcp.py` (`MCPToolkit`): Untuk berinteraksi dengan *Model Context Protocol* (MCP) server.
    *   `search.py` (`SearchToolkit`): Untuk melakukan pencarian menggunakan mesin pencari eksternal.
*   **`backend/app/domain/external/sandbox.py`**: Antarmuka untuk berinteraksi dengan lingkungan *sandbox* yang sebenarnya. Ini mencakup metode untuk menjalankan perintah shell, membaca/menulis file, dan mengelola browser.
*   **`backend/app/domain/external/search.py`**: Antarmuka untuk mesin pencari eksternal.

### 5. Event Streaming Kembali ke Frontend
*Event* yang dihasilkan oleh `AgentTaskRunner` (seperti pesan asisten, *tool call*, status langkah, dll.) dialirkan kembali ke frontend melalui SSE.

*   **`backend/app/interfaces/schemas/event.py`**: Mendefinisikan skema untuk *event* agen yang dikirim melalui SSE. `EventMapper` mengonversi objek `AgentEvent` domain internal menjadi *payload* yang ramah SSE.
*   **`frontend/src/pages/ChatPage.vue`**: Fungsi `handleEvent` di frontend menerima *event* SSE ini dan memperbarui UI chat secara dinamis, menampilkan pesan asisten, output *tool*, status langkah, dan informasi lainnya.

## Visualisasi Alur Kerja
Berikut adalah diagram yang memvisualisasikan alur kerja chat AI dari input pengguna hingga output AI:

![Alur Kerja Chat AI](https://private-us-east-1.manuscdn.com/sessionFile/Ct3qmqANhccbNstLcB2yTX/sandbox/iyEZedpghagJD7xKVJD1Ag-images_1775334917976_na1fn_L2hvbWUvdWJ1bnR1L2FpLW1hbnVzL2NoYXRfd29ya2Zsb3c.png?Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvQ3QzcW1xQU5oY2NiTnN0TGNCMnlUWC9zYW5kYm94L2l5RVplZHBnaGFnSkQ3eEtWSkQxQWctaW1hZ2VzXzE3NzUzMzQ5MTc5NzZfbmExZm5fTDJodmJXVXZkV0oxYm5SMUwyRnBMVzFoYm5WekwyTm9ZWFJmZDI5eWEyWnNiM2MucG5nIiwiQ29uZGl0aW9uIjp7IkRhdGVMZXNzVGhhbiI6eyJBV1M6RXBvY2hUaW1lIjoxNzk4NzYxNjAwfX19XX0_&Key-Pair-Id=K2HSFNDJXOU9YS&Signature=GILuIyxz4oJ-SxMdOQbem0O93MCNMMoipBOPJv9Reb-KiKaS-UHERdg5Rt~xC8ojohlWYC0eI6f84209~cdC7Y6he~~kwn2~crKvYalzhxIJhDPNopxkZhqXlbfEPVp05fnW60HkwfJo38YGfnZwT8~3YOeqROrzmGDoHYweqI5z2cnvYLOa87m70~ebv-NVsuaB2kAwwfWNV88b0OUti0heVf9r4Z4NAfFh7HObu~u0fDbL2AdeqkR64bJfC1069rSvKoGNgN79AAyQWn6q0lLpvQ1M~hHRcCd3UI9QVjJY9ZXg0r1CJeVYcnv1aDOjTDdwOrXVcNH6BHw7TqSKwQ__)

## Kesimpulan
Proyek `ai-manus` mengimplementasikan alur kerja chat AI yang canggih dan modular. Dimulai dari input pengguna di frontend, pesan tersebut melewati serangkaian layanan backend yang mengoordinasikan agen perencanaan dan eksekusi. Agen-agen ini menggunakan berbagai *tool* untuk berinteraksi dengan lingkungan *sandbox* dan layanan eksternal, menghasilkan *event* yang kemudian dialirkan kembali ke frontend untuk pembaruan UI secara *real-time*. Arsitektur ini memungkinkan fleksibilitas tinggi dalam menambahkan *tool* baru dan mengelola kompleksitas interaksi AI.
