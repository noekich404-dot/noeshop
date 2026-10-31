# NOESHOP — Deploy ke Vercel + Supabase
1. Supabase: buat project, jalankan `supabase.sql` di SQL Editor, ambil Project URL + service_role key (Settings > API).
2. Push folder ini ke GitHub, lalu import di vercel.com/new (Framework Preset: Other).
3. Isi Environment Variables sesuai `.env.example` (SUPABASE_URL, SUPABASE_SERVICE_KEY, SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL).
4. Deploy. Request pertama otomatis mengisi data contoh dan membuat akun admin.
Lokal: salin `.env.example` ke `.env`, isi, lalu `bash run.sh`.
