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

  const snapshot = await db.collectionGroup("odemeler")
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

/* =========================
   ANA CRON İŞİ
========================= */
async function otomatikOdemeKontrolu() {
  const snapshot = await db.collectionGroup("odemeler").get();
  let bildirimSayisi = 0;

  const configCache = {}; 

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const uid = doc.ref.parent.parent.id;

    const sonOdemeRaw =
      data.sonOdemeTarihi_ts ?? data.sonOdemeTarihi;

    if (!sonOdemeRaw) continue;
    if (data.durum === "odendi") continue;
    if (data.isTemplate) continue;

    const gunFarki = gunFarkiHesapla(sonOdemeRaw);
    if (gunFarki === null) continue;

    /* =========================
       KULLANICI CONFIG OKUMA
    ========================= */

    if (!(uid in configCache)) {
      const configDoc = await db
        .collection("kullanicilar")
        .doc(uid)
        .collection("settings")
        .doc("reminderConfig")
        .get();

      configCache[uid] = configDoc.exists
        ? configDoc.data()
        : null;
    }

    const userConfig = configCache[uid];
     /* =========================
   SAAT KONTROLÜ
========================= */

/* =========================
   SAAT KONTROLÜ (Saat Başı)
========================= */

if (
  userConfig &&
  userConfig.aktifMi === true &&
  Array.isArray(userConfig.saatler) &&
  userConfig.saatler.length > 0
) {
  const simdi = new Date();
  const simdikiSaat = simdi.getHours(); // sadece saat

  // Firestore'da saatler number olmalı: [14, 20, 9]
  if (!userConfig.saatler.includes(simdikiSaat)) {
    continue;
  }
}

    /* =========================
       DİNAMİK EŞİK ÜRETİMİ
    ========================= */

    let esikler = [3, 1, 0, -1, -3, -7]; // default sistem

    if (userConfig && userConfig.aktifMi === true) {
      const baslamaGun = userConfig.baslamaGun ?? 3;

      esikler = [];

      // Ödeme gününe kadar her gün
      for (let i = baslamaGun; i >= 0; i--) {
        esikler.push(i);
      }

      // Gecikme eşikleri sabit bırakıyoruz
      esikler.push(-1, -3, -7);
    }

     console.log("------ DEBUG ------");
console.log("UID:", uid);
console.log("GUN FARKI:", gunFarki);
console.log("SIMDIKI SAAT:", new Date().getHours());
console.log("KULLANICI SAATLER:", userConfig?.saatler);
console.log("ESIKLER:", esikler);
console.log("DAHA ONCE GONDERILEN:", data.gonderilenHatirlatmalar);
console.log("-------------------");

    // 🔥 Gün + Saat anahtarı oluştur
const simdikiSaat = new Date().getHours();
const bildirimKey = `${gunFarki}_${simdikiSaat}`;


    /* =========================
       HATIRLATMA KONTROLÜ
    ========================= */

    if (
      data.hatirlatmaAktif === true &&
      esikler.includes(gunFarki) &&
      !data.gonderilenHatirlatmalar?.includes(bildirimKey)
    ) {
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

      if (gunFarki <= -3) {
        mesajBaslik = "🛑 <b>CİDDİ GECİKME</b>";
      }

      if (gunFarki <= -7) {
        mesajBaslik = "🔥 <b>KRİTİK GECİKME</b>";
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

      await doc.ref.update({
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
    await periyotUretici();        // 🔁 ÖNCE ÜRET
    await otomatikOdemeKontrolu(); // ⏰ SONRA KONTROL
  } catch (err) {
    console.error("❌ Cron çalışırken hata:", err);
  } finally {
    process.exit(0);
  }
})();

