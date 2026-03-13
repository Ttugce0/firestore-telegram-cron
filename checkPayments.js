require("dotenv").config();
const axios = require("axios");
const admin = require("firebase-admin");
const db = require("./firebase");

console.log("🕒 CRON BAŞLADI");

function getTRTime() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" })
  );
}

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

  const bugun = getTRTime();
  bugun.setHours(12,0,0,0);

  hedef.setHours(12,0,0,0);

  const fark = (hedef - bugun) / (1000 * 60 * 60 * 24);

  return Math.round(fark);
}

function saatEslesiyorMu(saatler) {

  const now = getTRTime();

  const simdiDakika = now.getHours() * 60 + now.getMinutes();

  for (const saat of saatler) {

    const [h,m] = saat.split(":").map(Number);

    const hedefDakika = h * 60 + m;

    const fark = Math.abs(simdiDakika - hedefDakika);

    // GitHub cron gecikmesine karşı tolerans
    if (fark <= 15) {
      return true;
    }
  }

  return false;
}

async function odemeKontrol() {

  const now = getTRTime();

  const saatStr =
    now.getHours().toString().padStart(2,"0") +
    ":" +
    now.getMinutes().toString().padStart(2,"0");

  console.log("🕓 CRON SAATİ (TR):", saatStr);

  const usersSnapshot = await db.collection("users").get();

  console.log("👥 USER SAYISI:", usersSnapshot.size);

  let gonderilen = 0;

  for (const userDoc of usersSnapshot.docs) {

    const uid = userDoc.id;

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

    if (!saatEslesiyorMu(notif.saatler)) {
      console.log("⏱ Saat aralığı eşleşmedi:", uid);
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
