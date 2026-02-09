require("dotenv").config();
const axios = require("axios");
const db = require("./firebase");

/* =========================
   TELEGRAM MESAJ
========================= */
async function telegramMesajGonder(mesaj) {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;

  await axios.post(url, {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text: mesaj,
    parse_mode: "HTML",
  });
}

/* =========================
   GÜN FARKI
========================= */
function gunFarkiHesapla(tarih) {
  const bugun = new Date();
  let hedef = null;

  if (tarih && typeof tarih === "object" && tarih.toDate) {
    hedef = tarih.toDate();
  } else if (typeof tarih === "string") {
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

    // ❌ GECİKMİŞ
    if (gunFarki < 0 && data.gecikmeBildirildi !== true) {
      await telegramMesajGonder(
        `❌ <b>ÖDEME GECİKMESİ</b>\n\n` +
        `🏢 Firma: ${firmaAdi}\n` +
        `📂 Kategori: ${kategori}\n` +
        `💳 Toplam: ${toplamTutar} ₺\n` +
        `💰 Ödenen: ${odenenTutar} ₺\n` +
        `🧾 Kalan: ${kalanTutar} ₺\n` +
        `📅 Son Ödeme: ${sonOdeme}\n` +
        `⏱ Gecikme: ${Math.abs(gunFarki)} gün`
      );

      await doc.ref.update({
        gecikmeBildirildi: true,
        gecikmeSonBildirimTarihi: new Date().toLocaleDateString("tr-TR"),
      });

      bildirimSayisi++;
    }

    // ⚠️ HATIRLATMA
    if (
      gunFarki === data.hatirlatmaGunOnce &&
      data.hatirlatmaGonderildi === false
    ) {
      await telegramMesajGonder(
        `⚠️ <b>ÖDEME HATIRLATMA</b>\n\n` +
        `🏢 Firma: ${firmaAdi}\n` +
        `📂 Kategori: ${kategori}\n` +
        `💳 Toplam: ${toplamTutar} ₺\n` +
        `💰 Ödenen: ${odenenTutar} ₺\n` +
        `🧾 Kalan: ${kalanTutar} ₺\n` +
        `📅 Son Ödeme: ${sonOdeme}\n` +
        `⏳ Kalan Süre: ${gunFarki} gün`
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
  await otomatikOdemeKontrolu();
  process.exit(0);
})();



