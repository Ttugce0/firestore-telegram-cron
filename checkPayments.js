require("dotenv").config();
const axios = require("axios");
const admin = require("firebase-admin");
const db = require("./firebase");

console.log("🕒 CRON BAŞLADI");

async function telegramMesajGonder(mesaj) {
  try {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;

    await axios.post(url, {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: mesaj,
      parse_mode: "HTML",
    });

    console.log("✅ Telegram gönderildi");
  } catch (err) {
    console.error("❌ Telegram hatası", err.message);
  }
}

function gunFarkiHesapla(ts) {

  const hedef = ts.toDate();

  const bugun = new Date();
  bugun.setHours(12,0,0,0);

  hedef.setHours(12,0,0,0);

  const fark = (hedef - bugun) / (1000 * 60 * 60 * 24);

  return Math.round(fark);
}

async function odemeKontrol() {

  const usersSnapshot = await db.collection("users").get();

  console.log("👥 USER SAYISI:", usersSnapshot.size);

  let gonderilen = 0;

  for (const userDoc of usersSnapshot.docs) {

    const uid = userDoc.id;

    const paymentsSnapshot = await db
      .collection("users")
      .doc(uid)
      .collection("odemeler")
      .where("durum", "==", "odenmedi")
      .get();

    for (const paymentDoc of paymentsSnapshot.docs) {

      const data = paymentDoc.data();

      if (!data.sonOdemeTarihi_ts) continue;

      const gunFarki = gunFarkiHesapla(data.sonOdemeTarihi_ts);

      if (![3,2,1,0,-1,-3,-7].includes(gunFarki)) continue;

      const firma = data.firmaAdi || "Bilinmeyen Firma";
      const kategori = data.kategori || "-";
      const tutar = data.tutar || 0;
      const odenen = data.odenenTutar || 0;
      const kalan = Math.max(tutar - odenen,0);

      const sonOdeme = data.sonOdemeTarihi_ts
        .toDate()
        .toLocaleDateString("tr-TR");

      let baslik = "";
      let durum = "";

      if (gunFarki > 0) {
        baslik = "📌 YAKLAŞAN ÖDEME";
        durum = `⏳ Ödemeye ${gunFarki} gün kaldı`;
      }

      if (gunFarki === 0) {
        baslik = "⚠️ SON ÖDEME GÜNÜ";
        durum = "Bugün son ödeme günü";
      }

      if (gunFarki < 0) {
        baslik = "🚨 GECİKMİŞ ÖDEME";
        durum = `${Math.abs(gunFarki)} gündür gecikmiş`;
      }

      const mesaj =
`${baslik}

🏢 Firma: ${firma}
📂 Kategori: ${kategori}

💰 Toplam: ${tutar} ₺
💳 Ödenen: ${odenen} ₺
🧾 Kalan: ${kalan} ₺

📅 Son ödeme: ${sonOdeme}

${durum}`;

      await telegramMesajGonder(mesaj);

      gonderilen++;

      console.log("📨 Bildirim gönderildi:", firma);
    }
  }

  console.log("✅ CRON BİTTİ →", gonderilen, "bildirim gönderildi");
}

(async () => {
  try {
    await odemeKontrol();
  } catch (err) {
    console.error("❌ Cron hata:", err);
  } finally {
    process.exit(0);
  }
})();
