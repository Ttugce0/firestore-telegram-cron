require("dotenv").config();
const axios = require("axios");
const db = require("./firebase");

/* =========================
   TELEGRAM MESAJ
========================= */
async function telegramMesajGonder(mesaj) {
  try {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;

    await axios.post(url, {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: mesaj,
      parse_mode: "HTML",
    });

    console.log("✅ Telegram mesajı gönderildi");
  } catch (err) {
    console.error("❌ Telegram gönderim hatası");
    if (err.response) {
      console.error(err.response.data);
    } else {
      console.error(err.message);
    }
  }
}

/* =========================
   GÜN FARKI (son ödeme)
   negatif => gecikmiş
========================= */
function gunFarkiHesapla(tarih) {
  const bugun = new Date();
  let hedef = null;

  // Firestore Timestamp
  if (tarih && typeof tarih === "object" && tarih.toDate) {
    hedef = tarih.toDate();
  }
  // String tarih
  else if (typeof tarih === "string") {
    // TR format: 01.02.2026
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(tarih)) {
      const [g, a, y] = tarih.split(".");
      hedef = new Date(`${y}-${a}-${g}`);
    } else {
      hedef = new Date(tarih);
    }
  }

  if (!hedef || isNaN(hedef.getTime())) return null;

  bugun.setHours(0, 0, 0, 0);
  hedef.setHours(0, 0, 0, 0);

  return Math.ceil((hedef - bugun) / (1000 * 60 * 60 * 24));
}

/* =========================
   STRING TARİH FARKI
   (gecikmeSonBildirimTarihi)
========================= */
function gunFarkiStringTarih(tarihStr) {
  if (!tarihStr) return null;

  if (/^\d{2}\.\d{2}\.\d{4}$/.test(tarihStr)) {
    const [g, a, y] = tarihStr.split(".");
    const tarih = new Date(`${y}-${a}-${g}`);
    const bugun = new Date();

    tarih.setHours(0, 0, 0, 0);
    bugun.setHours(0, 0, 0, 0);

    return Math.floor((bugun - tarih) / (1000 * 60 * 60 * 24));
  }

  return null;
}

/* =========================
   ANA CRON İŞİ
   → GECİKMİŞLER İÇİN
   → HAFTADA 1 MESAJ
========================= */
async function otomatikOdemeKontrolu() {
  const snapshot = await db.collection("odemeler").get();
  let bildirimSayisi = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    // zorunlu kontroller
    if (!data.sonOdemeTarihi) continue;
    if (data.durum === "odendi") continue;

    const gunFarki = gunFarkiHesapla(data.sonOdemeTarihi);

    // gecikmiş değilse geç
    if (gunFarki === null || gunFarki >= 0) continue;

    const firmaAdi = data.firmaAdi || "Bilinmiyor";
    const kategori = data.kategori || data.aciklama || "Bilinmiyor";

    const toplamTutar = Number(data.tutar) || 0;
    const odenenTutar = Number(data.odenenTutar) || 0;
    const kalanTutar = Math.max(toplamTutar - odenenTutar, 0);

    const sonOdeme = data.sonOdemeTarihi;

    // son bildirimin üzerinden kaç gün geçmiş
    const sonBildirimGun = gunFarkiStringTarih(
      data.gecikmeSonBildirimTarihi
    );

    // 🔁 HAFTADA 1 KURAL
    const tekrarGonder =
      data.gecikmeBildirildi !== true ||
      sonBildirimGun === null ||
      sonBildirimGun >= 7;

    if (!tekrarGonder) continue;

    // 📩 TELEGRAM
    await telegramMesajGonder(
      `❌ <b>GECİKMİŞ ÖDEME</b>\n\n` +
      `🏢 <b>Firma:</b> ${firmaAdi}\n` +
      `📂 <b>Kategori:</b> ${kategori}\n` +
      `💳 <b>Toplam:</b> ${toplamTutar} ₺\n` +
      `💰 <b>Ödenen:</b> ${odenenTutar} ₺\n` +
      `🧾 <b>Kalan:</b> ${kalanTutar} ₺\n` +
      `📅 <b>Son Ödeme:</b> ${sonOdeme}\n` +
      `⏱ <b>Gecikme:</b> ${Math.abs(gunFarki)} gün`
    );

    // 📝 FIRESTORE GÜNCELLE
    await doc.ref.update({
      gecikmeBildirildi: true,
      gecikmeSonBildirimTarihi: new Date().toLocaleDateString("tr-TR"),
    });

    bildirimSayisi++;
  }

  console.log(
    `GitHub Action → ${bildirimSayisi} gecikmiş ödeme bildirimi gönderildi`
  );
}

/* =========================
   ÇALIŞTIR
========================= */
(async () => {
  try {
    await otomatikOdemeKontrolu();
  } catch (err) {
    console.error("❌ Cron çalışırken hata:", err);
  } finally {
    process.exit(0);
  }
})();
