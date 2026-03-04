require("dotenv").config();
const axios = require("axios");
const db = require("./firebase");
const admin = require("firebase-admin");


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
   PERİYOT ÜRETİCİ
========================= */
async function periyotUretici() {

  console.log("🔁 PERİYOT ÜRETİMİ BAŞLADI");

const snapshot = await db
  .collectionGroup("odemeler")
  .where("isTemplate", "==", true)
  .where("aktif", "==", true)
  .get();

  const bugun = new Date();
  bugun.setHours(0,0,0,0);

  for (const doc of snapshot.docs) {

    const data = doc.data();
    const uid = doc.ref.parent.parent.id;

    let sonUretilen = data.sonUretilenTarih?.toDate();
    if (!sonUretilen) continue;

    sonUretilen.setHours(0,0,0,0);

   while (sonUretilen < bugun) {

  let yeniTarih = new Date(sonUretilen);

  if (data.periyot === "gunluk") {
    yeniTarih.setDate(yeniTarih.getDate() + 1);
  }
  else if (data.periyot === "aylik") {
    yeniTarih.setMonth(yeniTarih.getMonth() + 1);
  }
  else if (data.periyot === "yillik") {
    yeniTarih.setFullYear(yeniTarih.getFullYear() + 1);
  }

  // 🔥 KRİTİK DÜZELTME
  yeniTarih.setHours(12, 0, 0, 0);

  await db
    .collection("kullanicilar")
    .doc(uid)
    .collection("odemeler")
    .add({
      templateId: doc.id,
      firmaId: data.firmaId,
      firmaAdi: data.firmaAdi,
      kategori: data.kategori,
      tutar: data.tutar,
      periyot: data.periyot,
      aciklama: data.aciklama || "",
      sonOdemeTarihi_ts: yeniTarih,
      durum: "odenmedi",
      odenenTutar: 0,
      hatirlatmaAktif: true,
      gonderilenHatirlatmalar: [],
      olusturmaTarihi: new Date(),
    });

  sonUretilen = yeniTarih;
}

    await doc.ref.update({
      sonUretilenTarih: sonUretilen
    });
  }

  console.log("✅ PERİYOT ÜRETİMİ BİTTİ");
}

async function otomatikOdemeKontrolu() {

  const usersSnapshot = await db.collection("kullanicilar").get();
  let bildirimSayisi = 0;

  for (const userDoc of usersSnapshot.docs) {

    const uid = userDoc.id;

    // 🔹 1. Kullanıcının reminder ayarını oku
    const configDoc = await db
      .collection("kullanicilar")
      .doc(uid)
      .collection("settings")
      .doc("reminderConfig")
      .get();

    if (!configDoc.exists) continue;

    const userConfig = configDoc.data();

    if (!userConfig.aktifMi) continue;

    // 🔹 2. Türkiye saatini al
    const simdikiSaat = Number(
      new Intl.DateTimeFormat("tr-TR", {
        timeZone: "Europe/Istanbul",
        hour: "numeric",
        hour12: false,
      }).format(new Date())
    );

    if (
      !Array.isArray(userConfig.saatler) ||
      !userConfig.saatler.includes(simdikiSaat)
    ) {
      continue;
    }

    // 🔹 3. Kullanıcının ödemelerini çek
    const paymentsSnapshot = await db
      .collection("kullanicilar")
      .doc(uid)
      .collection("odemeler")
      .get();

    for (const paymentDoc of paymentsSnapshot.docs) {

      const data = paymentDoc.data();

      if (data.durum === "odendi") continue;
      if (data.isTemplate) continue;
      if (!data.hatirlatmaAktif) continue;

      const sonOdemeRaw =
        data.sonOdemeTarihi_ts ?? data.sonOdemeTarihi;

      if (!sonOdemeRaw) continue;

      const gunFarki = gunFarkiHesapla(sonOdemeRaw);
      if (gunFarki === null) continue;

      // 🔹 4. Eşik üret
      let esikler = [];

      const baslamaGun = userConfig.baslamaGun ?? 3;

      for (let i = baslamaGun; i >= 0; i--) {
        esikler.push(i);
      }

      esikler.push(-1, -3, -7);

      if (!esikler.includes(gunFarki)) continue;

      const nowTR = new Date().toLocaleString("sv-SE", {
        timeZone: "Europe/Istanbul",
      });

      const trDate = new Date(nowTR);
      const bugunStr = nowTR.split(" ")[0];

      const bildirimKey = `${gunFarki}_${simdikiSaat}_${bugunStr}`;

      if (data.gonderilenHatirlatmalar?.includes(bildirimKey)) continue;

      const firmaAdi = data.firmaAdi || "Bilinmiyor";
      const kategori = data.kategori || data.aciklama || "Bilinmiyor";

      const toplamTutar = Number(data.tutar) || 0;
      const odenenTutar = Number(data.odenenTutar) || 0;
      const kalanTutar = Math.max(toplamTutar - odenenTutar, 0);

      const sonOdeme = sonOdemeRaw.toDate
        ? sonOdemeRaw.toDate().toLocaleDateString("tr-TR")
        : sonOdemeRaw;

      let mesajBaslik = "";
      let durumMetni = "";

      if (gunFarki > 0) {
        mesajBaslik = "📌 <b>YAKLAŞAN ÖDEME</b>";
        durumMetni = `⏳ Ödemeye ${gunFarki} gün kaldı.`;
      }

      if (gunFarki === 0) {
        mesajBaslik = "⚠️ <b>SON ÖDEME GÜNÜ</b>";
        durumMetni = "📌 Bugün son ödeme günü.";
      }

      if (gunFarki < 0) {
        mesajBaslik = "🚨 <b>GECİKMİŞ ÖDEME</b>";
        durumMetni = `⛔ Ödeme ${Math.abs(gunFarki)} gündür gecikmiş durumda.`;
      }

      await telegramMesajGonder(
        `${mesajBaslik}\n\n` +
          `🏢 <b>Firma:</b> ${firmaAdi}\n` +
          `📂 <b>Kategori:</b> ${kategori}\n` +
          `💳 <b>Toplam:</b> ${toplamTutar} ₺\n` +
          `💰 <b>Ödenen:</b> ${odenenTutar} ₺\n` +
          `🧾 <b>Kalan:</b> ${kalanTutar} ₺\n` +
          `📅 <b>Son Ödeme:</b> ${sonOdeme}\n` +
          `${durumMetni}`
      );

      await paymentDoc.ref.update({
        gonderilenHatirlatmalar:
          admin.firestore.FieldValue.arrayUnion(bildirimKey),
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
    await periyotUretici();        
    await otomatikOdemeKontrolu(); 
  } catch (err) {
    console.error("❌ Cron çalışırken hata:", err);
  } finally {
    process.exit(0);
  }
})();

