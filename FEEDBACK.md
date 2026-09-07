# صندوق پیشنهادات و انتقادات — راهنمای فنی

بخش `#feedback` سایت با یک **Cloudflare Pages Function** کار می‌کند: `functions/api/feedback.js` → مسیر `/api/feedback`.
داده‌ها در **Cloudflare D1** (SQLite) ذخیره می‌شوند. اگر دیتابیس متصل نباشد، سایت در «حالت پیش‌نمایش» چند یادداشت نمونه نشان می‌دهد و فرم پیام «پایگاه‌داده متصل نیست» می‌دهد.

## ۱) یک‌بار راه‌اندازی دیتابیس (۳ دقیقه)
1. داشبورد Cloudflare → **Storage & Databases → D1 → Create database** → نام: `shahyad-feedback`
2. **Workers & Pages → shahyad → Settings → Bindings → Add → D1 database**
   - Variable name: `FEEDBACK_DB`   - Database: `shahyad-feedback`
3. (اختیاری، برای بازبینی قبل از انتشار) **Settings → Variables and Secrets → Add**
   - `ADMIN_KEY` = یک رمز طولانی (Secret)
   - اگر `ADMIN_KEY` تنظیم نشود، یادداشت‌ها **بلافاصله** منتشر می‌شوند. با `AUTO_APPROVE=1` می‌توانید حتی با وجود ADMIN_KEY انتشار فوری داشته باشید.
4. یک بار **Retry deployment** بزنید (یا یک push جدید) تا بایندینگ اعمال شود. جدول‌ها خودکار ساخته می‌شوند.

## ۲) API
| متد | مسیر | کار |
|---|---|---|
| GET | `/api/feedback?limit=24&cursor=<created_at>` | یادداشت‌های منتشرشده + برگزیده‌ها (`featured`) + `total` |
| POST | `/api/feedback` بدنهٔ JSON `{name, kind, text, t}` | ثبت یادداشت (kind: idea / critique / bug / praise) |
| POST | `/api/feedback?like=<id>` | لایک (هر بازدیدکننده روزی یک بار برای هر یادداشت) |

محافظت‌ها: honeypot، حداقل زمان پرکردن فرم (۲.۵ ثانیه)، فیلتر لینک/اسپم، حداکثر ۵ پیام در ساعت برای هر IP، حذف تکراری‌ها، حداکثر ۵۰۰ کاراکتر. فقط متن، نام مستعار و هشِ IP ذخیره می‌شود.

## ۳) مدیریت (بدون پنل — با curl یا مرورگر)
```bash
KEY="ADMIN_KEY شما"; U=https://shahyad.dpdns.org/api/feedback
curl -H "Authorization: Bearer $KEY" "$U?pending=1"          # لیست در انتظار
curl -X POST -H "Authorization: Bearer $KEY" "$U?approve=ID"  # انتشار
curl -X POST -H "Authorization: Bearer $KEY" "$U?reject=ID"   # رد
curl -X POST -H "Authorization: Bearer $KEY" "$U?feature=ID"  # سنجاق به نوار «برگزیده‌ها» (toggle)
```
نوار متحرک: اول یادداشت‌های سنجاق‌شده (featured)، بعد پُرلایک‌ترین‌ها؛ تا ۸ کارت.

## ۴) بکاپ و مدیریت مستقیم داده
- داشبورد D1 → Console: `SELECT * FROM feedback ORDER BY created_at DESC;`
- خروجی کامل: `npx wrangler d1 export shahyad-feedback --remote --output feedback.sql`
- حذف یک یادداشت: `DELETE FROM feedback WHERE id='...';`

## ۵) توسعهٔ محلی
```bash
npx wrangler@3 pages dev . --port 8788 --d1 FEEDBACK_DB --persist-to .wrangler/state
```
