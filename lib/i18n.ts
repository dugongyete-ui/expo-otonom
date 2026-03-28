/**
 * i18n - Internationalization support for Dzeck AI
 * Supports English (en) and Indonesian (id)
 */
import { getLocales } from "expo-localization";
import { useState, useCallback } from "react";

type Locale = "en" | "id";

const en: Record<string, string> = {
  "Hello": "Hello",
  "Welcome to Dzeck AI": "Welcome to Dzeck AI",
  "Ask me anything": "Ask me anything",
  "Tell me what you want to accomplish": "Tell me what you want to accomplish",
  "New Task": "New Task",
  "New Chat": "New Chat",
  "Create a task to get started": "Create a task to get started",
  "Thinking": "Thinking",
  "Task Progress": "Task Progress",
  "Task Completed": "Task Completed",
  "Delete": "Delete",
  "Just now": "Just now",
  "minutes ago": "minutes ago",
  "hours ago": "hours ago",
  "days ago": "days ago",
  "Agent is working...": "Agent is working...",
  "Agent is waiting for your reply...": "Agent is waiting for your reply...",
  "Type your reply...": "Type your reply...",
  "Tell Dzeck what to do...": "Tell Dzeck what to do...",
  "Ask Dzeck anything...": "Ask Dzeck anything...",
  "Login to Dzeck AI": "Login to Dzeck AI",
  "Register to Dzeck AI": "Register to Dzeck AI",
  "Full Name": "Full Name",
  "Email": "Email",
  "Password": "Password",
  "Confirm Password": "Confirm Password",
  "Enter your full name": "Enter your full name",
  "Enter your email": "Enter your email",
  "Enter password": "Enter password",
  "Enter password again": "Enter password again",
  "Processing...": "Processing...",
  "Login": "Login",
  "Register": "Register",
  "Logout": "Logout",
  "Already have an account?": "Already have an account?",
  "Don't have an account?": "Don't have an account?",
  "Login successful! Welcome back": "Login successful! Welcome back",
  "Registration successful!": "Registration successful!",
  "Authentication failed": "Authentication failed",
  "Passwords do not match": "Passwords do not match",
  "Password must be at least 6 characters": "Password must be at least 6 characters",
  "Forgot Password?": "Forgot Password?",
  "Reset Password": "Reset Password",
  "Send Verification Code": "Send Verification Code",
  "Back to Login": "Back to Login",
  "Share": "Share",
  "Private Only": "Private Only",
  "Only visible to you": "Only visible to you",
  "Public Access": "Public Access",
  "Anyone with the link can view": "Anyone with the link can view",
  "Copy Link": "Copy Link",
  "Link Copied!": "Link Copied!",
  "Settings": "Settings",
  "Language": "Language",
  "English": "English",
  "Indonesian": "Indonesian",
  "Upload failed": "Upload failed",
  "Uploading...": "Uploading...",
  "Exit Takeover": "Exit Takeover",
  "Take Over": "Take Over",
  "Tool": "Tool",
  "Arguments": "Arguments",
  "Result": "Result",
  "Tool is executing...": "Tool is executing...",
  "Waiting for result...": "Waiting for result...",
  "Clear All History": "Clear All History",
  "Cancel": "Cancel",
  "Confirm": "Confirm",
  "Background agent running": "Background agent running",
  "Agent continues in background": "Agent continues in background",
  "Reconnecting...": "Reconnecting...",
  "VNC reconnected": "VNC reconnected",
  "VNC connection failed": "VNC connection failed",
  "Tap to click": "Tap to click",
  "Type here...": "Type here...",
  "Send to desktop": "Send to desktop",
};

