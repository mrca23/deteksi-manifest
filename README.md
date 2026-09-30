# Deteksi Manifest

Step 1: baca **nomor bagging** dari foto manifest (contoh: MANIFEST PULAU TTE999). Hanya nomor bagging yang diambil. Nomor yang tidak jelas **tidak dimasukkan**.

**Pakai online:** https://mrca23.github.io/deteksi-manifest/

## Cara pakai
1. Foto manifest dari atas, tegak, terang, tidak blur. Seluruh kolom BAGGING masuk foto.
2. Upload foto. Tunggu +-20-40 detik (pertama kali ada unduhan pembaca teks +-5 MB).
3. Hasil: **List Bagging** (nomor urut + nomor bagging, sesuai baris manifest). Keyakinan & potongan gambar ada di "Detail pembacaan". Klik **Salin nomor** / **Unduh .txt**.
4. Bagian **Tidak dimasukkan** berisi yang terbaca mirip nomor bagging tapi tidak lolos: cek manual.

## Proses
1. **Perjelas gambar**: luruskan foto miring (deteksi sudut -10..10 derajat), perbesar ke +-1800 px, abu-abu, ratakan pencahayaan (hilangkan bayangan), regangkan kontras, pertajam, hapus garis tabel, lalu buat versi hitam-putih (Otsu).
2. **Baca** dengan [Tesseract.js](https://github.com/naptha/tesseract.js) di browser, hanya huruf `L Y 0-9`, 4 kali: (abu-abu, hitam-putih) x (mode teks tersebar, mode per kolom).
3. **Saring**: potong kata di celah antar kolom; angka NO di depan `LY` dibuang.

## Aturan "tidak jelas" (tidak dimasukkan)
- Format bukan **LY + 12 angka**.
- Keyakinan baca < 80%.
- Pembacaan ulang di posisi yang sama memberi nomor berbeda.
- Angka di belakang nomor tidak pernah dipotong otomatis (bisa jadi digit yang hilang terisi kolom JUMLAH ISI).

## Hasil uji (foto contoh manifest LABUHA 26-Sep-26, 40 bagging)
| Foto | Benar | Salah | Tidak dimasukkan |
|---|---|---|---|
| Asli | 38 | 0 | 2 (baris 12 & 31 cetakan pudar) |
| Resolusi kecil (600 px) | 36 | 0 | 4 |
| Bayangan / gelap sebelah | 36 | 0 | 3 |
| Miring 4 derajat | 36 | 0 | 3 |
| Buram | 27 | 0 | 10 |

Foto & data uji ada di `test/` (tidak di-commit: repo publik, jangan commit foto manifest / data).
Setiap `app.js` diubah, naikkan `?v=` di `index.html`.
