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

    console.log("✅ Telegram mesajı gönderildi");
  } catch (err) {
    console.error("❌ Telegram hatası:", err.message);
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

function currentHour() {

  const now = new Date();

  // UTC → Türkiye (UTC+3)
  now.setHours(now.getHours() + 3);

  const saat = now.getHours().toString().padStart(2,"0");

  return `${saat}:00`;

}

async function odemeKontrol() {

  const saat = currentHour();

  console.log("🕓 CRON SAATİ:", saat);

  const usersSnapshot = await db.collection("users").get();

  console.log("👥 USER SAYISI:", usersSnapshot.size);

  let gonderilen = 0;

  for (const userDoc of usersSnapshot.docs) {

    const uid = userDoc.id;

    // notification ayarını al
    const notifRef = await db
      .collection("users")
      .doc(uid)
      .collection("settings")
      .doc("notification")
      .get();

    if (!notifRef.exists) {
      console.log("⚠️ Notification ayarı yok:", uid);
      continue;
    }

    const notif = notifRef.data();

    if (!notif.aktif) {
      console.log("⛔ Hatırlatma kapalı:", uid);
      continue;
    }

    if (!notif.saatler.includes(saat)) {
      console.log("⏱ Saat eşleşmedi:", uid);
      continue;
    }

    const baslamaGun = notif.baslamaGun || 3;

    const firmalarSnapshot = await db
      .collection("users")
      .doc(uid)
      .collection("firmalar")
      .get();

    console.log("🏢 FIRMA SAYISI:", firmalarSnapshot.size);

    for (const firmaDoc of firmalarSnapshot.docs) {

      const firmaId = firmaDoc.id;

      const paymentsSnapshot = await db
        .collection("users")
        .doc(uid)
        .collection("firmalar")
        .doc(firmaId)
        .collection("odemeler")
        .where("durum", "==", "odenmedi")
        .get();

      console.log("💳 ODEME SAYISI:", paymentsSnapshot.size);

      for (const paymentDoc of paymentsSnapshot.docs) {

        const data = paymentDoc.data();

        if (!data.sonOdemeTarihi_ts) continue;

        const gunFarki = gunFarkiHesapla(data.sonOdemeTarihi_ts);

        console.log("📅 GÜN FARKI:", gunFarki);

        // yeni kontrol: baslamaGun
        if (gunFarki > baslamaGun) continue;

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
          baslik = "📌 <b>YAKLAŞAN ÖDEME</b>";
          durum = `⏳ Ödemeye ${gunFarki} gün kaldı`;
        }

        if (gunFarki === 0) {
          baslik = "⚠️ <b>SON ÖDEME GÜNÜ</b>";
          durum = "📌 Bugün son ödeme günü";
        }

        if (gunFarki < 0) {
          baslik = "🚨 <b>GECİKMİŞ ÖDEME</b>";
          durum = `⛔ ${Math.abs(gunFarki)} gündür gecikmiş`;
        }

        const mesaj =
`${baslik}

🏢 <b>Firma:</b> ${firma}
📂 <b>Kategori:</b> ${kategori}

💰 <b>Toplam:</b> ${tutar} ₺
💳 <b>Ödenen:</b> ${odenen} ₺
🧾 <b>Kalan:</b> ${kalan} ₺

📅 <b>Son ödeme:</b> ${sonOdeme}

${durum}`;

        await telegramMesajGonder(mesaj);

        gonderilen++;

        console.log("📨 Bildirim gönderildi:", firma);
      }
    }
  }

  console.log("✅ CRON BİTTİ →", gonderilen, "bildirim gönderildi");
}

(async () => {
  try {
    await odemeKontrol();
  } catch (err) {
    console.error("❌ Cron çalışırken hata:", err);
  } finally {
    process.exit(0);
  }
})();