const id: Record<string, string> = {
  "Hello": "Halo",
  "Welcome to Dzeck AI": "Selamat datang di Dzeck AI",
  "Ask me anything": "Tanyakan apa saja",
  "Tell me what you want to accomplish": "Ceritakan apa yang ingin kamu capai",
  "New Task": "Tugas Baru",
  "New Chat": "Chat Baru",
  "Create a task to get started": "Buat tugas untuk memulai",
  "Thinking": "Berpikir",
  "Task Progress": "Progres Tugas",
  "Task Completed": "Tugas Selesai",
  "Delete": "Hapus",
  "Just now": "Baru saja",
  "minutes ago": "menit lalu",
  "hours ago": "jam lalu",
  "days ago": "hari lalu",
  "Agent is working...": "Agen sedang bekerja...",
  "Agent is waiting for your reply...": "Agen menunggu balasanmu...",
  "Type your reply...": "Ketik balasanmu...",
  "Tell Dzeck what to do...": "Beritahu Dzeck apa yang harus dilakukan...",
  "Ask Dzeck anything...": "Tanyakan apa saja kepada Dzeck...",
  "Login to Dzeck AI": "Masuk ke Dzeck AI",
  "Register to Dzeck AI": "Daftar ke Dzeck AI",
  "Full Name": "Nama Lengkap",
  "Email": "Email",
  "Password": "Kata Sandi",
  "Confirm Password": "Konfirmasi Kata Sandi",
  "Enter your full name": "Masukkan nama lengkap Anda",
  "Enter your email": "Masukkan email Anda",
  "Enter password": "Masukkan kata sandi",
  "Enter password again": "Masukkan kata sandi lagi",
  "Processing...": "Memproses...",
  "Login": "Masuk",
  "Register": "Daftar",
  "Logout": "Keluar",
  "Already have an account?": "Sudah punya akun?",
  "Don't have an account?": "Belum punya akun?",
  "Login successful! Welcome back": "Login berhasil! Selamat datang kembali",
  "Registration successful!": "Pendaftaran berhasil!",
  "Authentication failed": "Autentikasi gagal",
  "Passwords do not match": "Kata sandi tidak cocok",
  "Password must be at least 6 characters": "Kata sandi minimal 6 karakter",
  "Forgot Password?": "Lupa Kata Sandi?",
  "Reset Password": "Reset Kata Sandi",
  "Send Verification Code": "Kirim Kode Verifikasi",
  "Back to Login": "Kembali ke Login",
  "Share": "Bagikan",
  "Private Only": "Hanya Pribadi",
  "Only visible to you": "Hanya terlihat oleh Anda",
  "Public Access": "Akses Publik",
  "Anyone with the link can view": "Siapa pun dengan tautan bisa melihat",
  "Copy Link": "Salin Tautan",
  "Link Copied!": "Tautan Disalin!",
  "Settings": "Pengaturan",
  "Language": "Bahasa",
  "English": "Inggris",
  "Indonesian": "Indonesia",
  "Upload failed": "Unggah gagal",
  "Uploading...": "Mengunggah...",
  "Exit Takeover": "Keluar Pengambilalihan",
  "Take Over": "Ambil Alih",
  "Tool": "Alat",
  "Arguments": "Argumen",
  "Result": "Hasil",
  "Tool is executing...": "Alat sedang berjalan...",
  "Waiting for result...": "Menunggu hasil...",
  "Clear All History": "Hapus Semua Riwayat",
  "Cancel": "Batal",
  "Confirm": "Konfirmasi",
  "Background agent running": "Agen berjalan di latar belakang",
  "Agent continues in background": "Agen terus berjalan di latar belakang",
  "Reconnecting...": "Menghubungkan kembali...",
  "VNC reconnected": "VNC terhubung kembali",
  "VNC connection failed": "Koneksi VNC gagal",
  "Tap to click": "Ketuk untuk klik",
  "Type here...": "Ketik di sini...",
  "Send to desktop": "Kirim ke desktop",
};

const translations: Record<Locale, Record<string, string>> = { en, id };

let currentLocale: Locale = "en";

try {
  const systemLocale = getLocales()[0]?.languageCode || "en";
  currentLocale = systemLocale.startsWith("id") ? "id" : "en";
} catch {
  currentLocale = "en";
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale) {
  currentLocale = locale;
}

export function t(key: string): string {
  return translations[currentLocale]?.[key] ?? translations["en"]?.[key] ?? key;
}

export function useI18n() {
  const [locale, setLocaleState] = useState<Locale>(currentLocale);

  const changeLocale = useCallback((newLocale: Locale) => {
    setLocale(newLocale);
    setLocaleState(newLocale);
  }, []);

  const translate = useCallback((key: string): string => {
    return translations[locale]?.[key] ?? translations["en"]?.[key] ?? key;
  }, [locale]);

  return { locale, changeLocale, t: translate };
}
