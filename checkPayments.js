require("dotenv").config();
const axios = require("axios");
const db = require("./firebase");

/* =========================
   CRON BAŞLANGIÇ LOG
========================= */
console.log("🕒 CRON BASLADI");
console.log("NOW (ISO):", new Date().toISOString());
console.log("NOW (TR):", new Date().toLocaleString("tr-TR"));

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
    if (err.response) console.error(err.response.data);
    else console.error(err.message);
  }
}

/* =========================
   GÜN FARKI (UTC / TR SAFE)
========================= */
function gunFarkiHesapla(tarih) {
  let hedef = null;

  if (tarih && typeof tarih === "object" && tarih.toDate) {
    hedef = tarih.toDate();
  } else if (typeof tarih === "string") {
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(tarih)) {
      const [g, a, y] = tarih.split(".");
      hedef = new Date(`${y}-${a}-${g}T12:00:00`);
    } else {
      hedef = new Date(tarih);
    }
  }

  if (!hedef || isNaN(hedef.getTime())) return null;

  const bugun = new Date();
  bugun.setHours(12, 0, 0, 0);
  hedef.setHours(12, 0, 0, 0);

  return Math.round((hedef - bugun) / (1000 * 60 * 60 * 24));
}

/* =========================
   ANA CRON İŞİ
========================= */
async function otomatikOdemeKontrolu() {
 const snapshot = await db.collectionGroup("odemeler").get();

  let bildirimSayisi = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    console.log("\n===============================");
    console.log("📄 DOC ID:", doc.id);
    console.log("🏢 Firma:", data.firmaAdi);
    console.log("📅 Raw sonOdeme:", data.sonOdemeTarihi_ts ?? data.sonOdemeTarihi);
    console.log("🔔 hatirlatmaAktif:", data.hatirlatmaAktif);
    console.log("🔕 hatirlatmaGonderildi:", data.hatirlatmaGonderildi);
    console.log("⏳ hatirlatmaGunOnce:", data.hatirlatmaGunOnce);
    console.log("💳 durum:", data.durum);

    const sonOdemeRaw =
      data.sonOdemeTarihi_ts ?? data.sonOdemeTarihi;

    if (!sonOdemeRaw) continue;
    if (data.durum === "odendi") continue;

    const gunFarki = gunFarkiHesapla(sonOdemeRaw);
    console.log("📆 gunFarki:", gunFarki);

    if (gunFarki === null) continue;

    const firmaAdi = data.firmaAdi || "Bilinmiyor";
    const kategori = data.kategori || data.aciklama || "Bilinmiyor";

    const toplamTutar = Number(data.tutar) || 0;
    const odenenTutar = Number(data.odenenTutar) || 0;
    const kalanTutar = Math.max(toplamTutar - odenenTutar, 0);

    const sonOdeme = sonOdemeRaw.toDate
      ? sonOdemeRaw.toDate().toLocaleDateString("tr-TR")
      : sonOdemeRaw;

    /* =========================
       HATIRLATMA KONTROLÜ
    ========================= */
    if (
      gunFarki <= data.hatirlatmaGunOnce &&
      gunFarki >= 0 &&
      data.hatirlatmaAktif === true &&
      data.hatirlatmaGonderildi !== true
    ) {
      console.log("🚀 HATIRLATMA GÖNDERİLİYOR");

      await telegramMesajGonder(
        `⚠️ <b>ÖDEME HATIRLATMASI</b>\n\n` +
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

  console.log(`✅ CRON BITTI → ${bildirimSayisi} bildirim gönderildi`);
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
