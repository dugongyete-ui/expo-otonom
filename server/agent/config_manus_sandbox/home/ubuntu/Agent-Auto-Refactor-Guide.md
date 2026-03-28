# Panduan Perombakan Agent-Auto (Inspirasi Arsitektur Manus)

Berdasarkan analisis struktur direktori sandbox Manus dan kode sumber `Agent-Auto`, berikut adalah langkah-langkah untuk mengimplementasikan pola kerja yang lebih robust dan transparan.

## 1. Perombakan Struktur Sandbox (`server/agent/tools/e2b_sandbox.py`)

### Masalah Saat Ini:
*   Workspace masih menggunakan `/home/user/dzeck-ai/`.
*   Manajemen paket (`pip install`) dilakukan setiap kali sandbox dibuat, yang memperlambat startup.

### Solusi (Ikuti Pola Manus):
*   **Gunakan Struktur `/home/ubuntu`**: Ubah `WORKSPACE_DIR` menjadi `/home/ubuntu/` agar lebih standar dengan lingkungan cloud Ubuntu.
*   **Implementasikan Pre-installed Packages**: Ubah fungsi `_create_sandbox` agar tidak hanya menginstal paket dasar, tetapi juga menyiapkan folder sistem seperti `skills/` dan `Downloads/`.

```python
# Ubah di server/agent/tools/e2b_sandbox.py
WORKSPACE_DIR = "/home/ubuntu"
# Tambahkan struktur folder standar
sb.commands.run(f"mkdir -p {WORKSPACE_DIR}/skills {WORKSPACE_DIR}/Downloads {WORKSPACE_DIR}/upload")
```

## 2. Perombakan System Prompt (`server/agent/prompts/system.py`)

### Masalah Saat Ini:
*   Prompt sudah cukup baik, tetapi kurang menekankan pada **Transparansi Operasional** (melaporkan setiap detail aksi ke user).

### Solusi (Ikuti Pola Manus):
*   Tambahkan bagian `<reporting_rules>` dan `<transparency_checklist>` yang mewajibkan agen melaporkan isi file setelah ditulis (`file_read` setelah `file_write`).

## 3. Implementasi "Skills" (`/home/ubuntu/skills/`)

### Konsep:
Manus menggunakan folder `skills/` untuk menyimpan logika modular yang bisa dipanggil oleh agen. Anda bisa mengimplementasikan ini dengan membuat folder serupa di sandbox E2B Anda.

---

# Text Prompt untuk AI Agent (Gunakan ini untuk memperbaiki kode)

Copy-paste prompt di bawah ini ke AI Agent (seperti Claude, GPT-4, atau agen coding lainnya) untuk melakukan perbaikan otomatis:

```text
Halo AI Agent, saya ingin merombak proyek "Agent-Auto" saya agar memiliki standar operasional yang setara dengan Manus AI. Berikut adalah instruksi perbaikannya:

1. **Update Sandbox Manager (`server/agent/tools/e2b_sandbox.py`)**:
   - Ubah `WORKSPACE_DIR` dari `/home/user/dzeck-ai` menjadi `/home/ubuntu`.
   - Di dalam fungsi `_create_sandbox`, tambahkan perintah untuk membuat folder standar: `skills/`, `Downloads/`, dan `upload/`.
   - Pastikan setiap startup sandbox juga membuat file `sandbox.txt` di root `/home/ubuntu` sebagai penanda status.

2. **Update System Prompt (`server/agent/prompts/system.py`)**:
   - Tambahkan aturan ketat mengenai "Transparansi": Agen HARUS menggunakan `message_notify_user` untuk melaporkan:
     a. Pemikiran (Chain of Thought) sebelum aksi.
     b. Nama tool dan argumen sebelum eksekusi.
     c. Cuplikan hasil (stdout/isi file) setelah eksekusi.
   - Tambahkan instruksi agar agen selalu melakukan `file_read` setelah melakukan `file_write` untuk verifikasi, dan melaporkan hasilnya ke user.

3. **Update Shell Tool (`server/agent/tools/shell.py`)**:
   - Pastikan `exec_dir` default selalu mengarah ke `/home/ubuntu`.
   - Tambahkan mekanisme untuk mendeteksi jika agen mencoba mengakses folder sistem di luar `/home/ubuntu` dan berikan peringatan keamanan jika perlu.

Tolong lakukan perubahan ini pada file-file terkait di dalam repositori Agent-Auto. Fokus pada peningkatan transparansi dan standarisasi direktori.
```
