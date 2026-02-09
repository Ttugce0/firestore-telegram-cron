require("dotenv").config();
const axios = require("axios");
const db = require("./firebase");

/* =========================
   TELEGRAM MESAJ
========================= */
async function telegramMesajGonder(mesaj) {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;

  try {
    await axios.post(url, {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: mesaj,
      parse_mode: "HTML",
    });
  } catch (err) {
    console.error(
      "Telegram gönderim hatası:",
      err.response?.data || err.message
    );
  }
}

/* =========================
   GÜN FARKI HESAPLAMA
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
   ANA CRON İŞİ
========================= */
async function otomatikOdemeKontrolu() {
  const snapshot = await db.collection("odemeler").get();
  let bildirimSayisi = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    if (!data.sonOdemeTarihi || data.hatirlatmaAktif === false) continue;

    const gunFarki = gunFarkiHesapla(data.sonOdemeTarihi);
    if (gunFarki === null) continue;

    const firmaAdi = data.firmaAdi || "Bilinmiyor";
    const kategori = data.kategori || data.aciklama || "Bilinmiyor";

    const toplamTutar = Number(data.tutar) || 0;
    const odenenTutar = Number(data.odenenTutar) || 0;
    const kalanTutar = Math.max(toplamTutar - odenenTutar, 0);

    const sonOdeme = data.sonOdemeTarihi;

    /* ❌ GECİKMİŞ ÖDEME */
    if (gunFarki < 0 && data.gecikmeBildirildi !== true) {
      await telegramMesajGonder(
        `❌ <b>ÖDEME GECİKMESİ</b>\n\n` +
        `🏢 <b>Firma:</b> ${firmaAdi}\n` +
        `📂 <b>Kategori:</b> ${kategori}\n` +
        `💳 <b>Toplam:</b> ${toplamTutar} ₺\n` +
        `💰 <b>Ödenen:</b> ${odenenTutar} ₺\n` +
        `🧾 <b>Kalan:</b> ${kalanTutar} ₺\n` +
        `📅 <b>Son Ödeme:</b> ${sonOdeme}\n` +
        `⏱ <b>Gecikme:</b> ${Math.abs(gunFarki)} gün`
      );

      await doc.ref.update({
        gecikmeBildirildi: true,
        gecikmeSonBildirimTarihi: new Date().toLocaleDateString("tr-TR"),
      });

      bildirimSayisi++;
    }

    /* ⚠️ HATIRLATMA */
    if (
      gunFarki === data.hatirlatmaGunOnce &&
      data.hatirlatmaGonderildi === false
    ) {
      await telegramMesajGonder(
        `⚠️ <b>ÖDEME HATIRLATMA</b>\n\n` +
        `🏢 <b>Firma:</b> ${firmaAdi}\n` +
        `📂 <b>Kategori:</b> ${kategori}\n` +
        `💳 <b>Toplam:</b> ${toplamTutar} ₺\n` +
        `💰 <b>Ödenen:</b> ${odenenTutar} ₺\n` +
        `🧾 <b>Kalan:</b> ${kalanTutar} ₺\n` +
        `📅 <b>Son Ödeme:</b> ${sonOdeme}\n` +
        `⏳ <b>Kalan Süre:</b> ${gunFarki} gün`
      );

      await doc.ref.update({
        hatirlatmaGonderildi: true,
      });

      bildirimSayisi++;
    }
  }

  console.log(`GitHub Action → ${bildirimSayisi} bildirim gönderildi`);
}

/* =========================
   ÇALIŞTIR
========================= */
(async () => {
  try {
    await otomatikOdemeKontrolu();
  } catch (err) {
    console.error("Cron genel hata:", err);
  } finally {
    process.exit(0);
  }
})();
