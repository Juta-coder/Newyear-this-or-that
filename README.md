# 🎉 NEW YEAR THIS OR THAT!
**Your Choice, Your Celebration!** — เกมเลือกไอเดียงาน New Year Party 2026 (ไม่ต้อง Login / ไม่เก็บชื่อ)

| หน้า | ลิงก์ | ใช้ทำอะไร |
|---|---|---|
| 🎮 เกม | `/` | ผู้เล่นสแกน QR แล้วเล่น 6 ด่าน |
| 📊 Admin | `/admin` | HR ดูผล ต้องใส่ PIN (ค่าเริ่มต้น `1234`) |

---

## 1) เชื่อม Google Sheet (ฐานข้อมูลจริง) — ทำครั้งเดียว ~5 นาที

ใช้ชีต **"NEW YEAR THIS OR THAT!"** — https://docs.google.com/spreadsheets/d/19JfmwUqturm4ZequH5XMTE7x5--MVjbjzGrohvm_l94/edit
(ID ของชีตตั้งไว้แล้วใน `SPREADSHEET_ID` บรรทัดบนของ `Code.gs` — ถ้าเปลี่ยนชีต ให้แก้ตรงนั้น)

1. เปิด Google Sheet > เมนู **ส่วนขยาย (Extensions) > Apps Script**
2. ลบโค้ดเดิมทั้งหมด แล้ววางเนื้อหาไฟล์ [`google-apps-script/Code.gs`](google-apps-script/Code.gs) ลงไป > กด 💾 Save
3. ด้านบน เลือกฟังก์ชัน **`setup`** > กด **▶ Run** > กดอนุญาตสิทธิ์ (Review permissions > เลือกบัญชี > Allow)
   → ชีตจะมีแท็บ **Responses** พร้อมหัวตาราง
4. กด **Deploy > New deployment** > ไอคอนเฟือง เลือก **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - กด **Deploy** แล้ว **คัดลอก Web app URL** (ลงท้ายด้วย `/exec`)
5. เปิดไฟล์ [`public/js/config.js`](public/js/config.js) แล้ววาง URL:
   ```js
   window.NYTO_CONFIG = { apiUrl: 'https://script.google.com/macros/s/xxxxxxxx/exec' };
   ```

> **เปลี่ยน PIN:** ใน Apps Script > ⚙️ Project Settings > Script properties > แก้ `ADMIN_PIN`
> **ถ้าแก้โค้ด Code.gs ภายหลัง:** Deploy > Manage deployments > ✏️ > Version: New version > Deploy (URL เดิมใช้ต่อได้)

### ความปลอดภัยของข้อมูล
- ผู้เล่น **เพิ่มคำตอบได้อย่างเดียว** อ่านข้อมูลไม่ได้
- การอ่านข้อมูลต้องมี token ที่ได้หลังจาก **ตรวจ PIN ฝั่งเซิร์ฟเวอร์ (Apps Script)** ไม่ได้เช็กแค่ในเบราว์เซอร์ / ใส่ PIN ผิดหลายครั้งจะถูกล็อกชั่วคราว
- ตัว Google Sheet ยังเป็น **Private** — เปิดได้เฉพาะคนที่คุณแชร์ให้
- ข้อความที่ผู้เล่นพิมพ์จะถูกกันไม่ให้กลายเป็นสูตรใน Sheet / CSV

---

## 2) เอาเว็บขึ้นออนไลน์ (เพื่อทำ QR Code)

หน้าเว็บทั้งหมดอยู่ในโฟลเดอร์ **`public/`** (เป็นไฟล์ static ล้วน) เลือกวิธีใดก็ได้:

- **GitHub Pages (มี workflow ให้แล้ว):**
  1. สร้าง repository ใหม่บน GitHub > อัปโหลดไฟล์ทั้งหมดในโปรเจกต์นี้ (รวมโฟลเดอร์ `.github`) ไว้ที่ branch `main`
  2. Settings > Pages > Build and deployment > Source: **GitHub Actions**
  3. รอ 1–2 นาที (ดูที่แท็บ Actions) → เว็บจะอยู่ที่ `https://<ชื่อบัญชี>.github.io/<ชื่อ repo>/`
  4. หน้า Admin บน GitHub Pages คือ `.../admin.html`
- **Netlify Drop:** เปิด https://app.netlify.com/drop แล้วลากโฟลเดอร์ `public` ไปวาง → ได้ลิงก์ https ทันที
- หรือเว็บเซิร์ฟเวอร์ของบริษัทที่รองรับ static site

> บน GitHub Pages / Netlify ต้องใส่ `apiUrl` (Google Sheet) ใน `public/js/config.js` ก่อน เพราะไม่มี `server.js` รันอยู่
> ลิงก์ Apps Script อยู่ในโค้ดได้ ไม่เป็นความลับ — ข้อมูลยังถูกป้องกันด้วย PIN ที่ตรวจฝั่ง Apps Script (PIN เก็บใน Script properties ไม่ได้อยู่ในโค้ด)

จากนั้นเข้า `/admin` > **📱 QR Code** > ใส่ลิงก์เว็บจริง > **Download QR (PNG)** เอาไปติดโปสเตอร์ได้เลย

---

## 3) รันบนเครื่องตัวเอง (ทดสอบ / ใช้ในวง Wi-Fi เดียวกัน)

ต้องมี **Node.js 22.5+** (ไม่ต้อง `npm install`)

```bash
node server.js
```

- เกม: http://localhost:3000 · Admin: http://localhost:3000/admin
- ถ้า `apiUrl` ใน config.js **ว่าง** → คำตอบเก็บใน `data/responses.db` (SQLite) แทน Google Sheet
- ตั้งค่า PIN ได้ด้วย `ADMIN_PIN=4321 node server.js`
- มือถือที่ต่อ Wi-Fi เดียวกันเข้าได้ผ่านลิงก์ "Same Wi-Fi" ที่ขึ้นตอนรัน (ปุ่ม QR ใน Admin จะใช้ลิงก์นี้ให้อัตโนมัติ)

---

## 4) แก้คำถาม / เพิ่มด่าน / เปลี่ยนธีม

| อยากแก้ | ไฟล์ |
|---|---|
| คำถาม ตัวเลือก emoji ข้อความตอบกลับ วันที่งาน | [`public/questions.json`](public/questions.json) |
| สี ฟอนต์ แอนิเมชันหน้าเกม | [`public/css/game.css`](public/css/game.css) |
| ฉากหลัง (ดิสโก้บอล ไฟนีออน คอนเฟตติ) | [`public/css/party-bg.css`](public/css/party-bg.css) |
| ปลายทางเก็บข้อมูล | [`public/js/config.js`](public/js/config.js) |

- ด่านแบบเลือก: `"type": "choice"` + `options` (สี `green` / `red` / `yellow`)
- ด่านแบบพิมพ์: `"type": "text"` (กด SKIP ได้ บันทึกเป็นค่าว่าง)
- ⚠️ ถ้าใช้ Google Sheet และเพิ่ม/เปลี่ยน `id` หรือตัวเลือก ให้แก้ `STEPS` ด้านบนของ `Code.gs` ให้ตรงกัน แล้ว Deploy เวอร์ชันใหม่

---

## ระบบทำงานยังไง
- เล่นแต่ละรอบได้ **Session ID** ใหม่ (สุ่มในเครื่อง) → 1 รอบ = 1 แถว
- ความคืบหน้าเก็บในเครื่องผู้เล่น — **รีเฟรชแล้วเล่นต่อจากเดิมได้** ถ้าเน็ตหลุดตอนส่ง ระบบจะลองส่งใหม่ และยังกดลองอีกครั้งได้
- กดส่งซ้ำ / รีเฟรชระหว่างส่ง → เซิร์ฟเวอร์ **ไม่บันทึกซ้ำ** (เช็กจาก Session ID)
- **PLAY AGAIN** = Session ใหม่ ไม่ทับรอบเก่า
- ไม่เก็บชื่อ, Employee ID, IP หรือข้อมูลอุปกรณ์

## โครงสร้างไฟล์
```
newyear-this-or-that/
├─ public/                 ← หน้าเว็บทั้งหมด (อัปโหลดโฟลเดอร์นี้ขึ้นโฮสต์)
│  ├─ index.html           เกม
│  ├─ admin.html           Admin Dashboard
│  ├─ questions.json       คำถามทั้งหมด
│  ├─ css/ js/ assets/
├─ google-apps-script/Code.gs   ← backend สำหรับ Google Sheet
├─ server.js               ← เซิร์ฟเวอร์ local + SQLite (ทางเลือก)
└─ data/                   ← ไฟล์ฐานข้อมูล local (สร้างอัตโนมัติ)
```
